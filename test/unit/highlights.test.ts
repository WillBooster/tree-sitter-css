import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));
const parser = new Parser();
parser.setLanguage(language);
const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));

test('semantic prelude highlights do not cross delimiter components', () => {
  const source =
    '@custom (!, important) (!; important) (!: important) (! important);\n' +
    '@custom (min-width, : 400px) (min-width: 400px) (https://cdn/x);';
  const tree = parser.parse(source);
  if (!tree) throw new Error('The parser returned no tree');
  expect(tree.rootNode.hasError).toBe(false);
  const captures = query
    .captures(tree.rootNode)
    .filter(({ name, node }) => name === 'property' || (name === 'keyword' && !node.text.startsWith('@')))
    .map(({ name, node }) => ({ name, text: node.text, start: node.startIndex }));
  expect(captures).toEqual([
    { name: 'keyword', text: '!', start: source.indexOf('! important') },
    { name: 'keyword', text: 'important', start: source.indexOf('! important') + 2 },
    { name: 'property', text: 'min-width', start: source.lastIndexOf('min-width') },
  ]);
  tree.delete();
});

test('container style queries expose and highlight property references', () => {
  const source = '@container card style((--theme: dark) and (--accent: fn(red, blue))) { a { color: red; } }';
  const tree = parser.parse(source);
  if (!tree) throw new Error('The parser returned no tree');
  expect(tree.rootNode.hasError).toBe(false);
  expect(tree.rootNode.descendantsOfType('style_query')).toHaveLength(1);
  expect(tree.rootNode.descendantsOfType('feature_name').map((node) => node.text)).toEqual(['--theme', '--accent']);
  const captures = query.captures(tree.rootNode).filter(({ name }) => name === 'property' || name === 'function');
  expect(captures.map(({ name, node }) => [name, node.text])).toEqual([
    ['property', 'card'],
    ['function', 'style'],
    ['property', '--theme'],
    ['property', '--accent'],
    ['property', 'color'],
  ]);
  tree.delete();
});

test('mixed container conditions retain style properties in either operand order', () => {
  const conditions = ['(min-width: 400px)', '(width > 30em)', 'scroll-state(stuck: top)', 'unknown(foo [bar])'];
  for (const name of ['', 'card ']) {
    for (const condition of conditions) {
      for (const combined of [`${condition} and style(--theme: dark)`, `style(--theme: dark) and ${condition}`]) {
        const source = `@container ${name}${combined} {} a { color: red; }`;
        const tree = parser.parse(source);
        if (!tree) throw new Error('The parser returned no tree');
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(
          tree.rootNode.descendantsOfType('style_feature').map((node) => node.text),
          source
        ).toEqual(['--theme: dark']);
        expect(
          tree.rootNode.descendantsOfType('container_name').map((node) => node.text),
          source
        ).toEqual(name ? ['card'] : []);
        expect(
          query.captures(tree.rootNode).filter(({ name, node }) => name === 'property' && node.text === '--theme'),
          source
        ).toHaveLength(1);
        expect(tree.rootNode.lastNamedChild?.type, source).toBe('rule_set');
        tree.delete();
      }
    }
  }
});

test('case-insensitive container keywords preserve features and highlights', () => {
  for (const [atRule, fn, and, or, not] of [
    ['@container', 'style', 'and', 'or', 'not'],
    ['@CONTAINER', 'STYLE', 'AND', 'OR', 'NOT'],
    ['@CoNtAiNeR', 'StYlE', 'AnD', 'oR', 'NoT'],
  ]) {
    const source = `${atRule} Card ${not} (${fn}(${not} (--Theme: dark)) ${or} ${fn}((--Accent: red) ${and} (--Mode))) {} a { color: red; }`;
    const tree = parser.parse(source);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, source).toBe(false);
    expect(
      tree.rootNode.descendantsOfType('feature_name').map((node) => node.text),
      source
    ).toEqual(['--Theme', '--Accent', '--Mode']);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === 'function')
        .map(({ node }) => node.text),
      source
    ).toEqual([fn, fn]);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === 'operator')
        .map(({ node }) => node.text),
      source
    ).toEqual([not, not, or, and]);
    expect(tree.rootNode.lastNamedChild?.type, source).toBe('rule_set');
    tree.delete();
  }
});

