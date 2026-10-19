import path from 'node:path';
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

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
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
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
    expect(
      query
        .captures(first)
        .filter(({ name }) => name === 'property')
        .map(({ node }) => node.text)
    ).toContain('color');
    expect(rules[1]!.text).toBe('d { background: blue; }');
    expect(rules[1]!.startIndex).toBe(source.indexOf('d {'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
