import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';

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
  const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.firstNamedChild?.text)).toEqual(names);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name, node }) => name === 'property' && node.type === 'property_name')
        .map(({ node }) => node.text)
    ).toEqual(names);
  } finally {
    tree.delete();
    query.delete();
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

test('editing a star-prefixed declaration preserves nested universal selectors and following rules', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const source = 'a { *display: inline; * { color: red; } b * { width: 1px; } } .after { color: blue; }';
  const tree = parser.parse(source)!;
  const offset = source.indexOf('inline');
  const updated = source.replace('inline', 'block');
  tree.edit(
    new Edit({
      startIndex: offset,
      oldEndIndex: offset + 6,
      newEndIndex: offset + 5,
      startPosition: { row: 0, column: offset },
      oldEndPosition: { row: 0, column: offset + 6 },
      newEndPosition: { row: 0, column: offset + 5 },
    })
  );
  const incremental = parser.parse(updated, tree)!;
  const fresh = parser.parse(updated)!;
  try {
    expect(fresh.rootNode.hasError).toBe(false);
    expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
    expect(fresh.rootNode.descendantsOfType('universal_selector').map((node) => node.text)).toEqual(['*', '*']);
    expect(fresh.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      '*display: block;',
      'color: red;',
      'width: 1px;',
      'color: blue;',
    ]);
    expect(fresh.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
  } finally {
    tree.delete();
    incremental.delete();
    fresh.delete();
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

test.each(['display', '*display'])('an unfinished star property preserves the next declaration %s', (nextProperty) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`a { *padding\n ${nextProperty}: flex; color: red; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('incomplete_declaration').map((node) => node.text)).toEqual(['*padding']);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      `${nextProperty}: flex;`,
      'color: red;',
    ]);
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
    expect(tree.rootNode.descendantsOfType('incomplete_declaration')).toHaveLength(0);
    expect(tree.rootNode.descendantsOfType('universal_selector')).toHaveLength(1);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual(['color: red;']);
  } finally {
    tree.delete();
    parser.delete();
  }
});
