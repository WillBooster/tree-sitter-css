import fs from 'node:fs';
import path from 'node:path';
import type { Node, Point, Range, Tree } from '@willbooster/web-tree-sitter';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const highlights = fs.readFileSync(path.join(import.meta.dirname, '../../queries/highlights.scm'), 'utf8');
const preludes = [
  [':hover', 'rule_set'],
  ['::before', 'rule_set'],
  ['> b', 'rule_set'],
  ['~ b', 'rule_set'],
  ['|b', 'rule_set'],
  ['*', 'rule_set'],
  ['*:hover', 'rule_set'],
  ['+ b', 'rule_set'],
  ['#id', 'rule_set'],
  ['[x]', 'rule_set'],
  ['b', 'rule_set'],
  ['-b', 'rule_set'],
  ['.c', 'rule_set'],
  ['&', 'rule_set'],
  ['@media screen', 'media_statement'],
  ['@supports (display: grid)', 'supports_statement'],
  ['@layer theme', 'at_rule'],
  ['@container (width > 1px)', 'container_statement'],
] as const;
const declarationValues = [
  ['1px solid', ['1px'], ['solid']],
  ['1px + 2px', ['1px', '2px'], []],
  ['1 + 2', ['1', '2'], []],
  ['1px * 2px', ['1px', '2px'], []],
  ['1px / 2px', ['1px', '2px'], []],
] as const;

