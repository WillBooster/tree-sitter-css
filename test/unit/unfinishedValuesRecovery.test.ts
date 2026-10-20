import path from 'node:path';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

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

test.each([
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
])('valid multiline function components retain their declaration: %s', (value) => {
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

test.each(
  ['(', '[', '(word', '[word', '(f(x) '].flatMap((opening) =>
    ['\n', '\r\n', '\n/**/'].flatMap((gap) =>
      [
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
      ].map((selector) => [opening, gap, selector] as const)
    )
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
