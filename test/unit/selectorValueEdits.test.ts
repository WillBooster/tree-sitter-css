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
        ...(after
          ? [
              [source.indexOf('* 1') + 2, 1, 'word'],
              [source.indexOf('* 1') + 2, 1, '.nested { z: y; }'],
            ]
          : []),
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

test.each([
  ...valueParts.flatMap(([before, after]) =>
    [' { x: y; } ', '\n{ x: y; }\n', '/* Ω🙂 */ { x:y; }'].map((gap) => ({
      source: `a { --x: f(${before}alpha${after}${gap}${before}beta${after}); } .after { z: y; }`,
      gap,
      hasError: false,
    }))
  ),
  ...['word * ', 'var(--a) * ', '"text" * '].map((term) => ({
    source: `/* Ω🙂\r\n */ a { --x: f(${term.repeat(24)}{ x: y; } } .after { z: y; }`,
    gap: '{ x: y; }',
    hasError: true,
  })),
])('included ranges can change after a selector-like value: %j', ({ source, gap, hasError }) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const start = source.indexOf(gap);
  const end = start + gap.length;
  const variants = [[range(source, 0, start), range(source, end, source.length)], [range(source, 0, source.length)]];
  let previous = parser.parse(source, undefined, { includedRanges: variants[0] })!;
  try {
    expect(previous.rootNode.hasError).toBe(hasError);
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
  const sources = [
    'a { --x: f(& word & item); } .after { z: y; }',
    'a { --x: (\n& * .after { z: y; }\n}',
    'a { --x: f(word * var(--a) * "text" * {} } .after { z: y; }',
  ];
  try {
    for (let iteration = 0; iteration < 40; iteration++) {
      const source = sources[iteration % sources.length]!;
      const reused = parser.parse(source)!;
      const other = new Parser().setLanguage(language);
      const fresh = other.parse(source)!;
      try {
        expectEquivalent(reused, fresh, query);
        expect(reused.rootNode.hasError).toBe(iteration % sources.length !== 0);
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

test.each(
  ['a { --x: f(', 'a { --x: [', '@media (a: '].flatMap((opening) =>
    ['word * ', 'var(--a) * ', '"text" * '].flatMap((term) => {
      const source = `/* Ω🙂\r\n */ ${opening}${term.repeat(24)}{} } .after { z: y; }`;
      return [
        [source.indexOf('{}'), 1, ')'],
        [source.indexOf(term) + term.indexOf('*'), 1, '&'],
        [0, 0, ' '],
        [0, 0, '\n'],
        [3, 1, 'a'],
        [0, source.indexOf(opening), ''],
      ].map(([index, removed, inserted]) => ({
        source,
        index: Number(index),
        removed: Number(removed),
        inserted: String(inserted),
      }));
    })
  )
)(
  'unfinished arithmetic retains tree ranges and highlights through edits and undo: %j',
  ({ source, index, removed, inserted }) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const original = parser.parse(source)!;
    const changed = edit(original, source, index, removed, inserted);
    const incremental = parser.parse(changed, original)!;
    const fresh = parser.parse(changed)!;
    const trees = [original, incremental, fresh];
    try {
      expectEquivalent(incremental, fresh, query);
      const restored = edit(incremental, changed, index, inserted.length, source.slice(index, index + removed));
      const undo = parser.parse(restored, incremental)!;
      const freshUndo = parser.parse(source)!;
      trees.push(undo, freshUndo);
      expectEquivalent(undo, freshUndo, query);
    } finally {
      for (const tree of trees) tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each(
  ['', '/* Ω🙂 */ ', '/* Ω🙂\n */ ', '/* Ω🙂\r\n */ '].flatMap((prefix) =>
    ['12px/1.5', '.5px/1.5', '1e2px/1.5', '1url(x)', '.5url(x)', '1e2url(x)'].map((value) => [prefix, value])
  )
)('two successive edits invalidate a numeric unit decision: %j %s', (prefix, value) => {
  const source = `${prefix}a { margin: 0 ${value} Arial }`;
  const parser = new Parser().setLanguage(language);
  const freshParser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const original = parser.parse(source)!;
  const firstIndex = source.indexOf('margin');
  const firstSource = edit(original, source, firstIndex, 0, 'x');
  const first = parser.parse(firstSource, original)!;
  const tail = value.includes('/') ? '/' : '(x)';
  const index = firstSource.indexOf(tail, firstSource.indexOf(value));
  const changed = edit(first, firstSource, index, tail.length, ' ');
  const incremental = parser.parse(changed, first)!;
  const fresh = freshParser.parse(changed)!;
  const trees = [original, first, incremental, fresh];
  try {
    expect(incremental.rootNode.hasError).toBe(false);
    expectEquivalent(incremental, fresh, query);
    expect(incremental.rootNode.descendantsOfType('unit').map((node) => node.text)).toEqual([
      value.includes('/') ? 'px' : 'url',
    ]);
    const restored = edit(incremental, changed, index, 1, tail);
    const undo = parser.parse(restored, incremental)!;
    const freshUndo = freshParser.parse(firstSource)!;
    trees.push(undo, freshUndo);
    expectEquivalent(undo, freshUndo, query);
    expect(undo.rootNode.descendantsOfType('unit')).toHaveLength(0);
    const originalSource = edit(undo, restored, firstIndex, 1, '');
    const undoFirst = parser.parse(originalSource, undo)!;
    const freshOriginal = freshParser.parse(source)!;
    trees.push(undoFirst, freshOriginal);
    expectEquivalent(undoFirst, freshOriginal, query);
    if (prefix) {
      let previous = undoFirst;
      for (const includedRanges of [[range(source, prefix.length, source.length)], [range(source, 0, source.length)]]) {
        const ranged = parser.parse(source, previous, { includedRanges })!;
        const freshRanged = freshParser.parse(source, undefined, { includedRanges })!;
        trees.push(ranged, freshRanged);
        expect(parser.getIncludedRanges()).toEqual(includedRanges);
        expect(freshParser.getIncludedRanges()).toEqual(includedRanges);
        expectEquivalent(ranged, freshRanged, query);
        previous = ranged;
      }
    }
  } finally {
    for (const tree of trees) tree.delete();
    query.delete();
    freshParser.delete();
    parser.delete();
  }
});

test('successive edits to adjacent number-name tails retain fresh trees and highlights', () => {
  const source = 'a { b: 0from-x 0from-x; }';
  const parser = new Parser().setLanguage(language);
  const freshParser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const original = parser.parse(source)!;
  const firstIndex = source.indexOf('from-x');
  const firstSource = edit(original, source, firstIndex, 1, 'x');
  const first = parser.parse(firstSource, original)!;
  const index = firstSource.lastIndexOf('from-x') + 1;
  const changed = edit(first, firstSource, index, 0, '{');
  const incremental = parser.parse(changed, first)!;
  const fresh = freshParser.parse(changed)!;
  const trees = [original, first, incremental, fresh];
  try {
    expectEquivalent(incremental, fresh, query);
    const restored = edit(incremental, changed, index, 1, '');
    const undo = parser.parse(restored, incremental)!;
    const freshUndo = freshParser.parse(firstSource)!;
    trees.push(undo, freshUndo);
    expectEquivalent(undo, freshUndo, query);
    const originalSource = edit(undo, restored, firstIndex, 1, 'f');
    const undoFirst = parser.parse(originalSource, undo)!;
    const freshOriginal = freshParser.parse(source)!;
    trees.push(undoFirst, freshOriginal);
    expectEquivalent(undoFirst, freshOriginal, query);
  } finally {
    for (const tree of trees) tree.delete();
    query.delete();
    freshParser.delete();
    parser.delete();
  }
});

test.each(
  ['foo ', 'foo/**/', 'f(x)'].flatMap((component) =>
    ['\n', '\r\n'].flatMap((newline) => ['', '/* Ω🙂 */ '].map((prefix) => [component, newline, prefix]))
  )
)('declaration line comments keep their body through edits and undo: %j %j %j', (component, newline, prefix) => {
  const source = `${prefix}a { x: 1${newline}${component}// { };${newline}bar; } .after {}`;
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const original = parser.parse(source)!;
  const commentIndex = source.indexOf('// {');
  const commentEnd = source.indexOf('\n', commentIndex);
  const trees = [original];
  try {
    expect(original.rootNode.hasError).toBe(false);
    expect(
      original.rootNode.descendantsOfType('js_comment').map((node) => [node.text, node.startIndex, node.endIndex])
    ).toEqual([[source.slice(commentIndex, commentEnd), commentIndex, commentEnd]]);
    expect(original.rootNode.descendantsOfType('declaration')[0]?.text).toBe(
      `x: 1${newline}${component}// { };${newline}bar;`
    );
    expect(original.rootNode.lastNamedChild?.text).toBe('.after {}');
    const changed = edit(original, source, commentIndex, 0, 'word');
    const incremental = parser.parse(changed, original)!;
    const fresh = parser.parse(changed)!;
    trees.push(incremental, fresh);
    expectEquivalent(incremental, fresh, query);
    const restored = edit(incremental, changed, commentIndex, 'word'.length, '');
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
  ['1', '#abc'].flatMap((value) =>
    ['/**/', '/**/ /**/\n'].flatMap((extra) =>
      ['; }', ' }'].flatMap((ending) => [' other', '\n :hover {}'].map((inserted) => [value, extra, ending, inserted]))
    )
  )
)(
  'editing a declaration then its comment tail matches fresh parsing: %j %j %j %j',
  (value, extra, ending, inserted) => {
    const source = `/* Ω🙂 */ a { x: ${value}${extra}${ending} .after { z: y; }`;
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const original = parser.parse(source)!;
    const trees = [original];
    try {
      expect(original.rootNode.hasError).toBe(false);
      const firstIndex = source.indexOf('x:');
      const property = 'other-property';
      const firstSource = edit(original, source, firstIndex, 1, property);
      const first = parser.parse(firstSource, original)!;
      trees.push(first);
      const index = firstSource.indexOf(ending);
      const changed = edit(first, firstSource, index, 0, inserted);
      const incremental = parser.parse(changed, first)!;
      const fresh = parser.parse(changed)!;
      trees.push(incremental, fresh);
      expectEquivalent(incremental, fresh, query);
      const restored = edit(incremental, changed, index, inserted.length, '');
      const undo = parser.parse(restored, incremental)!;
      const freshUndo = parser.parse(firstSource)!;
      trees.push(undo, freshUndo);
      expectEquivalent(undo, freshUndo, query);
      const originalSource = edit(undo, restored, firstIndex, property.length, 'x');
      const undoFirst = parser.parse(originalSource, undo)!;
      const freshOriginal = parser.parse(source)!;
      trees.push(undoFirst, freshOriginal);
      expectEquivalent(undoFirst, freshOriginal, query);
      expect(undoFirst.rootNode.hasError).toBe(false);
    } finally {
      for (const tree of trees) tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

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