test.each(
  preludes.flatMap(([prelude, type]) =>
    declarationValues.flatMap(([value, numbers, plain]) =>
      ['\n  ', '\r\n  ', '\n/**/ ', '/* note */\n', ' <!--\n ', ' -->\n '].map(
        (gap) => [prelude, type, gap, value, numbers, plain] as const
      )
    )
  )
)(
  'missing semicolon retains the following %s node and its ranges: %s %s %s',
  (prelude, type, gap, value, numbers, plain) => {
    const parser = new Parser().setLanguage(language);
    const source = sourceFor(prelude, gap, value);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      const [outer, after] = tree.rootNode.namedChildren.filter((node) => node.type !== 'comment');
      expect(outer?.type).toBe('rule_set');
      expect(outer?.endIndex).toBe(source.indexOf('\n.after'));
      const block = outer!.namedChildren.find((node) => node.type === 'block')!;
      const children = block.namedChildren.filter((node) => node.type !== 'comment');
      expect(children.map((node) => node.type)).toEqual(['declaration', type]);
      expect(children[0]!.descendantsOfType('plain_value').map((node) => node.text)).toEqual(plain);
      expect(children[0]!.descendantsOfType('integer_value').map((node) => node.text)).toEqual(numbers);
      const nested = children[1]!;
      expect(nested.text).toBe(`${prelude} { c: d }`);
      expect(nested.startIndex).toBe(source.indexOf(`${prelude} { c: d }`, source.indexOf(value) + value.length));
      expect(nested.descendantsOfType('property_name').map((node) => [node.text, node.startIndex])).toEqual([
        ['c', source.indexOf('c: d')],
      ]);
      expect(after?.text).toBe('.after { color: blue; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(preludes)(
  'inserting and removing the semicolon before %s matches fresh tree ranges and highlights',
  (prelude) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const source = sourceFor(prelude, '\n/**/ ');
    const original = parser.parse(source)!;
    const index = source.indexOf('solid') + 'solid'.length;
    const complete = change(original, source, index, 0, ';');
    const incremental = parser.parse(complete, original)!;
    const fresh = new Parser().setLanguage(language);
    const completeFresh = fresh.parse(complete)!;
    const trees = [original, incremental, completeFresh];
    try {
      expect(incremental.rootNode.hasError).toBe(false);
      equivalent(incremental, completeFresh, query);
      const restored = change(incremental, complete, index, 1, '');
      const undo = parser.parse(restored, incremental)!;
      const undoFresh = fresh.parse(source)!;
      trees.push(undo, undoFresh);
      equivalent(undo, undoFresh, query);
      expect(undo.rootNode.hasError).toBe(true);
    } finally {
      for (const tree of trees) tree.delete();
      query.delete();
      parser.delete();
      fresh.delete();
    }
  }
);

const editedValues = [
  'alpha:beta:\n gamma:\n delta;',
  'alpha\n beta\n gamma;',
  'alpha/**/\n beta/**/\n gamma;',
  'alpha <!--\n beta -->\n gamma;',
  '1url(x\n )\n beta;',
  'https://example.com/a; color: red;',
  'http://x/**/\n* 1;',
  'b -/foo;',
  'f(1/**/px) f(a/**/(x));',
  '1\n + 2\n + 3;',
  'solid\n :hover { c: d }',
  '1px + 2px\n :hover { c: d }',
  '1 + 2\n .b { c: d }',
];

test.each(
  editedValues.flatMap((value) => {
    const source = `/* Ω🙂 */ a { x: ${value} } .after { z: y; }`;
    const boundary = source.indexOf(';', source.indexOf('x:'));
    return [
      [0, 0, ' '],
      [0, 0, '\n'],
      [3, 1, 'a'],
      [0, source.indexOf('a {'), ''],
      [source.indexOf('\n') + 1, 1, '{'],
      [boundary, 1, '}'],
    ].map(([index, removed, inserted]) => ({
      source,
      index: Number(index),
      removed: Number(removed),
      inserted: String(inserted),
    }));
  })
)(
  'declaration continuation remains fresh after prefix and lookahead edits: %j',
  ({ source, index, removed, inserted }) => {
    const parser = new Parser().setLanguage(language);
    const freshParser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const original = parser.parse(source)!;
    const changed = change(original, source, index, removed, inserted);
    const incremental = parser.parse(changed, original)!;
    const fresh = freshParser.parse(changed)!;
    const trees = [original, incremental, fresh];
    try {
      equivalent(incremental, fresh, query);
      const restored = change(incremental, changed, index, inserted.length, source.slice(index, index + removed));
      const undo = parser.parse(restored, incremental)!;
      const freshUndo = freshParser.parse(source)!;
      trees.push(undo, freshUndo);
      equivalent(undo, freshUndo, query);
    } finally {
      for (const tree of trees) tree.delete();
      query.delete();
      parser.delete();
      freshParser.delete();
    }
  }
);

test.each(editedValues)('declaration continuation remains fresh when included ranges change: %s', (value) => {
  const prefix = '/* Ω🙂 */ a { x: ';
  const excluded = '/* excluded */';
  const source = `${prefix}${excluded}${value} } .after { z: y; }`;
  const variants = [
    [range(source, 0, prefix.length), range(source, prefix.length + excluded.length, source.length)],
    [range(source, 0, source.length)],
  ];
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  let previous = parser.parse(source, undefined, { includedRanges: variants[0] })!;
  try {
    expect(parser.getIncludedRanges()).toEqual(variants[0]);
    for (let iteration = 0; iteration < 6; iteration++) {
      const includedRanges = variants[(iteration + 1) % 2];
      const incremental = parser.parse(source, previous, { includedRanges })!;
      const freshParser = new Parser().setLanguage(language);
      const fresh = freshParser.parse(source, undefined, { includedRanges })!;
      try {
        expect(parser.getIncludedRanges()).toEqual(includedRanges);
        expect(freshParser.getIncludedRanges()).toEqual(includedRanges);
        equivalent(incremental, fresh, query);
      } finally {
        previous.delete();
        fresh.delete();
        freshParser.delete();
        previous = incremental;
      }
    }
  } finally {
    previous.delete();
    query.delete();
    parser.delete();
  }
});

test('numeric and slash-prefixed components retain NUL source characters', () => {
  const source = 'a { x: 1px\0foo; y: /\0foo; z: http:/\0foo; } .after { z: y; }';
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const [numeric, slash, url] = tree.rootNode.firstNamedChild!.descendantsOfType('declaration');
    expect(numeric!.descendantsOfType('integer_value').map((node) => node.text)).toEqual(['1']);
    expect(numeric!.descendantsOfType('unit')).toHaveLength(0);
    for (const [node, components] of [
      [numeric!, ['px\0foo']],
      [slash!, ['/\0foo']],
      [url!, ['http', ':', '/\0foo']],
    ] as const) {
      const valueStart = source.indexOf(':', node.startIndex) + 1;
      expect(
        node
          .descendantsOfType('plain_value')
          .map((component) => [component.text, component.startIndex, component.endIndex])
      ).toEqual(
        components.map((text) => [
          text,
          source.indexOf(text, valueStart),
          source.indexOf(text, valueStart) + text.length,
        ])
      );
    }
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { z: y; }');
    expect(tree.rootNode.endIndex).toBe(source.length);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['b', '1px'].flatMap((left) => ['-/foo', '-//x'].map((right) => [left, right])))(
  'attached slash value after %s retains its component and highlight: %s',
  (left, right) => {
    const source = `a { color: ${left} ${right}; }`;
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const declaration = tree.rootNode.descendantsOfType('declaration')[0]!;
      expect(declaration.descendantsOfType('binary_expression')).toHaveLength(0);
      const component = declaration.namedChildren.at(-1)!;
      expect([component.type, component.text, component.startIndex, component.endIndex]).toEqual([
        'plain_value',
        right,
        source.indexOf(right),
        source.indexOf(right) + right.length,
      ]);
      expect(query.captures(tree.rootNode).filter(({ name }) => name === 'operator')).toHaveLength(0);
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each(['f(1/**/px)', '(1 /**/px)', '[1 /**/px]', 'calc(1 /**/ + 2/**/px)', 'f(a/**/(x))'])(
  'comments in nested values preserve sibling ownership: %s',
  (value) => {
    const source = `a { b: ${value}; }`;
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('unit')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('call_expression').map((node) => node.text)).toEqual(
        value.startsWith('f(') || value.startsWith('calc(') ? [value] : []
      );
      for (const comment of tree.rootNode.descendantsOfType('comment')) {
        expect(['arguments', 'parenthesized_value', 'grid_value', 'binary_expression']).toContain(comment.parent!.type);
        expect(comment.text).toBe('/**/');
        expect(source.slice(comment.startIndex, comment.endIndex)).toBe('/**/');
      }
      expect(query.captures(tree.rootNode).filter(({ name }) => name === 'type')).toHaveLength(0);
      if (value === 'f(a/**/(x))') {
        expect(tree.rootNode.descendantsOfType('parenthesized_value').map((node) => node.text)).toEqual(['(x)']);
        expect(tree.rootNode.descendantsOfType('function_name').map((node) => node.text)).toEqual(['f']);
      } else {
        expect(tree.rootNode.descendantsOfType('plain_value').map((node) => node.text)).toContain('px');
        expect(tree.rootNode.descendantsOfType('integer_value').map((node) => node.text)).toEqual(
          value.startsWith('calc(') ? ['1', '2'] : ['1']
        );
      }
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each(['*', '+', '/'])(
  'attached scheme comments preserve the following %s arithmetic node and highlight',
  (operator) => {
    const source = `a { --x: http://x/**/\n${operator} 1; }\n.after { c: d }`;
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const expressions = tree.rootNode.descendantsOfType('binary_expression');
      expect(expressions.map((node) => [node.text, node.startIndex])).toEqual([
        [`://x/**/\n${operator} 1`, source.indexOf('://x')],
      ]);
      expect(
        query
          .captures(tree.rootNode)
          .filter(({ name }) => name === 'operator')
          .map(({ node }) => [node.text, node.startIndex, node.endIndex])
      ).toEqual([[operator, source.indexOf(`\n${operator}`) + 1, source.indexOf(`\n${operator}`) + 2]]);
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after { c: d }');
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each(['https://example.com/a;', 'http://x.y/z', 'http://x.y/z, 1e3px;'])(
  'scheme-like value %s preserves its declaration and the following rule',
  (value) => {
    const source = `a { --u: ${value} }\n.after { c: d }`;
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const [outer, after] = tree.rootNode.namedChildren;
      expect(outer!.descendantsOfType('declaration').map((node) => node.text)).toEqual([`--u: ${value}`]);
      expect(after!.text).toBe('.after { c: d }');
      expect(after!.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(['red', '1px', '1 + 2', '1url(x)'].flatMap((value) => ['<!--', '-->'].map((marker) => [value, marker])))(
  'HTML marker extras after %s do not require another value: %s',
  (value, marker) => {
    const source = `a { --x: ${value} ${marker}; color: red; } .after {}`;
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
        `--x: ${value} ${marker};`,
        'color: red;',
      ]);
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after {}');
      expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(['\n', '/**/\n', ' <!--\n', ' -->\n'])(
  'multiline declaration values retain linear public input-read growth: %j',
  (gap) => {
    const parser = new Parser().setLanguage(language);
    const reads = (count: number): number => {
      const source = `a { font-family: ${`word${gap}`.repeat(count)}; }`;
      let calls = 0;
      const tree = parser.parse((offset) => {
        calls++;
        return source.slice(offset, offset + 32);
      })!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.descendantsOfType('plain_value')).toHaveLength(count);
        expect(tree.rootNode.endIndex).toBe(source.length);
        return calls;
      } finally {
        tree.delete();
      }
    };
    try {
      expect(reads(3200) / reads(800)).toBeLessThan(8);
    } finally {
      parser.delete();
    }
  }
);

function sourceFor(prelude: string, gap: string, value = '1px solid'): string {
  return `/* Ω🙂 */ a { border: ${value}${gap}${prelude} { c: d } }\n.after { color: blue; }`;
}

function equivalent(actual: Tree, expected: Tree, query: Query): void {
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
    node.children.map(snapshot),
  ];
}

function change(tree: Tree, before: string, index: number, removed: number, inserted: string): string {
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

function point(source: string, index: number): Point {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}

function range(source: string, startIndex: number, endIndex: number): Range {
  return { startIndex, endIndex, startPosition: point(source, startIndex), endPosition: point(source, endIndex) };
}
