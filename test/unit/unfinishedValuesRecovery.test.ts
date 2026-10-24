import path from 'node:path';

import { Edit, Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const multilineValues = [
  '.token .next',
  '& .token .next',
  '* .token .next',
  '& [a*=x]',
  '* [a*=x]',
  '& "{ text }"',
  '* "{ text }"',
  String.raw`& \{`,
  String.raw`* \{`,
  'calc(2 * 3)',
  '.token/**/ .next',
  '.token + .next',
  '.5 .25',
  String.raw`.\61 fter`,
  '"{ text }"',
  'url("https://example.test/{x}")',
  '/* { } */ .token',
];

test.each(
  ['@import url("x.css"', '@import url(x.css', '@import src("x.css"', '@import src(var(--stylesheet)'].flatMap(
    (prefix) =>
      ['\n', '\r\n', '\n/**/'].flatMap((gap) =>
        [
          '.after',
          String.raw`.\61 fter`,
          '.é',
          '.after/**/',
          '.after:hover',
          '.after.child',
          '.after[a]',
          '.after#x',
          '.after > a',
          '.after .child',
        ].flatMap((selector) => ['', '\n'].map((ending) => [prefix, gap, selector, ending] as const))
      )
  )
)('unfinished imports retain a following class rule: %s%s%s%s', (prefix, gap, selector, ending) => {
  const parser = new Parser().setLanguage(language);
  const rule = `${selector} { z: y; }`;
  const source = `${prefix}${gap}${rule}${ending}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.type).toBe('stylesheet');
    expect(tree.rootNode.hasError).toBe(true);
    const following = tree.rootNode.lastNamedChild!;
    expect(following.type).toBe('rule_set');
    expect(following.text).toBe(rule);
    expect(following.startIndex).toBe(source.indexOf(selector));
    expect(following.endIndex).toBe(source.indexOf(selector) + rule.length);
    expect(following.descendantsOfType('property_name').map((node) => [node.text, node.startIndex])).toEqual([
      ['z', source.indexOf('z:')],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['calc', 'f'].flatMap((name) => ['\n', '\r\n', '\n/**/'].map((gap) => [name, gap] as const)))(
  'unfinished functions retain their media and later selector/declaration ranges: %s %s',
  (name, gap) => {
    const parser = new Parser().setLanguage(language);
    const source = `@media (min-width: 600px) and (max-width: 900px) { .a { width: ${name}(${gap}.after { z: y }\n`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.type).toBe('stylesheet');
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.firstNamedChild?.type).toBe('media_statement');
      const following = tree.rootNode.descendantsOfType('class_selector').find((node) => node.text === '.after')!;
      expect(following.startIndex).toBe(source.indexOf('.after'));
      expect(following.endIndex).toBe(source.indexOf('.after') + '.after'.length);
      const property = tree.rootNode.descendantsOfType('property_name').find((node) => node.text === 'z')!;
      expect(property.startIndex).toBe(source.indexOf('z:'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(multilineValues)('valid multiline function components retain their declaration: %s', (value) => {
  const parser = new Parser().setLanguage(language);
  const call = `f(\n${value}\n)`;
  const source = `a { --x: ${call}; } .after { z: y; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('call_expression')[0]?.text).toBe(call);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { z: y; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['b: .a/*', 'a { b: .a/*', 'a { b: f(.a/*', ':foo(.a/*'])(
  'unterminated comments after dots remain errors through the full input: %s',
  (source) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.endIndex).toBe(source.length);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([
  'url("x.css")',
  'src("x.css")',
  'src(var(--stylesheet) type("text/css"))',
  'src(attr(data-style type(<string>), "fallback.css"))',
  String.raw`s\72 c(var(--stylesheet))`,
  'URL("x.css" modifier type("text/css"))',
  String.raw`u\72 l("x.css" \6d odifier)`,
  String.raw`url("x.css" \74 ype("text/css"))`,
  String.raw`u\72l(https://example.test/a;b,c.css)`,
])('import URL syntax retains modifiers and following rules: %s', (url) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import ${url} screen; .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.type).toBe('import_statement');
    expect(tree.rootNode.firstNamedChild?.text).toBe(`@import ${url} screen;`);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

const recoverySelectors = [
  '& .after',
  '* .after',
  '&.after',
  '*.after',
  '& * .after',
  '* & .after',
  '& & .after',
  '* * .after',
  '& * & .after',
  '& [a*=x]',
];
const recoveryPairs = [
  ...['(', '['].flatMap((opening) => recoverySelectors.map((selector) => [opening, selector] as const)),
  ...['(word', '[word', '(f(x) '].flatMap((opening) =>
    recoverySelectors.filter((selector) => selector.startsWith('&')).map((selector) => [opening, selector] as const)
  ),
];
test.each(
  recoveryPairs.flatMap(([opening, selector]) =>
    ['\n', '\r\n', '\n/**/'].map((gap) => [opening, gap, selector] as const)
  )
)('unfinished values retain complete nested selector boundaries: %s %s %s', (opening, gap, selector) => {
  const parser = new Parser().setLanguage(language);
  const rule = `${selector} { color: red; }`;
  const source = `a { --x: ${opening}${gap}${rule}\n}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const following = tree.rootNode.descendantsOfType('rule_set').find((node) => node.text === rule)!;
    expect(following).toBeDefined();
    expect(following.startIndex).toBe(source.indexOf(selector));
    expect(following.firstNamedChild?.text).toBe(selector);
    expect(following.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color']);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['(', '['].flatMap((opening) => multilineValues.map((value) => [opening, value] as const)))(
  'closed multiline groups remain complete declarations: %s %s',
  (opening, value) => {
    const parser = new Parser().setLanguage(language);
    const closing = opening === '(' ? ')' : ']';
    const component = `${opening}\n${value}\n${closing}`;
    const source = `a { --x: ${component}; } .after { z: y; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const grouped = tree.rootNode.descendantsOfType(opening === '(' ? 'parenthesized_value' : 'grid_value')[0]!;
      expect(grouped.text).toBe(component);
      expect(grouped.startIndex).toBe(source.indexOf(component));
      expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['--x', 'z']);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { z: y; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test('closing and reopening a multiline group matches fresh parsing', () => {
  const parser = new Parser().setLanguage(language);
  const incomplete = 'a { --x: (\n.token .next\n; } .after { z: y; }';
  const index = incomplete.indexOf(';');
  const complete = `${incomplete.slice(0, index)})${incomplete.slice(index)}`;
  const initial = parser.parse(incomplete)!;
  initial.edit(
    new Edit({
      startIndex: index,
      oldEndIndex: index,
      newEndIndex: index + 1,
      startPosition: { row: 2, column: 0 },
      oldEndPosition: { row: 2, column: 0 },
      newEndPosition: { row: 2, column: 1 },
    })
  );
  const incremental = parser.parse(complete, initial)!;
  const fresh = parser.parse(complete)!;
  try {
    expect(incremental.rootNode.hasError).toBe(false);
    expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
    expect(incremental.rootNode.descendantsOfType('parenthesized_value')[0]?.text).toBe('(\n.token .next\n)');
    incremental.edit(
      new Edit({
        startIndex: index,
        oldEndIndex: index + 1,
        newEndIndex: index,
        startPosition: { row: 2, column: 0 },
        oldEndPosition: { row: 2, column: 1 },
        newEndPosition: { row: 2, column: 0 },
      })
    );
    const reopened = parser.parse(incomplete, incremental)!;
    const freshIncomplete = parser.parse(incomplete)!;
    try {
      expect(reopened.rootNode.hasError).toBe(true);
      expect(reopened.rootNode.toString()).toBe(freshIncomplete.rootNode.toString());
      expect(reopened.rootNode.lastNamedChild?.text).toBe('.after { z: y; }');
    } finally {
      reopened.delete();
      freshIncomplete.delete();
    }
  } finally {
    initial.delete();
    incremental.delete();
    fresh.delete();
    parser.delete();
  }
});
