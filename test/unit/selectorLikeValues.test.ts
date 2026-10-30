import path from 'node:path';

import type { Node, Point, Range, Tree } from '@willbooster/web-tree-sitter';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const valueParts = [
  ['& ', ''],
  ['', ' * 1'],
] as const;

test.each(
  valueParts.flatMap(([before, after]) =>
    ['', '/* pad */ ', '/* Ω🙂\r\n */ '].flatMap((prefix) =>
      [' ', '\n', '\r\n', '\n/**/'].map(
        (gap) => `${prefix}a { --x: f(${before}alpha${after}${gap}${before}beta${after}); } .after { z: y; }`
      )
    )
  )
)('selector-like values parse without errors: %j', (source) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
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
])('selector-like values parse within included ranges: %j', ({ source, gap, hasError }) => {
  const parser = new Parser().setLanguage(language);
  const start = source.indexOf(gap);
  const end = start + gap.length;
  const tree = parser.parse(source, undefined, {
    includedRanges: [range(source, 0, start), range(source, end, source.length)],
  })!;
  try {
    expect(tree.rootNode.hasError).toBe(hasError);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('independent parses cannot retain selector-like value lookahead from the preceding input', () => {
  const parser = new Parser().setLanguage(language);
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
        expectEquivalent(reused, fresh);
        expect(reused.rootNode.hasError).toBe(iteration % sources.length !== 0);
      } finally {
        reused.delete();
        fresh.delete();
        other.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test.each(
  ['', '/* Ω🙂 */ ', '/* Ω🙂\n */ ', '/* Ω🙂\r\n */ '].flatMap((prefix) =>
    ['12px/1.5', '.5px/1.5', '1e2px/1.5', '1url(x)', '.5url(x)', '1e2url(x)'].map((value) => [prefix, value])
  )
)('the character after a numeric unit decides the unit: %j %s', (prefix, value) => {
  const tail = value.includes('/') ? '/' : '(x)';
  const joined = `${prefix}a { xmargin: 0 ${value} Arial }`;
  const separated = `${prefix}a { xmargin: 0 ${value.replace(tail, ' ')} Arial }`;
  const parser = new Parser().setLanguage(language);
  const joinedTree = parser.parse(joined)!;
  const separatedTree = parser.parse(separated)!;
  try {
    expect(joinedTree.rootNode.descendantsOfType('unit')).toHaveLength(0);
    expect(separatedTree.rootNode.hasError).toBe(false);
    expect(separatedTree.rootNode.descendantsOfType('unit').map((node) => node.text)).toEqual([
      value.includes('/') ? 'px' : 'url',
    ]);
  } finally {
    joinedTree.delete();
    separatedTree.delete();
    parser.delete();
  }
});

test.each(
  ['foo ', 'foo/**/', 'f(x)'].flatMap((component) =>
    ['\n', '\r\n'].flatMap((newline) => ['', '/* Ω🙂 */ '].map((prefix) => [component, newline, prefix]))
  )
)('declaration line comments keep their body: %j %j %j', (component, newline, prefix) => {
  const source = `${prefix}a { x: 1${newline}${component}// { };${newline}bar; } .after {}`;
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  const commentIndex = source.indexOf('// {');
  const commentEnd = source.indexOf('\n', commentIndex);
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(
      tree.rootNode.descendantsOfType('js_comment').map((node) => [node.text, node.startIndex, node.endIndex])
    ).toEqual([[source.slice(commentIndex, commentEnd), commentIndex, commentEnd]]);
    expect(tree.rootNode.descendantsOfType('declaration')[0]?.text).toBe(
      `x: 1${newline}${component}// { };${newline}bar;`
    );
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['1', '#abc'].flatMap((value) =>
    ['/**/', '/**/ /**/\n'].flatMap((extra) => ['; }', ' }'].map((ending) => [value, extra, ending]))
  )
)('declarations with comment tails parse without errors: %j %j %j', (value, extra, ending) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(`/* Ω🙂 */ a { x: ${value}${extra}${ending} .after { z: y; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['', '/**/', '\n'].flatMap((gap) =>
    ['word', 'url(x)'].flatMap((value) => [';', ''].map((ending) => ({ gap, value, ending })))
  )
)(
  'a comma after !important stays in one custom-property declaration: $gap $value $ending',
  ({ gap, value, ending }) => {
    const parser = new Parser().setLanguage(language);
    const plain = parser.parse(`a { --x: !important${gap} ${value}${ending} } .after { z: y; }`)!;
    const comma = parser.parse(`a { --long-name: !important,${gap} ${value}${ending} } .after { z: y; }`)!;
    try {
      expect(plain.rootNode.hasError).toBe(false);
      expect(comma.rootNode.hasError).toBe(false);
      expect(comma.rootNode.firstNamedChild!.descendantsOfType('declaration')).toHaveLength(1);
    } finally {
      plain.delete();
      comma.delete();
      parser.delete();
    }
  }
);

test.each(
  ['x', '--x'].flatMap((property) =>
    ['#abc', '#item', String.raw`#a\62 c`].flatMap((hash) =>
      [
        '',
        ' // note\n',
        ' // note\r\n',
        ' /**/ // note\n',
        '/**/ // note\r\n',
        ' // a\n// b\n',
        ' <!-- // note\n',
        ' --> // note\r\n',
        '/**/<!-- // note\n',
        ' /**/ // a\n// b\n',
      ].flatMap((gap) => [';', ''].map((ending) => ({ property, hash, gap, ending })))
    )
  )
)(
  'hash values before unfinished and closed comments parse without errors: $property $hash $gap $ending',
  ({ property, hash, gap, ending }) => {
    const parser = new Parser().setLanguage(language);
    try {
      for (const [name, comment] of [
        [property, '/*2'],
        ['--long-property', '/*2'],
        ['--long-property', '/*2*/'],
      ]) {
        const source = `a { ${name}: ${hash}${gap}${comment}${ending} } .after { z: y; }`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  }
);

test.each([
  ...['*margin', 'margin', '*x', 'x'].flatMap((property) =>
    ['0 auto', '1 +', '1 2', '1,2', '#abc', '!important'].flatMap((value) =>
      [' /* ie7 */ ', ' /**/ /**/\n', ''].map((gap) => ({
        prefix: '/* Ω🙂 */ .a { ',
        property,
        colonSpace: ' ',
        value,
        gap,
        suffix: ' .after { z: y; }',
      }))
    )
  ),
  ...['a{', 'a { ', '.a{', '.a { '].flatMap((prefix) =>
    ['a', '*a'].flatMap((property) =>
      ['1px, 2px', '0px, 1px, 2px'].flatMap((value) =>
        [' /**/ ', '/**/'].flatMap((gap) =>
          ['', ' .after { z: y; }'].map((suffix) => ({
            prefix,
            property,
            colonSpace: '',
            value,
            gap,
            suffix,
          }))
        )
      )
    )
  ),
])(
  'final declaration tails parse without errors: $prefix $property $value $gap $suffix',
  ({ prefix, property, colonSpace, value, gap, suffix }) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(`${prefix}${property}:${colonSpace}${value}${gap}}${suffix}`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(
  ['--x', '--😀', String.raw`\2d\2d x`].flatMap((property) =>
    [
      { extra: '/**/', comments: ['/**/'] },
      { extra: '/**/ /**/', comments: ['/**/', '/**/'] },
      { extra: '<!--', comments: [] },
      { extra: '// note\rbody\n', comments: ['// note\rbody'] },
    ].flatMap(({ extra, comments }) => [false, true].map((block) => ({ property, extra, comments, block })))
  )
)('empty final checkpoints retain extras: $property $extra block=$block', ({ property, extra, comments, block }) => {
  const declaration = `${property}:`;
  const source = block ? `a { ${declaration}${extra}} .after { z: y; }` : `${declaration}${extra}`;
  const index = block ? source.indexOf('}') : source.length;
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  const continued = parser.parse(`${source.slice(0, index)} word${source.slice(index)}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const empty = tree.rootNode.descendantsOfType('declaration')[0]!;
    expect(empty.text).toBe(declaration);
    expect(empty.endIndex).toBe(source.indexOf(declaration) + declaration.length);
    const extras = tree.rootNode.descendantsOfType(['comment', 'js_comment']);
    expect(extras.map((node) => node.text)).toEqual(comments);
    expect(extras.map((node) => node.parent!.type)).toEqual(comments.map(() => (block ? 'block' : 'stylesheet')));
    expect(continued.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
    continued.delete();
    parser.delete();
  }
});

test.each(
  ['x', '--x'].flatMap((property) =>
    ['1', 'foo', '#abc', '1px, 2px'].flatMap((value) => [
      ...['; ', '} ', '{ ', '@media screen {b{y:z}} ', '" ', '/* ', ''].map((payload) => ({
        property,
        value,
        comment: `// comment\r${payload}`,
      })),
      { property, value, comment: '// comment' },
    ])
  )
)('carriage returns remain inside standalone value comments: %j', ({ property, value, comment }) => {
  const source = `a { ${property}: ${value} ${comment}\n 2; } .after {}`;
  const index = source.indexOf('\n');
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  const split = parser.parse(`${source.slice(0, index)}} ; {${source.slice(index)}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const declaration = tree.rootNode.firstNamedChild!.descendantsOfType('declaration')[0]!;
    expect(declaration.descendantsOfType('js_comment').map((node) => node.text)).toEqual([comment]);
    expect(declaration.descendantsOfType('integer_value').at(-1)?.text).toBe('2');
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
    expect(split.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
    split.delete();
    parser.delete();
  }
});

test.each(
  ['a', '--x'].flatMap((property) =>
    [String.raw`\66 oo(x)`, String.raw`\31 xf(x)`, String.raw`f\6f o(x)`].flatMap((value) =>
      ['/* c */\n', ' // c\n', ' /*c*/ ', '/**/\r\n'].flatMap((gap) =>
        ['@media screen', '@supports (a:b)'].map((prelude) => ({ property, value, gap, prelude }))
      )
    )
  )
)('escaped function-shaped values retain following rules: %j', ({ property, value, gap, prelude }) => {
  const source = `/* Ω🙂 */ x { ${property}: ${value}${gap}${prelude} { c: d } }\n.after { e: f }`;
  const index = source.indexOf(value) + value.length;
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  const complete = parser.parse(`${source.slice(0, index)};${source.slice(index)}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const rules = tree.rootNode.namedChildren.filter((node) => node.type === 'rule_set');
    expect(rules).toHaveLength(2);
    expect(rules[0]!.endIndex).toBe(source.indexOf('\n.after'));
    expect(rules[1]!.text).toBe('.after { e: f }');
    const declaration = rules[0]!.descendantsOfType('declaration')[0]!;
    expect(
      declaration.namedChildren.some(
        (node) => node.type === 'plain_value' && node.text === value.slice(0, value.indexOf('('))
      )
    ).toBe(true);
    expect(declaration.descendantsOfType('parenthesized_value').map((node) => node.text)).toEqual(['(x)']);
    expect(declaration.descendantsOfType('call_expression')).toHaveLength(0);
    expect(complete.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
    complete.delete();
    parser.delete();
  }
});

function expectEquivalent(actual: Tree, expected: Tree): void {
  expect(snapshot(actual.rootNode)).toEqual(snapshot(expected.rootNode));
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

function range(source: string, startIndex: number, endIndex: number): Range {
  return { startIndex, endIndex, startPosition: point(source, startIndex), endPosition: point(source, endIndex) };
}

function point(source: string, index: number): Point {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}
