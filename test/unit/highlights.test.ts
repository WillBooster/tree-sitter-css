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

test('semantic prelude highlights do not cross delimiter components', () => {
  const source =
    '@custom (!, important) (!; important) (!: important) (! important);\n' +
    '@custom (min-width, : 400px) (min-width: 400px) (https://cdn/x);';
  const tree = parser.parse(source);
  if (!tree) throw new Error('The parser returned no tree');
  expect(tree.rootNode.hasError).toBe(false);
  const captures = query
    .captures(tree.rootNode)
    .filter(({ name, node }) => name === 'property' || (name === 'keyword' && !node.text.startsWith('@')))
    .map(({ name, node }) => ({ name, text: node.text, start: node.startIndex }));
  expect(captures).toEqual([
    { name: 'keyword', text: '!', start: source.indexOf('! important') },
    { name: 'keyword', text: 'important', start: source.indexOf('! important') + 2 },
    { name: 'property', text: 'min-width', start: source.lastIndexOf('min-width') },
  ]);
  tree.delete();
});

test('container style queries expose and highlight property references', () => {
  const source = '@container card style((--theme: dark) and (--accent: fn(red, blue))) { a { color: red; } }';
  const tree = parser.parse(source);
  if (!tree) throw new Error('The parser returned no tree');
  expect(tree.rootNode.hasError).toBe(false);
  expect(tree.rootNode.descendantsOfType('style_query')).toHaveLength(1);
  expect(tree.rootNode.descendantsOfType('feature_name').map((node) => node.text)).toEqual(['--theme', '--accent']);
  const captures = query.captures(tree.rootNode).filter(({ name }) => name === 'property' || name === 'function');
  expect(captures.map(({ name, node }) => [name, node.text])).toEqual([
    ['property', 'card'],
    ['function', 'style'],
    ['property', '--theme'],
    ['property', '--accent'],
    ['property', 'color'],
  ]);
  tree.delete();
});
