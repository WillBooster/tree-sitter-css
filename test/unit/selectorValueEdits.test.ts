import fs from 'node:fs';
import path from 'node:path';
import type { Node, Point, Range, Tree } from '@willbooster/web-tree-sitter';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const highlights = fs.readFileSync(path.join(import.meta.dirname, '../../queries/highlights.scm'), 'utf8');
const valueParts = [
  ['& ', ''],
  ['', ' * 1'],
] as const;
const editCases = valueParts.flatMap(([before, after]) =>
  ['', '/* pad */ ', '/* Ω🙂\r\n */ '].flatMap((prefix) =>
    [' ', '\n', '\r\n', '\n/**/'].flatMap((gap) => {
      const source = `${prefix}a { --x: f(${before}alpha${after}${gap}${before}beta${after}); } .after { z: y; }`;
      return [
        [source.indexOf('beta'), 4, 'word'],
        [source.indexOf('beta'), 4, '{   '],
        [source.indexOf('alpha'), 5, '"{ }"'],
        [source.indexOf('beta'), 4, '\n& * .nested { z: y; }'],
        [0, 0, '/* inserted Ω🙂\n */ '],
        [0, prefix.length, ''],
        [source.indexOf(');'), 1, '{'],
      ].map(([index, removed, inserted]) => ({
        source,
        index: Number(index),
        removed: Number(removed),
        inserted: String(inserted),
      }));
    })
  )
);

test.each(editCases)('selector-like values survive real edits and undo: %j', ({ source, index, removed, inserted }) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const original = parser.parse(source)!;
  const changed = edit(original, source, index, removed, inserted);
  const incremental = parser.parse(changed, original)!;
  const fresh = parser.parse(changed)!;
  const trees = [original, incremental, fresh];
  try {
    expect(original.rootNode.hasError).toBe(false);
    expectEquivalent(incremental, fresh, query);
    const restored = edit(incremental, changed, index, inserted.length, source.slice(index, index + removed));
    const undo = parser.parse(restored, incremental)!;
    const freshUndo = parser.parse(source)!;
    trees.push(undo, freshUndo);
    expectEquivalent(undo, freshUndo, query);
    expect(undo.rootNode.hasError).toBe(false);
  } finally {
    for (const tree of trees) tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  valueParts.flatMap(([before, after]) =>
    [' { x: y; } ', '\n{ x: y; }\n', '/* Ω🙂 */ { x:y; }'].map((gap) => [before, after, gap] as const)
  )
)('included ranges can change after a selector-like value: %s%s %s', (before, after, gap) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const source = `a { --x: f(${before}alpha${after}${gap}${before}beta${after}); } .after { z: y; }`;
  const start = source.indexOf(gap);
  const end = start + gap.length;
  const variants = [[range(source, 0, start), range(source, end, source.length)], [range(source, 0, source.length)]];
  let previous = parser.parse(source, undefined, { includedRanges: variants[0] })!;
  try {
    expect(previous.rootNode.hasError).toBe(false);
    for (let iteration = 0; iteration < 12; iteration++) {
      const includedRanges = variants[(iteration + 1) % 2];
      const next = parser.parse(source, previous, { includedRanges })!;
      const other = new Parser().setLanguage(language);
      const fresh = other.parse(source, undefined, { includedRanges })!;
      try {
        expectEquivalent(next, fresh, query);
      } finally {
        previous.delete();
        fresh.delete();
        other.delete();
        previous = next;
      }
    }
  } finally {
    previous.delete();
    query.delete();
    parser.delete();
  }
});

test('independent parses cannot retain selector-like value lookahead from the preceding input', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  try {
    for (let iteration = 0; iteration < 40; iteration++) {
      const source =
        iteration % 2 ? 'a { --x: (\n& * .after { z: y; }\n}' : 'a { --x: f(& word & item); } .after { z: y; }';
      const reused = parser.parse(source)!;
      const other = new Parser().setLanguage(language);
      const fresh = other.parse(source)!;
      try {
        expectEquivalent(reused, fresh, query);
        expect(reused.rootNode.hasError).toBe(Boolean(iteration % 2));
      } finally {
        reused.delete();
        fresh.delete();
        other.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

function expectEquivalent(actual: Tree, expected: Tree, query: Query): void {
  expect(snapshot(actual.rootNode)).toEqual(snapshot(expected.rootNode));
  const captures = (tree: Tree): unknown[] =>
    query.captures(tree.rootNode).map(({ name, node }) => [name, node.type, node.startIndex, node.endIndex, node.text]);
  expect(captures(actual)).toEqual(captures(expected));
}

function snapshot(node: Node): unknown[] {
  return [
    node.type,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.hasError,
    node.isMissing,
    node.text,
    node.children.map(snapshot),
  ];
}

function edit(tree: Tree, before: string, index: number, removed: number, inserted: string): string {
  const after = before.slice(0, index) + inserted + before.slice(index + removed);
  tree.edit(
    new Edit({
      startIndex: index,
      oldEndIndex: index + removed,
      newEndIndex: index + inserted.length,
      startPosition: point(before, index),
      oldEndPosition: point(before, index + removed),
      newEndPosition: point(after, index + inserted.length),
    })
  );
  return after;
}

function range(source: string, startIndex: number, endIndex: number): Range {
  return { startIndex, endIndex, startPosition: point(source, startIndex), endPosition: point(source, endIndex) };
}

function point(source: string, index: number): Point {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}
