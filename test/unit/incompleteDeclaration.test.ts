import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));

test.each(['\n', '\r\n', '\f'])(
  'inserting an incomplete declaration preserves following properties across %j',
  (newline) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
    const source = `div {${newline}  display: flex;${newline}  color: red;${newline}}`;
    const original = parser.parse(source)!;
    const insertion = `  padding${newline}`;
    const offset = source.indexOf('  display');
    const row = newline.includes('\n') ? 1 : 0;
    const column = row ? 0 : offset;
    original.edit(
      new Edit({
        startIndex: offset,
        oldEndIndex: offset,
        newEndIndex: offset + insertion.length,
        startPosition: { row, column },
        oldEndPosition: { row, column },
        newEndPosition: { row: row + (row ? 1 : 0), column: row ? 0 : column + insertion.length },
      })
    );
    const updated = source.slice(0, offset) + insertion + source.slice(offset);
    const incremental = parser.parse(updated, original)!;
    const fresh = parser.parse(updated)!;
    try {
      expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
      expect(fresh.rootNode.hasError).toBe(false);
      expect(fresh.rootNode.descendantsOfType('incomplete_declaration')).toHaveLength(1);
      const block = fresh.rootNode.firstNamedChild!.namedChildren.find((node) => node.type === 'block')!;
      const declarations = block.namedChildren.filter((node) => node.type === 'declaration');
      expect(declarations.map((node) => node.text)).toEqual(['display: flex;', 'color: red;']);
      expect(declarations.every((node) => !node.hasError)).toBe(true);
      expect(
        query
          .captures(block)
          .filter(({ name }) => name === 'property')
          .map(({ node }) => node.text)
      ).toEqual(['padding', 'display', 'color']);
    } finally {
      original.delete();
      incremental.delete();
      fresh.delete();
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
