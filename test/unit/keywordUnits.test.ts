import fs from 'node:fs';
import path from 'node:path';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import type { Node } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const highlights = fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8');
const keywords = ['from', 'to', 'only', 'selector'];
const contexts = [
  'a { b: f(VALUE); }',
  ':foo(VALUE) {}',
  'a { b: (VALUE); }',
  '@media (width: VALUE) {}',
  '@supports (a: VALUE) {}',
  'a { b: calc(VALUE + 2); }',
];

test.each(keywords.flatMap((unit) => contexts.map((context) => [unit, context])))(
  'keyword dimensions retain units and highlights: %s in %s',
  (unit, context) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    try {
      for (const number of ['1', '-1', '.5', '1e2']) {
        const source = context.replace('VALUE', number + unit);
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError).toBe(false);
          const start = source.indexOf(number + unit) + number.length;
          expect(
            tree.rootNode
              .descendantsOfType('unit')
              .map((node) => [node.text, node.startIndex, node.endIndex, node.parent!.text])
          ).toEqual([[unit, start, start + unit.length, number + unit]]);
          expect(
            query
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'type')
              .map(({ node }) => [node.text, node.startIndex, node.endIndex])
          ).toEqual([[unit, start, start + unit.length]]);
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  }
);

test.each(keywords.flatMap((name) => [' ', '/**/', '/bar', '-x', '"x"'].map((tail) => [name, tail])))(
  'dimension boundaries preserve separated and longer plain values: %s %j',
  (name, tail) => {
    const separated = tail === ' ' || tail === '/**/';
    const value = separated ? `1${tail}${name}` : `1${name}${tail}`;
    const source = `a { b: f(${value}); }`;
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('unit')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('integer_value').map((node) => node.text)).toEqual(['1']);
      const plain = separated ? name : name + tail;
      const start = source.indexOf(plain);
      expect(
        tree.rootNode.descendantsOfType('plain_value').map((node) => [node.text, node.startIndex, node.endIndex])
      ).toEqual([[plain, start, start + plain.length]]);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(keywords.flatMap((name) => [' ', '/**/', '/bar'].map((inserted) => [name, inserted])))(
  'editing dimension boundaries and undoing matches fresh trees and highlights: %s %j',
  (name, inserted) => {
    const parser = new Parser().setLanguage(language);
    const freshParser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const source = `a { b: f(1${name}); }`;
    const index = source.indexOf(name) + (inserted === '/bar' ? name.length : 0);
    const changed = source.slice(0, index) + inserted + source.slice(index);
    const original = parser.parse(source)!;
    original.edit(
      new Edit({
        startIndex: index,
        oldEndIndex: index,
        newEndIndex: index + inserted.length,
        startPosition: { row: 0, column: index },
        oldEndPosition: { row: 0, column: index },
        newEndPosition: { row: 0, column: index + inserted.length },
      })
    );
    const edited = parser.parse(changed, original)!;
    const fresh = freshParser.parse(changed)!;
    const trees = [original, edited, fresh];
    const captures = (node: Node): unknown[] =>
      query
        .captures(node)
        .map(({ name: capture, node: captured }) => [
          capture,
          captured.type,
          captured.text,
          captured.startIndex,
          captured.endIndex,
        ]);
    try {
      expect(edited.rootNode.hasError).toBe(false);
      expect(snapshot(edited.rootNode)).toEqual(snapshot(fresh.rootNode));
      expect(captures(edited.rootNode)).toEqual(captures(fresh.rootNode));
      expect(edited.rootNode.descendantsOfType('unit')).toHaveLength(0);
      edited.edit(
        new Edit({
          startIndex: index,
          oldEndIndex: index + inserted.length,
          newEndIndex: index,
          startPosition: { row: 0, column: index },
          oldEndPosition: { row: 0, column: index + inserted.length },
          newEndPosition: { row: 0, column: index },
        })
      );
      const undo = parser.parse(source, edited)!;
      const freshUndo = freshParser.parse(source)!;
      trees.push(undo, freshUndo);
      expect(snapshot(undo.rootNode)).toEqual(snapshot(freshUndo.rootNode));
      expect(captures(undo.rootNode)).toEqual(captures(freshUndo.rootNode));
      expect(undo.rootNode.descendantsOfType('unit').map((node) => node.text)).toEqual([name]);
    } finally {
      for (const tree of trees) tree.delete();
      query.delete();
      parser.delete();
      freshParser.delete();
    }
  }
);

function snapshot(node: Node): unknown[] {
  return [
    node.type,
    node.isNamed,
    node.isMissing,
    node.hasError,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map((child, index) => [node.fieldNameForChild(index), snapshot(child)]),
  ];
}
