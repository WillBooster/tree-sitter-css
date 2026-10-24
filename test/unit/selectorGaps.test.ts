import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const gaps = [' ', ' /**/\n '];
const selectors = [
  ...[
    ':has(a)',
    ':is(.a)',
    ':where(#x)',
    ':not([a])',
    ':host(.a)',
    ':host-context(a)',
    ':foo(a)',
    '::part(a)',
    ':nth-child(2n of .a)',
    ':nth-last-child(odd of .a)',
  ].flatMap((selector) => gaps.map((gap) => selector.replace('(', `(${gap}`))),
  ...[':nth-child(2n of .a)', ':nth-last-child(odd of .a)'].flatMap((selector) =>
    gaps.flatMap((gap) => [selector.replace(' of ', `${gap}of `), selector.replace(' of ', ` of${gap}`)])
  ),
  ...gaps.map((gap) => `[${gap}a]`),
];

test.each(
  selectors.flatMap(
    (selector) =>
      [
        [selector, `${selector} {} .after {}`, 'rule_set', []],
        [selector, `@scope (${selector}) {} .after {}`, 'scope_statement', ['start']],
        [selector, `@scope to (${selector}) {} .after {}`, 'scope_statement', ['end']],
        [selector, `@scope (${selector}) to (${selector}) {} .after {}`, 'scope_statement', ['start', 'end']],
      ] as const
  )
)('selector gaps preserve structure: %s in %s', (selector, source, type, fields) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(first.type).toBe(type);
    for (const field of fields) expect(first.childForFieldName(field)?.text).toBe(selector);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.lastIndexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(gaps)('scope leading gaps retain boundary fields: %j', (gap) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(`@scope (${gap}.a) to (${gap}.b) {} .after {}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const scope = tree.rootNode.firstNamedChild!;
    expect(scope.type).toBe('scope_statement');
    expect(scope.childForFieldName('start')?.text).toBe('.a');
    expect(scope.childForFieldName('end')?.text).toBe('.b');
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(gaps.flatMap((leading) => gaps.map((trailing) => [leading, trailing] as const)))(
  'selector queries retain gaps and public captures: %j %j',
  (leading, trailing) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
    );
    const tree = parser.parse(`@supports selector(${leading}a${trailing}) { .x {} } .after {}`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const condition = tree.rootNode.descendantsOfType('selector_query')[0]!;
      expect(condition.descendantsOfType('tag_name').map((node) => node.text)).toEqual(['a']);
      expect(query.captures(condition).some(({ name, node }) => name === 'tag' && node.text === 'a')).toBe(true);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);
