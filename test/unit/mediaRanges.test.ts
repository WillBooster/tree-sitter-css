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
