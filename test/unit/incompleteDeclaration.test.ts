import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));

test.each(
  ['\n', '\r\n', '\f'].flatMap((newline) =>
    ['display', String.raw`--\61`].flatMap((property) => [' ', ''].map((gap) => [newline, property, gap]))
  )
)(
  'an incomplete declaration preserves following properties across %j before %s with gap %j',
  (newline, property, gap) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
    const source = `div {${newline}  padding${newline}  ${property}:${gap}flex;${newline}  color: red;${newline}}`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('incomplete_declaration').map((node) => node.text)).toEqual(['padding']);
      const block = tree.rootNode.firstNamedChild!.namedChildren.find((node) => node.type === 'block')!;
      const declarations = block.namedChildren.filter((node) => node.type === 'declaration');
      expect(declarations.map((node) => node.text)).toEqual([`${property}:${gap}flex;`, 'color: red;']);
      expect(declarations.every((node) => !node.hasError)).toBe(true);
      expect(
        query
          .captures(block)
          .filter(({ name }) => name === 'property')
          .map(({ node }) => node.text)
      ).toEqual(['padding', property, 'color']);
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each([
  'div { padding\n: 1px; display: flex; }',
  'div { padding: 1px\n 2px; display: flex; }',
  'div { padding\n display:hover { color: red; } }',
  'div { padding\n display { color: red; } }',
])('valid multiline declarations and nested selectors stay complete: %s', (source) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('incomplete_declaration')).toHaveLength(0);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'padding\ndisplay:flex;',
  'div { padding\n /* comment */ display:flex; }',
  'div { padding /* comment */\n display:/* value */flex; }',
  'div { padding\n // comment\n display:flex; }',
  'div { padding\n display/**/:flex; }',
])('comments and top-level snippets preserve following declarations: %s', (source) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('incomplete_declaration').map((node) => node.text)).toEqual(['padding']);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.firstNamedChild?.text)).toEqual([
      'display',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});
