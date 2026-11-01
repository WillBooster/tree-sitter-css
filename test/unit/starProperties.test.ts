import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));

test.each([
  ['.sidebar { *vertical-align: auto; *display: inline; color: red; }', ['*vertical-align', '*display', 'color']],
  ['a { *zoom: 1 }', ['*zoom']],
  ['*zoom: 1; color: red', ['*zoom', 'color']],
  ['@media screen { a { *display: inline; color: red; } }', ['*display', 'color']],
  ['a { *-vendor-name: f(1px); *--custom: x; }', ['*-vendor-name', '*--custom']],
])('preserves legacy star-prefixed declaration names in %s', (source, names) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.firstNamedChild?.text)).toEqual(names);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['a { --x: f(*foo); }', 'a { --x: *foo; }', 'a { --x: f(*-foo) *bar; }'])(
  'keeps an asterisk followed by a name inside values as a value in %s',
  (source) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.firstNamedChild?.text)).toEqual(['--x']);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test('a star-prefixed declaration preserves nested universal selectors and following rules', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse('a { *display: block; * { color: red; } b * { width: 1px; } } .after { color: blue; }')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('universal_selector').map((node) => node.text)).toEqual(['*', '*']);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      '*display: block;',
      'color: red;',
      'width: 1px;',
      'color: blue;',
    ]);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'a { * display: inline; }',
  'a { **display: inline; }',
  'a { *: inline; }',
  'a { *padding\n * display: inline; }',
  'a { *padding\n **display: inline; }',
])('does not accept malformed star-prefixed property names: %s', (source) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['display', '*display'])('reports a missing colon before the next declaration %s', (nextProperty) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`a { *padding\n ${nextProperty}: flex; color: red; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['*', '*:hover', '*|div'])('recovery lookahead preserves a nested universal selector %s', (selector) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`a { padding\n ${selector} { color: red; } }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('universal_selector')).toHaveLength(1);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual(['color: red;']);
  } finally {
    tree.delete();
    parser.delete();
  }
});
