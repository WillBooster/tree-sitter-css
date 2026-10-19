import path from 'node:path';
import fs from 'node:fs';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  [':matches', '::slotted', ':foo', '::foo'].flatMap((pseudo) =>
    ['a.b', 'a#id', 'a.b.c', 'a.b#id', 'a#id.b', 'svg|a.b'].flatMap((prefix) =>
      [':hover', ':focus-visible', '::before', ':not(.x)', '/**/:hover'].map(
        (suffix) => [pseudo, prefix, suffix] as const
      )
    )
  )
)('compound generic pseudo selectors retain suffixes and captures: %s(%s%s)', (pseudo, prefix, suffix) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const source = `${pseudo}(${prefix}${suffix}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(
      first
        .descendantsOfType('tag_name')
        .some((node) => node.text === 'a' && node.startIndex === source.indexOf('a', pseudo.length + 1))
    ).toBe(true);
    const captures = query.captures(first);
    if (prefix.includes('.b'))
      expect(captures.some(({ name, node }) => name === 'property' && node.text === 'b')).toBe(true);
    if (prefix.includes('#id'))
      expect(captures.some(({ name, node }) => name === 'property' && node.text === 'id')).toBe(true);
    if (suffix.includes('hover'))
      expect(captures.some(({ name, node }) => name === 'attribute' && node.text === 'hover')).toBe(true);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  [':foo', ':lang', '::foo'].flatMap((pseudo) =>
    [
      'foo@bar',
      'foo?bar',
      'foo&bar',
      'foo$bar',
      'foo^bar',
      'foo=bar',
      '<length>',
      '<custom-ident>+',
      'en-*',
      '*-Latn',
    ].map((value) => [pseudo, value] as const)
  )
)('generic pseudo components retain accepted argument and following ranges: %s(%s)', (pseudo, value) => {
  const parser = new Parser().setLanguage(language);
  const selector = `${pseudo}(${value})`;
  const source = `${selector}{} .after{color:red;}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.firstNamedChild?.text).toBe(selector);
    expect(tree.rootNode.descendantsOfType('arguments').map((node) => node.text)).toEqual([`(${value})`]);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after{color:red;}');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});