test('style features remain queryable beside general-enclosed operands', () => {
  for (const condition of [
    '(--theme: dark) and unknown(foo)',
    'unknown(foo) or (--theme: dark)',
    '(not unknown(foo)) and (--theme: dark)',
    '(--theme: dark) and (unknown(foo) or unknown(bar))',
    ...['and', 'or', 'not', 'style', 'AND', 'OR', 'NOT', 'STYLE'].flatMap((name) => [
      `${name}(foo) or (--theme: dark)`,
      `(--theme: dark) and ${name}(foo)`,
      `(not ${name}(foo)) and (--theme: dark)`,
    ]),
  ]) {
    const source = `@container style(${condition}) {} a { color: red; }`;
    const tree = parser.parse(source);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, source).toBe(false);
    expect(
      tree.rootNode.descendantsOfType('style_feature').map((node) => node.text),
      source
    ).toEqual(['--theme: dark']);
    expect(
      query.captures(tree.rootNode).filter(({ name, node }) => name === 'property' && node.text === '--theme'),
      source
    ).toHaveLength(1);
    expect(tree.rootNode.lastNamedChild?.type, source).toBe('rule_set');
    tree.delete();
  }
});

test('style ranges expose only custom-property operands as references', () => {
  const conditions = [
    ['--size > 10px', ['--size']],
    ['10px <= --size < 20px', ['--size']],
    ['20px >= --size > 10px', ['--size']],
    ['--minimum < --size < --maximum', ['--minimum', '--size', '--maximum']],
    ['--size = calc(10px + 2px)', ['--size']],
    [String.raw`--s\69ze > 10px`, [String.raw`--s\69ze`]],
    [String.raw`\2d \2d size > 10px`, [String.raw`\2d \2d size`]],
    [String.raw`-\00002dface > 10px`, [String.raw`-\00002dface`]],
    [String.raw`-\2dface > 10px`, []],
    ['width > 10px', []],
  ] as const;
  for (const [condition, names] of conditions) {
    const source = `@container style(${condition}) {} a { color: red; }`;
    const tree = parser.parse(source);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, source).toBe(false);
    expect(
      tree.rootNode.descendantsOfType('feature_name').map((node) => node.text),
      source
    ).toEqual(names);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name, node }) => name === 'property' && node.type === 'feature_name')
        .map(({ node }) => node.text),
      source
    ).toEqual(names);
    expect(tree.rootNode.lastNamedChild?.type, source).toBe('rule_set');
    tree.delete();
  }
});

test('escaped container query keywords retain source spelling and property captures', () => {
  for (const source of [
    String.raw`@container st\79le(--theme: dark) {} a { color: red; }`,
    String.raw`@\63ontainer \73 tyle((--theme: dark) \61nd (--accent: red)) {} a { color: red; }`,
    String.raw`@\43ONTAINER \53TYLE(\6e ot (--theme: dark)) {} a { color: red; }`,
    String.raw`@container \style((--theme: dark) o\72 (--accent: red)) {} a { color: red; }`,
  ]) {
    const tree = parser.parse(source);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, source).toBe(false);
    const features = tree.rootNode.descendantsOfType('feature_name').map((node) => node.text);
    expect(features, source).toEqual(source.includes('--accent') ? ['--theme', '--accent'] : ['--theme']);
    const functions = query.captures(tree.rootNode).filter(({ name }) => name === 'function');
    expect(functions, source).toHaveLength(1);
    expect(functions[0]!.node.text, source).toContain('\\');
    expect(tree.rootNode.lastNamedChild?.type, source).toBe('rule_set');
    tree.delete();
  }
  for (const source of [
    String.raw`@container sty\6ce(--theme: dark) {}`,
    String.raw`@con\74ainer style(--theme: dark) {}`,
  ]) {
    const tree = parser.parse(source);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.descendantsOfType('style_query'), source).toHaveLength(0);
    tree.delete();
  }
});

