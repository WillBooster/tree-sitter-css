import path from 'node:path';
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { testCommand } from './run.js';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each([
  ['url(x)', 'layer(theme)', 'supports(display: grid)', 'screen'],
  ['"x"', 'layer(framework.component)', '', ''],
  ['"x"', 'layer', '', 'screen and (width > 30px)'],
  ['"x"', 'layer(theme)', 'supports((display: grid) and (color: red))', 'print, screen'],
  ['"x"', '', 'supports(selector(:has(.a)))', ''],
  ['"x"', 'LAYER(theme)', 'SUPPORTS(display: grid)', 'screen'],
  ['"x"', String.raw`l\61 yer(theme)`, String.raw`s\75 pports(display: grid)`, ''],
])('import conditions retain their boundaries: %s %s %s %s', (url, layer, supports, media) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const source = `@import ${url} ${layer} ${supports} ${media};`;
  const tree = parser.parse(`${source} .after { color: red; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const statement = tree.rootNode.firstNamedChild!;
    expect(statement.type).toBe('import_statement');
    expect(statement.text).toBe(source);
    expect(statement.descendantsOfType('import_layer').map((node) => node.text)).toEqual(layer ? [layer] : []);
    expect(statement.descendantsOfType('import_supports').map((node) => node.text)).toEqual(supports ? [supports] : []);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['supports', 'screen and (width > 30px)', 'print, screen', 'layered'])(
  'ordinary import media queries remain structured: %s',
  (media) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(`@import "x" ${media};`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const statement = tree.rootNode.firstNamedChild!;
      expect(statement.type).toBe('import_statement');
      expect(statement.descendantsOfType('import_layer')).toHaveLength(0);
      expect(statement.descendantsOfType('import_supports')).toHaveLength(0);
      expect(statement.descendantsOfType('keyword_query').length).toBeGreaterThan(0);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(['/**/', ' ', '/* layer boundary */\n'])(
  'comments and whitespace separate anonymous layers from media features: %s',
  (separator) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(`@import "x" layer${separator}(width: 10px); .after { color: red; }`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const statement = tree.rootNode.firstNamedChild!;
      expect(statement.type).toBe('import_statement');
      expect(statement.descendantsOfType('import_layer').map((node) => node.text)).toEqual(['layer']);
      expect(statement.descendantsOfType('feature_query').map((node) => node.text)).toEqual(['(width: 10px)']);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test('import conditions expose public keyword, function, layer, and property captures', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const tree = parser.parse('@import "x" layer(theme.base) supports(display: grid); @import "y" layer;')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => ['keyword', 'function', 'property'].includes(name))
        .map(({ name, node }) => [name, node.text])
    ).toEqual([
      ['keyword', '@import'],
      ['function', 'layer('],
      ['property', 'theme'],
      ['property', 'base'],
      ['function', 'supports('],
      ['property', 'display'],
      ['keyword', '@import'],
      ['keyword', 'layer'],
    ]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  [
    'display',
    '--theme-color',
    '--日本',
    '--😀',
    String.raw`\64 isplay`,
    String.raw`--\74 heme`,
    String.raw`\A9 `,
    String.raw`--\2192 `,
  ].flatMap((property) =>
    ['', '/**/', '/* first *//* second */'].flatMap((comment) =>
      [false, true].map((parenthesized) => [property, comment, parenthesized] as const)
    )
  )
)(
  'support property captures survive comments and identifier spelling: %s %s %s',
  (property, comment, parenthesized) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
    );
    const declaration = `${property}${comment}:${comment} initial`;
    const tree = parser.parse(`@import "x" supports(${parenthesized ? `(${declaration})` : declaration});`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(
        query
          .captures(tree.rootNode)
          .filter(({ name }) => name === 'property')
          .map(({ node }) => node.text)
      ).toEqual([property]);
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each(['1', '123px', '#item', 'display 1', 'display /**/ 1 /**/', '©', '--©', 'a→', '--\uE000', '×'])(
  'support properties do not cross non-comment components or accept non-identifiers: %s',
  (prefix) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8')
    );
    const tree = parser.parse(`@import "x" supports(${prefix}: grid);`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(query.captures(tree.rootNode).filter(({ name }) => name === 'property')).toHaveLength(0);
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  }
);

test.each(['', ' ', '/**/', '/* first *//* second */'])(
  'empty support conditions report an error and retain the following rule: %j',
  (body) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(`@import "x" supports(${body}); .after { color: red; }`)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.lastNamedChild?.type).toBe('rule_set');
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

testCommand(
  'native import property highlights preserve Unicode, escapes and layer names',
  [
    'script/tree-sitter',
    'highlight',
    'test/fixtures/importSupportProperties.css',
    '--query-paths',
    'queries/highlights.scm',
    '--html',
    '--style',
    'minimal',
    '--layout',
    'fragment',
  ],
  900_000,
  {
    check: (output) => {
      expect([...output.matchAll(/class=['"]property['"]>([^<]*)/g)].map((match) => match[1])).toEqual([
        '--😀',
        '--theme',
        String.raw`\64 isplay`,
        'theme',
        'component',
        String.raw`th\65 me`,
        '日本',
        String.raw`\A9 `,
        String.raw`--\2192 `,
      ]);
    },
  }
);

test.each(
  [
    '--',
    String.raw`\--`,
    String.raw`-\-`,
    String.raw`\-\-`,
    String.raw`\2d\2d`,
    String.raw`\00002d\00002d`,
    String.raw`\2d -`,
    String.raw`-\2d `,
  ].flatMap((property) => [false, true].map((parenthesized) => [property, parenthesized] as const))
)('reserved double-hyphen names do not acquire property captures: %s %s', (property, parenthesized) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const declaration = `${property}: initial`;
  const tree = parser.parse(`@import "x" supports(${parenthesized ? `(${declaration})` : declaration}); .after {}`)!;
  try {
    expect(query.captures(tree.rootNode.firstNamedChild!).filter(({ name }) => name === 'property')).toHaveLength(0);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(['layer()', 'layer( )', 'layer(/**/)', 'LAYER()', String.raw`l\61 yer()`, 'layer(\n)'])(
  'empty layer function names report errors and preserve following rules: %s',
  (layer) => {
    const parser = new Parser().setLanguage(language);
    const source = `@import "x" ${layer}; .after { color: red; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([
  'supports(display: grid',
  'supports((display: grid)',
  'supports(selector(:has(.a))',
  'supports(--theme: { color: red; }',
  'SUPPORTS(display: grid',
  String.raw`s\75 pports(display: grid`,
  'layer supports(display: grid',
])('unterminated import conditions retain following rules: %s', (condition) => {
  const parser = new Parser().setLanguage(language);
  const following = ['.first { color: red; }', '.after { background: blue; }'];
  const source = `@import "x" ${condition}; ${following.join(' ')}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const rules = tree.rootNode.namedChildren.filter((node) => node.type === 'rule_set');
    expect(rules.map((node) => node.text)).toEqual(following);
    for (const rule of rules) expect(rule.startIndex).toBe(source.indexOf(rule.text));
    expect(rules.flatMap((node) => node.descendantsOfType('property_name').map((property) => property.text))).toEqual([
      'color',
      'background',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  '--theme: { color: red; padding: 1px; }',
  '--theme: [a;b]',
  '--theme: fn(a;b)',
  '(--theme: { a: b; })',
  '(display: grid) and (--theme: { a: b; })',
  'future({a:b;})',
])('balanced import support values retain nested delimiters: %s', (body) => {
  const parser = new Parser().setLanguage(language);
  const condition = `supports(${body})`;
  const source = `@import "x" ${condition}; .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.descendantsOfType('import_supports').map((node) => node.text)).toEqual([
      condition,
    ]);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'a .b',
  'a. b',
  'a . b',
  'a\n.b',
  'a.\tb',
  'a/**/ .b',
  'a. /**/b',
  'a./**/ b',
  'a /**/.b',
  'a.\n/**/b',
  'a. /**//**/b',
  String.raw`a\2e  .b`,
])('layer name separators reject whitespace and retain following rules: %s', (name) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import "x" layer(${name}); .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ['theme .b', '.b'],
  ['theme/**/ .b', '.b'],
  ['theme\n.b', '.b'],
  [String.raw`th\65 me .b`, '.b'],
  ['a.b .c', '.c'],
  ['a.b/**/ .c', '.c'],
  ['a.b\n.c', '.c'],
])('unterminated layer names do not absorb the next selector: %s', (prefix, selector) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import "x" layer(${prefix} { color: red; } .after { background: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const following = tree.rootNode.namedChildren.filter((node) => node.type === 'rule_set');
    expect(following.map((node) => node.text)).toEqual([`${selector} { color: red; }`, '.after { background: blue; }']);
    for (const rule of following) expect(rule.startIndex).toBe(source.indexOf(rule.text));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ['a.b', ['a', 'b']],
  ['a/**/.b', ['a', 'b']],
  ['a./**/b', ['a', 'b']],
  ['a/**/./**/b', ['a', 'b']],
  ['a/*\n*/./**/b.c', ['a', 'b', 'c']],
  [String.raw`th\65 me./**/component`, [String.raw`th\65 me`, 'component']],
  ['--theme./**/日本', ['--theme', '日本']],
])('layer names retain tight components and comment nodes: %s', (name, components) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const source = `@import "x" layer(${name}); .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const layer = tree.rootNode.descendantsOfType('layer_name')[0]!;
    expect(layer.text).toBe(name);
    expect(layer.descendantsOfType('identifier').map((node) => node.text)).toEqual(components);
    expect(layer.descendantsOfType('comment').map((node) => node.text)).toEqual(name.match(/\/\*[\s\S]*?\*\//g) ?? []);
    expect(
      query
        .captures(layer)
        .filter(({ name }) => name === 'property')
        .map(({ node }) => node.text)
    ).toEqual(components);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each([
  [' a.b', 'a.b'],
  ['/**/a.b', 'a.b'],
  [' /**/ a.b', 'a.b'],
  ['\n a/**/.b\n', 'a/**/.b'],
  ['a.b ', 'a.b'],
  ['a.b/**/', 'a.b'],
  [String.raw`a\2e .b`, String.raw`a\2e .b`],
  ['--😀.日本', '--😀.日本'],
])('layer name outer trivia and escape terminators preserve boundaries: %s', (body, name) => {
  const parser = new Parser().setLanguage(language);
  const condition = `layer(${body})`;
  const source = `@import "x" ${condition}; .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('import_layer').map((node) => node.text)).toEqual([condition]);
    expect(tree.rootNode.descendantsOfType('layer_name').map((node) => node.text)).toEqual([name]);
    expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual(
      body.match(/\/\*[\s\S]*?\*\//g) ?? []
    );
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['supports(display: grid', 'SUPPORTS(display: grid', String.raw`s\75 pports(display: grid`])(
  'EOF-unclosed imports regain following rules when completed: %s',
  (condition) => {
    expectUnfinishedImportCompletion(condition);
  }
);

test.each(
  ['supports', 'SUPPORTS', String.raw`s\75 pports`, 'layer(theme) supports'].flatMap((keyword) =>
    ['"', "'"].map((quote) => `${keyword}(--theme: ${quote}dark${quote};)`)
  )
)('malformed quoted support bodies retain later complete rules: %s', (condition) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import "x" ${condition}\nbody { color: red; }\n.after { background: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.lastNamedChild?.type).toBe('rule_set');
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { background: blue; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.lastNamedChild?.descendantsOfType('property_name').map((node) => node.text)).toEqual([
      'background',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ...['supports', 'SUPPORTS', String.raw`s\75 pports`, 'layer(theme) supports'].flatMap((keyword) =>
    ['"', "'"].map((quote) => `${keyword}(--theme: ${quote}dark${quote}`)
  ),
  'supports(--theme: { color: red; }',
  'supports(future({ color: red; })',
])('EOF-unclosed component bodies regain following rules when completed: %s', (condition) => {
  expectUnfinishedImportCompletion(condition);
});

test.each([
  '--theme: prefix {a:b;} suffix',
  '--theme: {a:b;} {c:d;}',
  String.raw`--theme: ") ; {" {a:b;}`,
  String.raw`--theme: \) {a:b;}`,
  '--theme: fn([a;{b:c;}]) /* ) ; */ {d:e;}',
  'background: url(https://example.test/image.svg)',
  'background: url(//example.test/image.svg)',
  String.raw`background: u\72 l(https://example.test/image.svg)`,
  'background: URL(https://example.test/image.svg)',
  '--theme: {a:b;} url(https://example.test/image.svg)',
  '--theme: future(a // ) comment\n b) {c:d;}',
])('complete support values preserve balanced braces at any position: %s', (body) => {
  const parser = new Parser().setLanguage(language);
  const condition = `supports(${body})`;
  const source = `@import "x" ${condition}; .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('import_supports').map((node) => node.text)).toEqual([condition]);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['initial', 'inherit', 'unset', 'revert', 'revert-layer', 'revert-rule'].flatMap((keyword) =>
    [
      keyword,
      keyword.toUpperCase(),
      `\\${keyword[0]}${keyword.slice(1)}`,
      `\\${keyword.codePointAt(0)!.toString(16)} ${keyword.slice(1)}`,
    ].flatMap((spelling) =>
      [spelling, `theme.${spelling}`, `${spelling}.theme`].map((name) => [keyword, spelling, name] as const)
    )
  )
)('CSS-wide keywords are reserved in every decoded layer component: %s %s %s', (keyword, spelling, name) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const source = `@import "x" layer(${name}); .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name: capture, node }) => capture === 'property' && node.text === spelling)
    ).toHaveLength(0);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each([
  'default',
  'initially',
  'inherit-theme',
  'unset0',
  'reverted',
  'revert-layers',
  'revert-rules',
  String.raw`\A9 `,
  String.raw`theme\2192 `,
  String.raw`\E000 `,
  '--initial',
  String.raw`initial\0 `,
])('non-reserved layer names retain their complete components: %s', (name) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import "x" layer(${name}); .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('layer_name').map((node) => node.text)).toEqual([name]);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['©', '→', '…', '—', '\uE000', '\u00A0'].flatMap((character) => [
    character,
    `theme${character}`,
    `theme.${character}`,
  ])
)('literal non-identifier codepoints do not form valid layer names: %s', (name) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import "x" layer(${name}); .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  '})',
  '])',
  ' })',
  '}a)',
  '}) ',
  '))',
  ')a)',
  '){',
  '/**/})',
  '/**/))',
  '\t]a)',
  '(])',
  'a(])',
  '/**/(])',
  '(})',
  'a(})',
  '/**/(})',
  '[))',
  '/**/[))',
  '[})',
  '/**/[})',
  '{))',
  '/**/{))',
  '{])',
  '/**/{])',
  '--x: {a])',
  '{a])',
  '{a:b])',
  '[a})',
  '(a])',
  '{])a',
  '{]) )',
  'a)[[)',
  'a) [[)',
  'a) /**/[[)',
  'a).',
  'a) ?',
  'a) #',
  'a),',
  '[)))',
  '/**/[)))',
  '[}))',
  '/**/[}))',
  '{)))',
  '/**/{)))',
  '{]))',
  '/**/{]))',
])('malformed support closers retain later rules: %s', (body) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import "x" supports(${body}\nbody { color: red; }\n.after { background: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const following = tree.rootNode.lastNamedChild!;
    expect(following.type).toBe('rule_set');
    expect(following.text).toBe('.after { background: blue; }');
    expect(following.startIndex).toBe(source.indexOf('.after'));
    expect(following.descendantsOfType('property_name').map((node) => node.text)).toEqual(['background']);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['', 'layer(theme) '].flatMap((layer) =>
    ['', '/**/', '\n'].flatMap((gap) =>
      ['-foo', '--narrow', '-foo and (min-width: 100px)'].map((media) => [layer, gap, media] as const)
    )
  )
)('hyphen-prefixed media queries retain support conditions: %s supports(...) %s%s', (layer, gap, media) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import "x" ${layer}supports(display: grid) ${gap}${media}; .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const support = tree.rootNode.descendantsOfType('import_supports');
    expect(support).toHaveLength(1);
    expect(support[0]!.text).toBe('supports(display: grid)');
    expect(support[0]!.startIndex).toBe(source.indexOf('supports('));
    expect(support[0]!.endIndex).toBe(source.indexOf('supports(') + 'supports(display: grid)'.length);
    expect(tree.rootNode.descendantsOfType('import_statement')[0]!.text).toBe(source.slice(0, source.indexOf(';') + 1));
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('an unfinished support function after a named layer owns its EOF components', () => {
  const parser = new Parser().setLanguage(language);
  const source = '@import "x" layer(theme) supports(display: grid; .first { color: red; } .after { background: blue; }';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.firstNamedChild?.type).toBe('import_statement');
    expect(tree.rootNode.firstNamedChild?.text).toBe(source);
    expect(tree.rootNode.descendantsOfType('rule_set')).toHaveLength(0);
  } finally {
    tree.delete();
    parser.delete();
  }
  expectUnfinishedImportCompletion('layer(theme) supports(display: grid');
});

function expectUnfinishedImportCompletion(condition: string): void {
  const parser = new Parser().setLanguage(language);
  const prefix = `@import "x" ${condition}`;
  const following = ['body { color: red; }', '.after { background: blue; }'];
  const suffix = `\n${following.join('\n')}`;
  const tree = parser.parse(prefix + suffix)!;
  let completed;
  let fresh;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.firstNamedChild?.type).toBe('import_statement');
    expect(tree.rootNode.firstNamedChild?.text).toBe(prefix + suffix);
    expect(tree.rootNode.descendantsOfType('rule_set')).toHaveLength(0);
    tree.edit(
      new Edit({
        startIndex: prefix.length,
        oldEndIndex: prefix.length,
        newEndIndex: prefix.length + 2,
        startPosition: { row: 0, column: prefix.length },
        oldEndPosition: { row: 0, column: prefix.length },
        newEndPosition: { row: 0, column: prefix.length + 2 },
      })
    );
    const source = `${prefix});${suffix}`;
    completed = parser.parse(source, tree)!;
    fresh = parser.parse(source)!;
    expect(completed.rootNode.hasError).toBe(false);
    expect(completed.rootNode.toString()).toBe(fresh.rootNode.toString());
    expect(
      completed.rootNode.descendantsOfType('rule_set').map((node) => [node.text, node.startIndex, node.endIndex])
    ).toEqual(following.map((text) => [text, source.indexOf(text), source.indexOf(text) + text.length]));
  } finally {
    fresh?.delete();
    completed?.delete();
    tree.delete();
    parser.delete();
  }
}
