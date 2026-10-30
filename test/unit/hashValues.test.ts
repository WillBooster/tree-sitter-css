import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each([
  ['color', String.raw`#\36 7BA6A`],
  ['color', String.raw`#67BA6A\9`],
  ['--hash', '#item'],
  ['--hash', '#123456789'],
  ['--hash', '#12345'],
  ['--hash', '#1234567'],
  ['--hash', '#ab'],
  ['--hash', '#--theme'],
  ['--hash', '#-'],
  ['--hash', '#123abcg'],
  ['--hash', '#日本'],
  ['--hash', String.raw`#a\+b`],
])('hash values remain atomic and preserve following declarations: %s %s', (property, value) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`a { ${property}: ${value}; color: red; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('hash_value').map((node) => node.text)).toEqual([value]);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      `${property}: ${value};`,
      'color: red;',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('ordinary colors retain their public nodes', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse('a { color: #abc; background: #12345678; border-color: #abcd #123456; }')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('color_value').map((node) => node.text)).toEqual([
      '#abc',
      '#12345678',
      '#abcd',
      '#123456',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['#abc', String.raw`#\61 bc`, '#日本'].flatMap((selector) =>
    (
      [
        [selector, 'rule_set', 1],
        [`@scope (${selector})`, 'scope_statement', 1],
        [`@scope to (${selector})`, 'scope_statement', 1],
        [`@scope (${selector}) to (${selector})`, 'scope_statement', 2],
      ] as const
    ).map(([prefix, type, count]) => [selector, prefix, type, count] as const)
  )
)('hash values preserve ID selectors: %s in %s', (selector, prefix, type, count) => {
  const parser = new Parser().setLanguage(language);
  const source = `${prefix} { --hash: #item; } .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.type).toBe(type);
    expect(tree.rootNode.descendantsOfType('id_name').map((node) => node.text)).toEqual(
      Array.from({ length: count }, () => selector)
    );
    expect(tree.rootNode.descendantsOfType('hash_value').map((node) => node.text)).toEqual(['#item']);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.lastIndexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['#', '#/**/fff', '#/**/abc', '#/**/12345678', '#/**//**/fff', '#/**/fff/**/', '# fff', '#/**/日本'].flatMap(
    (value) => ['x', '--x'].map((property) => [property, value] as const)
  )
)('separated hash delimiters remain generic values: %s %s', (property, value) => {
  assertHashDelimiter(`a { ${property}: ${value}; color: red; } .after {}`, value);
});

test.each(['fn(#/**/fff, 0)', 'fn(#, 0)'])('hash delimiters remain available inside functions: %s', (value) => {
  assertHashDelimiter(`a { --x: ${value}; color: red; } .after {}`, value);
});

test('split unquoted hash attributes retain error recovery', () => {
  const parser = new Parser().setLanguage(language);
  const source = 'a[data-x=#/**/abc] { color: red; } .after {}';
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual(['color: red;']);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('quoted hash attributes retain their string syntax', () => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse('a[data-x="#/**/abc"] { color: red; } .after {}')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('comment')).toHaveLength(0);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

function assertHashDelimiter(source: string, value: string): void {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('hash_value')).toHaveLength(0);
    expect(tree.rootNode.descendantsOfType('color_value')).toHaveLength(0);
    expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual(
      value.match(/\/\*[\s\S]*?\*\//g) ?? []
    );
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    const color = tree.rootNode.descendantsOfType('declaration').find((node) => node.text === 'color: red;');
    expect(color?.startIndex).toBe(source.indexOf('color: red;'));
  } finally {
    tree.delete();
    parser.delete();
  }
}