test('style boolean chains require parentheses when mixing operators', () => {
  for (const condition of ['(--a: 1) and (--b: 2) or (--c: 3)', '(--a: 1) or (--b: 2) and (--c: 3)']) {
    const tree = parser.parse(`@container style(${condition}) {} a { color: red; }`);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, condition).toBe(false);
    expect(tree.rootNode.descendantsOfType('binary_query'), condition).toHaveLength(0);
    expect(tree.rootNode.lastNamedChild?.type, condition).toBe('rule_set');
    tree.delete();
  }
  for (const condition of [
    '(--a: 1) and (--b: 2) and (--c: 3)',
    '(--a: 1) or (--b: 2) or (--c: 3)',
    '((--a: 1) and (--b: 2)) or (--c: 3)',
    '(--a: 1) and ((--b: 2) or (--c: 3))',
  ]) {
    const tree = parser.parse(`@container style(${condition}) {}`);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, condition).toBe(false);
    expect(tree.rootNode.descendantsOfType('binary_query'), condition).toHaveLength(2);
    expect(
      tree.rootNode.descendantsOfType('feature_name').map((node) => node.text),
      condition
    ).toEqual(['--a', '--b', '--c']);
    tree.delete();
  }
});

test('container boolean chains require parentheses when mixing operators', () => {
  for (const condition of [
    '(width > 1px) and style(--a: 1) or (height > 2px)',
    '(width > 1px) or style(--a: 1) and (height > 2px)',
    'not style(--a: 1) and (height > 2px)',
  ]) {
    const tree = parser.parse(`@container ${condition} {} a { color: red; }`);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, condition).toBe(false);
    expect(tree.rootNode.descendantsOfType('binary_query'), condition).toHaveLength(0);
    expect(tree.rootNode.lastNamedChild?.type, condition).toBe('rule_set');
    tree.delete();
  }
  for (const condition of [
    '(width > 1px) and style(--a: 1) and (height > 2px)',
    '(width > 1px) or style(--a: 1) or (height > 2px)',
    '((width > 1px) and style(--a: 1)) or (height > 2px)',
    '(width > 1px) and (style(--a: 1) or (height > 2px))',
  ]) {
    const tree = parser.parse(`@container ${condition} {}`);
    if (!tree) throw new Error('The parser returned no tree');
    expect(tree.rootNode.hasError, condition).toBe(false);
    expect(tree.rootNode.descendantsOfType('binary_query'), condition).toHaveLength(2);
    expect(
      tree.rootNode.descendantsOfType('style_feature').map((node) => node.text),
      condition
    ).toEqual(['--a: 1']);
    tree.delete();
  }
});

test('style ranges preserve balanced declaration-value operands', () => {
  for (const operand of ['"10px"', '[10px]', '{10px}', '10px 20px', 'var(--other) 2px', '--other fallback']) {
    for (const condition of [`--size = ${operand}`, `${operand} < --size`, `0 < --size < ${operand}`]) {
      const tree = parser.parse(`@container style(${condition}) {} a { color: red; }`);
      if (!tree) throw new Error('The parser returned no tree');
      expect(tree.rootNode.hasError, condition).toBe(false);
      expect(
        tree.rootNode.descendantsOfType('feature_name').map((node) => node.text),
        condition
      ).toEqual(['--size']);
      expect(tree.rootNode.lastNamedChild?.type, condition).toBe('rule_set');
      tree.delete();
    }
  }
});
