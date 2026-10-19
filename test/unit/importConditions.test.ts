import path from 'node:path';
import fs from 'node:fs';
import { expect, test } from 'vitest';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { testCommand } from './run.js';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each([
  ['url(x)', 'layer(theme)', 'supports(display: grid)', 'screen'],
  ['"x"', 'layer(framework.component)', '', ''],
  ['"x"', 'layer', '', 'screen and (width > 30px)'],
  ['"x"', 'layer()', 'supports((display: grid) and (color: red))', 'print, screen'],
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
  ['display', '--theme-color', '--日本', '--😀', String.raw`\64 isplay`, String.raw`--\74 heme`].flatMap((property) =>
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

test.each(['1', '123px', '#item', 'display 1', 'display /**/ 1 /**/'])(
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
  'native support-property highlights preserve Unicode and escaped names',
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
      ]);
    },
  }
);
