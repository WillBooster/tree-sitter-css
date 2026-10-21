import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  ['#abcdefg', '#abc-def', '#123456789'].flatMap((hash) =>
    ['%', '.', '|', '~', '*', '+'].flatMap((delimiter) =>
      [false, true].map((semicolon) => [hash, delimiter, semicolon] as const)
    )
  )
)('atomic hash retains following delimiter components: %s%s %s', (hash, delimiter, semicolon) => {
  const parser = new Parser().setLanguage(language);
  const declaration = `--x: ${hash}${delimiter}${semicolon ? ';' : ''}`;
  const source = `a { ${declaration} } .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(first.descendantsOfType('declaration').map((node) => node.text)).toEqual([declaration]);
    const atom = first.descendantsOfType('hash_value')[0]!;
    expect(atom.text).toBe(hash);
    expect(atom.startIndex).toBe(source.indexOf(hash));
    expect(atom.endIndex).toBe(source.indexOf(hash) + hash.length);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ['#item//', 'hash_value'],
  ['#item//bar', 'hash_value'],
  ['#item///', 'hash_value'],
  ['#abc//', 'color_value'],
  ['#abc//bar', 'color_value'],
])('attached slashes after %s stay value components', (value, type) => {
  const parser = new Parser().setLanguage(language);
  const source = `a { --x: ${value}; color: red; } .after {}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('js_comment')).toEqual([]);
    expect(tree.rootNode.descendantsOfType(type)[0]!.text).toBe(value.slice(0, value.indexOf('/')));
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      `--x: ${value};`,
      'color: red;',
    ]);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('a separated line comment after a hash remains a comment', () => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse('a {\n  --x: #item // note\n  ;\n  color: red;\n}\n')!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('js_comment').map((node) => node.text)).toEqual(['// note']);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      '--x: #item // note\n  ;',
      'color: red;',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ['#abc©', 'color_value'],
  ['#item→x', 'hash_value'],
  ['#item …', 'hash_value'],
  ['#abcdef\u{E000}', 'color_value'],
])('non-name code points after %s stay value components', (value, type) => {
  const parser = new Parser().setLanguage(language);
  const source = `a { --x: ${value}; color: red; } .after {}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType(type)[0]!.text).toBe(value.match(/^#[\w]+/)![0]);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      `--x: ${value};`,
      'color: red;',
    ]);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['#item', '#item/', '#item//', '#abc//'])(
  'a block comment opened right after %s/ keeps its delimiters inside the comment',
  (prefix) => {
    const parser = new Parser().setLanguage(language);
    const source = `a { --x: ${prefix}/* ; } .bad {} */; color: red; } .after {}`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual(['/* ; } .bad {} */']);
      expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
        `--x: ${prefix}/* ; } .bad {} */;`,
        'color: red;',
      ]);
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after {}');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
