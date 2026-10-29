import fs from 'node:fs';
import path from 'node:path';

import type { Point } from '@willbooster/web-tree-sitter';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
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
  ['@layer theme', 'layer_statement'],
  ['@container (width > 1px)', 'container_statement'],
] as const;
const declarationValues = [
  ['1px solid', ['1px'], ['solid']],
  ['1px + 2px', ['1px', '2px'], []],
  ['1 + 2', ['1', '2'], []],
  ['1px * 2px', ['1px', '2px'], []],
  ['1px / 2px', ['1px', '2px'], []],
] as const;

const callValues = [
  ['f(x)', [], ['x']],
  ['url(x)', [], []],
  ['var(--x)', [], ['--x']],
] as const;

test.each(
  preludes.flatMap(([prelude, type]) =>
    (type === 'rule_set' ? declarationValues : [...declarationValues, ...callValues]).flatMap(
      ([value, numbers, plain]) =>
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

test.each(
  preludes
    .filter(([, type]) => type === 'rule_set')
    .flatMap(([prelude]) =>
      callValues.flatMap(([value]) =>
        ['\n  ', '\r\n  ', '\n/**/ ', '/* note */\n', ' <!--\n ', ' -->\n '].map(
          (gap) => [prelude, value, gap] as const
        )
      )
    )
)('function-shaped pseudo selectors remain nested rules: %s %s %j', (prelude, value, gap) => {
  const source = sourceFor(prelude, gap, value);
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const [outer, after] = tree.rootNode.namedChildren.filter((node) => node.type !== 'comment');
    expect(outer!.endIndex).toBe(source.indexOf('\n.after'));
    const block = outer!.namedChildren.find((node) => node.type === 'block')!;
    const nested = block.namedChildren.filter((node) => node.type !== 'comment');
    expect(nested.map((node) => node.type)).toEqual(['rule_set']);
    expect(nested[0]!.text).toBe(`border: ${value}${gap}${prelude} { c: d }`);
    expect(nested[0]!.descendantsOfType('declaration').map((node) => node.text)).toEqual(['c: d']);
    expect(after!.text).toBe('.after { color: blue; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(preludes)('a missing semicolon before %s is an error that the semicolon removes', (prelude) => {
  const parser = new Parser().setLanguage(language);
  const source = sourceFor(prelude, '\n/**/ ');
  const index = source.indexOf('solid') + 'solid'.length;
  const missing = parser.parse(source)!;
  const complete = parser.parse(`${source.slice(0, index)};${source.slice(index)}`)!;
  try {
    expect(missing.rootNode.hasError).toBe(true);
    expect(complete.rootNode.hasError).toBe(false);
  } finally {
    missing.delete();
    complete.delete();
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

test.each(
  ['x', '--x'].flatMap((property) =>
    ['+', '-'].flatMap((operator) =>
      [' ', '/**/', '\n', ' /* c */\n '].flatMap((gap) => ['-', '-2'].map((tail) => [property, operator, gap, tail]))
    )
  )
)('consecutive declaration operators retain arithmetic ownership: %s %s %j %s', (property, operator, gap, tail) => {
  const value = `1 ${operator}${gap}${tail}`;
  const source = `a { ${property}: ${value}; }`;
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const declaration = tree.rootNode.descendantsOfType('declaration')[0]!;
    expect(declaration.descendantsOfType('binary_expression')).toHaveLength(tail === '-' ? 2 : 1);
    expect(declaration.descendantsOfType('integer_value').map((node) => node.text)).toEqual(
      tail === '-' ? ['1'] : ['1', '-2']
    );
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === 'operator')
        .map(({ node }) => [node.text, node.startIndex, node.endIndex])
    ).toEqual(
      tail === '-'
        ? [
            [operator, source.indexOf(value) + 2, source.indexOf(value) + 3],
            ['-', source.indexOf(';') - 1, source.indexOf(';')],
          ]
        : [[operator, source.indexOf(value) + 2, source.indexOf(value) + 3]]
    );
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  ['x', '--x'].flatMap((property) =>
    ['url(x)', '1'].flatMap((value) => ['\u0085', '\u2000', '\u2028', '\u2029'].map((gap) => [property, value, gap]))
  )
)('Unicode gaps preserve asterisk arithmetic and highlights: %s %s %j', (property, value, gap) => {
  const source = `a { ${property}: ${value}${gap} * 2; }`;
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const expression = tree.rootNode.descendantsOfType('binary_expression');
    expect(expression.map((node) => node.text)).toEqual([`${value}${gap} * 2`]);
    expect(tree.rootNode.descendantsOfType('plain_value')).toHaveLength(0);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === 'operator')
        .map(({ node }) => [node.text, node.startIndex, node.endIndex])
    ).toEqual([['*', source.indexOf('*'), source.indexOf('*') + 1]]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  ['x', '--x'].flatMap((property) =>
    ['\u0085', '\u2000', '\u2028', '\u2029'].flatMap((gap) =>
      ['x', 'f()', ' x', ' f()'].map((operand) => [property, gap, operand])
    )
  )
)('Unicode arithmetic retains attached operands: %s %j %s', (property, gap, operand) => {
  const source = `a { ${property}: 1${gap}*${operand}; }`;
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('binary_expression').map((node) => node.text)).toEqual([
      `1${gap}*${operand}`,
    ]);
    expect(tree.rootNode.descendantsOfType('function_name').map((node) => node.text)).toEqual(
      operand.includes('(') ? ['f'] : []
    );
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === 'operator')
        .map(({ node }) => [node.text, node.startIndex, node.endIndex])
    ).toEqual([['*', source.indexOf('*'), source.indexOf('*') + 1]]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(['x', '--x'].flatMap((property) => ['\n/**/', '\r\n/**/', '\n/*a*/', ' /**/'].map((gap) => [property, gap])))(
  'hash slash tails retain following function ownership across extras: %s %j',
  (property, gap) => {
    const source = `a { ${property}: #abc${gap}//f(); }`;
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const start = source.indexOf('//f');
      const tail = tree.rootNode.descendantsOfType('plain_value')[0]!;
      expect([tail.text, tail.startIndex, tail.endIndex]).toEqual(['//', start, start + 2]);
      expect(
        tree.rootNode.descendantsOfType('function_name').map((node) => [node.text, node.startIndex, node.endIndex])
      ).toEqual([['f', start + 2, start + 3]]);
      expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual([gap.trim()]);
      expect(
        query
          .captures(tree.rootNode)
          .filter(({ name }) => name === 'function')
          .map(({ node }) => [node.text, node.startIndex, node.endIndex])
      ).toEqual([['f', start + 2, start + 3]]);
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each(
  ['x', '--x'].flatMap((property) =>
    ['#abc', '#item'].flatMap((hash) =>
      ['<!--', '-->'].flatMap((marker) => ['//\n1', '//f()'].map((tail) => [property, hash, marker, tail]))
    )
  )
)('hash tails retain value ownership across HTML marker extras: %s %s %s %j', (property, hash, marker, tail) => {
  const source = `a { ${property}: ${hash} ${marker}${tail}; }`;
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const start = source.indexOf('//');
    const slash = tree.rootNode.descendantsOfType('plain_value')[0]!;
    expect([slash.text, slash.startIndex, slash.endIndex]).toEqual(['//', start, start + 2]);
    expect(tree.rootNode.descendantsOfType('js_comment')).toHaveLength(0);
    expect(tree.rootNode.descendantsOfType('function_name').map((node) => node.text)).toEqual(
      tail.endsWith('()') ? ['f'] : []
    );
    expect(query.captures(tree.rootNode).filter(({ name }) => name === 'comment')).toHaveLength(0);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  ['\u0085', '\u2000', '\u2028', '\u2029'].flatMap((separator) =>
    ['url(x)', '1', '1px'].map((value) => [separator, value])
  )
)('non-ASCII value components retain their ranges after %j: %s', (separator, value) => {
  const source = `a { x: ${value}${separator}; } .after { c: d; }`;
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const declaration = tree.rootNode.firstNamedChild!.descendantsOfType('declaration')[0]!;
    const scalar = value === 'url(x)' ? value : '1';
    const component = value === '1px' ? `px${separator}` : separator;
    expect(declaration.namedChildren.map((node) => [node.type, node.text])).toEqual([
      ['property_name', 'x'],
      [value === 'url(x)' ? 'url_value' : 'integer_value', scalar],
      ['plain_value', component],
    ]);
    const last = declaration.namedChildren.at(-1)!;
    const start = source.indexOf(value) + scalar.length;
    expect([last.startIndex, last.endIndex, last.startPosition, last.endPosition]).toEqual([
      start,
      start + component.length,
      point(source, start),
      point(source, start + component.length),
    ]);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { c: d; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
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

test.each(['/**/ /**/', '<!--/**/', '-->/**/', '/**/<!--'].flatMap((gap) => ['-a', '-2'].map((value) => [gap, value])))(
  'minus components after hash extras retain ownership: %s %s',
  (gap, value) => {
    const source = `a { --x: #abc ${gap}${value}; } .after {}`;
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const [outer, after] = tree.rootNode.namedChildren;
      expect(after!.text).toBe('.after {}');
      const component = outer!.descendantsOfType(value === '-a' ? 'plain_value' : 'integer_value').at(-1)!;
      const start = source.indexOf(value);
      expect([component.text, component.startIndex, component.endIndex]).toEqual([value, start, start + value.length]);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(['1px #abc//', '1 .c// z', '1 x:y// z', '1 @#a//'])(
  'delimiter slashes in a value preserve its closing brace and following rule: %s',
  (value) => {
    const source = `a { b: ${value}; }\n.after {}`;
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const [outer, after] = tree.rootNode.namedChildren;
      expect(outer!.text).toBe(`a { b: ${value}; }`);
      expect(outer!.descendantsOfType('declaration').map((node) => node.text)).toEqual([`b: ${value};`]);
      expect(after!.text).toBe('.after {}');
      expect(after!.startIndex).toBe(source.indexOf('.after'));
      expect(tree.rootNode.descendantsOfType('js_comment')).toHaveLength(0);
      expect(query.captures(tree.rootNode).filter(({ name }) => name === 'comment')).toHaveLength(0);
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test('a stray token between keyframes preserves both blocks and the enclosing statement', () => {
  const source = '@keyframes x { from { a: b } ) to { a: c } } .after {}';
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const [statement, after] = tree.rootNode.namedChildren;
    expect([statement!.type, statement!.text, statement!.startIndex, statement!.endIndex]).toEqual([
      'keyframes_statement',
      source.slice(0, source.indexOf(' .after')),
      0,
      source.indexOf(' .after'),
    ]);
    expect(statement!.descendantsOfType('keyframe_block').map((node) => node.text)).toEqual([
      'from { a: b }',
      'to { a: c }',
    ]);
    expect(statement!.descendantsOfType('ERROR').map((node) => [node.text, node.startIndex, node.endIndex])).toEqual([
      [')', source.indexOf(')'), source.indexOf(')') + 1],
    ]);
    expect(after!.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('removing a stray token between keyframes leaves no error', () => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse('@keyframes x { from { a: b }  to { a: c } } .after {}')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['#abc', '1px', 'f(x)'].flatMap((value) =>
    ['', ' '].flatMap((gap) =>
      [1, 4].flatMap((count) => ['}', ';}'].map((ending) => [value, gap, count, ending] as const))
    )
  )
)('trailing comments retain their declaration or block ownership: %s %j %i %s', (value, gap, count, ending) => {
  const source = `a { x: ${value}${gap}${'/**/ '.repeat(count)}${ending}`;
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const declaration = tree.rootNode.descendantsOfType('declaration')[0]!;
    const end = ending === '}' ? source.indexOf(value) + value.length : source.indexOf(';') + 1;
    expect([declaration.text, declaration.endIndex]).toEqual([source.slice(source.indexOf('x:'), end), end]);
    const comments = tree.rootNode.descendantsOfType('comment');
    expect(comments).toHaveLength(count);
    for (const comment of comments) {
      expect(comment.parent!.type).toBe(ending === '}' ? 'block' : 'declaration');
      expect(comment.text).toBe('/**/');
      expect(source.slice(comment.startIndex, comment.endIndex)).toBe('/**/');
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});

function sourceFor(prelude: string, gap: string, value = '1px solid'): string {
  return `/* Ω🙂 */ a { border: ${value}${gap}${prelude} { c: d } }\n.after { color: blue; }`;
}

function point(source: string, index: number): Point {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}
