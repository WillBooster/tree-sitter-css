import fs from 'node:fs';
import path from 'node:path';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  [
    [String.raw`i\6e finity * 1px`, String.raw`i\6e finity`],
    [String.raw`1px * i\6e finity`, String.raw`i\6e finity`],
    [String.raw`(i\6e finity) * 1px`, String.raw`i\6e finity`],
    [String.raw`1px * (i\6e finity)`, String.raw`i\6e finity`],
    [String.raw`((i\6e finity * 1px))`, String.raw`i\6e finity`],
    [String.raw`-i\6e finity * 1px`, String.raw`-i\6e finity`],
    [String.raw`N\61 N * 1px`, String.raw`N\61 N`],
    [String.raw`\70 i * 1px`, String.raw`\70 i`],
    [String.raw`min(i\6e finity, 1) * 1px`, String.raw`i\6e finity`],
    [String.raw`(1 + i\6e finity) * 1px`, String.raw`i\6e finity`],
  ].flatMap(([expression, atom]) => [false, true].map((semicolon) => [expression!, atom!, semicolon] as const))
)('escaped math constants retain complete operands: %s (%s), semicolon %s', (expression, atom, semicolon) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const value = `calc(${expression})`;
  const declaration = `width: ${value}${semicolon ? ';' : ''}`;
  const source = `a { ${declaration} } d { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.namedChildren.map((node) => node.type)).toEqual(['rule_set', 'rule_set']);
    const first = tree.rootNode.firstNamedChild!;
    expect(first.descendantsOfType('declaration').map((node) => node.text)).toEqual([declaration]);
    expect(first.descendantsOfType('call_expression')[0]!.text).toBe(value);
    const operands = first.descendantsOfType('plain_value').filter((node) => node.text === atom);
    expect(operands).toHaveLength(1);
    expect(operands[0]!.startIndex).toBe(source.indexOf(atom));
    expect(operands[0]!.endIndex).toBe(source.indexOf(atom) + atom.length);
    expect(
      first
        .descendantsOfType('binary_expression')
        .some((node) => node.text === expression.replaceAll(/^\(\(|\)\)$/g, ''))
    ).toBe(true);
    expect(
      query
        .captures(first)
        .filter(({ name }) => name === 'property')
        .map(({ node }) => node.text)
    ).toContain('width');
    expect(tree.rootNode.lastNamedChild!.text).toBe('d { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('d {'));
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['width', 'color']);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
