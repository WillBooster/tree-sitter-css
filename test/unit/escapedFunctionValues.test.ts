import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  [
    String.raw`var(--\31 0)`,
    String.raw`var(--\78 )`,
    String.raw`f(\78 )`,
    String.raw`f(\78 b)`,
    String.raw`var(--x\31 0)`,
  ].flatMap((value) => [false, true].map((semicolon) => [value, semicolon] as const))
)('escaped function values remain declarations with following rules: %s %s', (value, semicolon) => {
  const parser = new Parser().setLanguage(language);
  const declaration = `color: ${value}${semicolon ? ';' : ''}`;
  const source = `a { ${declaration} } d { background: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const rules = tree.rootNode.namedChildren;
    expect(rules.map((node) => node.type)).toEqual(['rule_set', 'rule_set']);
    const first = rules[0]!;
    expect(first.descendantsOfType('declaration').map((node) => node.text)).toEqual([declaration]);
    expect(first.descendantsOfType('call_expression').map((node) => node.text)).toEqual([value]);
    const argument = value.slice(value.indexOf('(') + 1, -1);
    const values = first.descendantsOfType('arguments')[0]!.descendantsOfType('plain_value');
    expect(values.map((node) => node.text)).toEqual([argument]);
    expect(values[0]!.startIndex).toBe(source.indexOf(argument));
    expect(values[0]!.endIndex).toBe(source.indexOf(argument) + argument.length);
    expect(first.descendantsOfType('pseudo_class_selector')).toHaveLength(0);
    expect(rules[1]!.text).toBe('d { background: blue; }');
    expect(rules[1]!.startIndex).toBe(source.indexOf('d {'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['url', 'URL', 'uRl', String.raw`u\72l`, String.raw`ur\6c`, String.raw`\75rl`].flatMap((name) =>
    ['1', '1.5'].map((number) => [number, `${name}(x)`])
  )
)('a URL immediately after %s keeps its own token: %s', (number, url) => {
  const parser = new Parser().setLanguage(language);
  const source = `a { --x: ${number}${url}; color: red; } .after {}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const declaration = tree.rootNode.descendantsOfType('declaration')[0]!;
    expect(declaration.descendantsOfType('unit')).toHaveLength(0);
    expect(
      declaration.descendantsOfType('url_value').map((node) => [node.text, node.startIndex, node.endIndex])
    ).toEqual([[url, source.indexOf(url), source.indexOf(url) + url.length]]);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['"x"', "'x'", 'x y', 'f(x)'])(
  'URL-shaped components that do not form an unquoted URL retain their unit: %s',
  (body) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(`a { --x: 1url(${body}); color: red; }`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('url_value')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('unit').map((node) => node.text)).toEqual(['url']);
      expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.firstNamedChild!.text)).toEqual([
        '--x',
        'color',
      ]);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
