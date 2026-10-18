import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));

test('scope limits retain selector fields and highlights when a start is inserted', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
  const source = '@scope to (.limit) { .content { color: red; } } .after {}';
  const tree = parser.parse(source)!;
  const insertion = '(.card, #article) ';
  try {
    const scope = tree.rootNode.firstNamedChild!;
    expect(tree.rootNode.hasError).toBe(false);
    expect(scope.type).toBe('scope_statement');
    expect(scope.childForFieldName('start')).toBeNull();
    expect(scope.childForFieldName('end')?.text).toBe('.limit');
    tree.edit(
      new Edit({
        startIndex: 7,
        oldEndIndex: 7,
        newEndIndex: 7 + insertion.length,
        startPosition: { row: 0, column: 7 },
        oldEndPosition: { row: 0, column: 7 },
        newEndPosition: { row: 0, column: 7 + insertion.length },
      })
    );
    const updated = source.slice(0, 7) + insertion + source.slice(7);
    const incremental = parser.parse(updated, tree)!;
    const fresh = parser.parse(updated)!;
    try {
      expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
      expect(incremental.rootNode.hasError).toBe(false);
      const changedScope = incremental.rootNode.firstNamedChild!;
      expect(changedScope.childForFieldName('start')?.text).toBe('.card, #article');
      expect(changedScope.childForFieldName('end')?.text).toBe('.limit');
      expect(
        query
          .captures(changedScope)
          .filter(({ name }) => name === 'property')
          .map(({ node }) => node.text)
      ).toEqual(['card', 'article', 'limit', 'content', 'color']);
      expect(
        query
          .captures(changedScope)
          .filter(({ name }) => name === 'keyword')
          .map(({ node }) => node.text)
      ).toEqual(['@scope', 'to']);
      expect(incremental.rootNode.lastNamedChild?.text).toBe('.after {}');
    } finally {
      incremental.delete();
      fresh.delete();
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
