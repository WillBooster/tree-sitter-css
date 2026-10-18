import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));
const parser = new Parser();
parser.setLanguage(language);
const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));

test('media range queries retain feature highlights and following rules', () => {
  const source =
    '@media (400px <= width < 70em) and (aspect-ratio >= 16/9), (2dppx < resolution) { a { color: red; } } b { display: block; }';
  const tree = parser.parse(source);
  if (!tree) throw new Error('The parser returned no tree');
  expect(tree.rootNode.hasError).toBe(false);
  expect(tree.rootNode.descendantsOfType('range_query')).toHaveLength(3);
  expect(tree.rootNode.descendantsOfType('feature_name').map((node) => node.text)).toEqual([
    'width',
    'aspect-ratio',
    'resolution',
  ]);
  expect(
    query
      .captures(tree.rootNode)
      .filter(({ name, node }) => name === 'property' && node.type === 'feature_name')
      .map(({ node }) => node.text)
  ).toEqual(['width', 'aspect-ratio', 'resolution']);
  expect(
    query
      .captures(tree.rootNode)
      .filter(({ name, node }) => name === 'operator' && node.parent?.type === 'range_query')
      .map(({ node }) => node.text)
  ).toEqual(['<=', '<', '>=', '<']);
  expect(tree.rootNode.lastNamedChild?.text).toBe('b { display: block; }');
  tree.delete();
});

test('media ratios use unitless numbers while dimension values retain units', () => {
  for (const value of ['16/9', '1.5/.5', '1e2/2.5e1', '1e+2/2.5E+1']) {
    const tree = parser.parse(`@media (aspect-ratio >= ${value}) { a { width: 16px; opacity: .5; } }`);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, value).toBe(false);
    const ratios = tree.rootNode.descendantsOfType('ratio_value');
    expect(ratios).toHaveLength(1);
    expect(ratios[0]?.text).toBe(value);
    expect(ratios[0]?.namedChildren.map((node) => node.type)).toEqual(
      value === '16/9' ? ['integer_value', 'integer_value'] : ['float_value', 'float_value']
    );
    expect(tree.rootNode.descendantsOfType('unit').map((node) => node.text)).toEqual(['px']);
    expect(
      query
        .captures(ratios[0]!)
        .filter(({ name }) => name === 'number')
        .map(({ node }) => node.text)
    ).toEqual(value.split('/'));
    tree.delete();
  }
  for (const value of ['16px/9', '16/9em', '1.5%/.5', '1e2/2.5e1px']) {
    const tree = parser.parse(`@media (aspect-ratio >= ${value}) {}`);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, value).toBe(true);
    tree.delete();
  }
});

test('media range dimensions retain signed exponents as one numeric operand', () => {
  for (const value of ['1e+3px', '1E+3px', '1.5e+3px', '1e-3px']) {
    const tree = parser.parse(`@media (width < ${value}) {}`);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, value).toBe(false);
    expect(tree.rootNode.descendantsOfType('float_value').map((node) => node.text)).toEqual([value]);
    tree.delete();
  }
});
