import path from 'node:path';
import { expect, test } from 'vitest';

import { Language, Parser } from '@willbooster/web-tree-sitter';

test('reports an empty-value error and preserves the following declaration range', async () => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
  const source = 'a { width: ; color: red; }';
  const tree = parser.parse(source);
  try {
    expect(tree?.rootNode.hasError).toBe(true);
    const declarations = tree?.rootNode.descendantsOfType('declaration').filter((node) => !node.hasError);
    expect(declarations).toHaveLength(1);
    expect(declarations?.[0]?.text).toBe('color: red;');
    expect(declarations?.[0]?.startIndex).toBe(source.indexOf('color: red;'));
    expect(declarations?.[0]?.endIndex).toBe(source.indexOf('color: red;') + 'color: red;'.length);
  } finally {
    tree?.delete();
    parser.delete();
  }
});

test.each(['a { color: red', '.foo { color: red', 'a{b:c', 'a {\n color: red;\n margin: 0'])(
  'preserves declarations in an unclosed block: %s',
  async (source) => {
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.type).toBe('stylesheet');
      expect(tree.rootNode.hasError).toBe(true);
      const rule = tree.rootNode.namedChild(0)!;
      expect(rule.type).toBe('rule_set');
      const block = rule.namedChildren.find((node) => node.type === 'block')!;
      expect(block.descendantsOfType('declaration').length).toBeGreaterThan(0);
      expect(block.descendantsOfType('declaration').every((node) => !node.hasError)).toBe(true);
      expect(block.children.at(-1)?.isMissing).toBe(true);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(['.c', '&', '& .b', '&:hover'])(
  'keeps a nested rule after a declaration without its semicolon: %s',
  async (selector) => {
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
    const source = `a { border: 1px solid\n  ${selector} { c: d } }\n.after { color: blue; }`;
    const tree = parser.parse(source)!;
    try {
      const [outer, after] = tree.rootNode.namedChildren;
      expect(outer?.type).toBe('rule_set');
      expect(outer?.endIndex).toBe(source.indexOf('\n.after'));
      const block = outer!.namedChildren.find((node) => node.type === 'block')!;
      expect(block.namedChildren.map((node) => node.type)).toEqual(['declaration', 'rule_set']);
      expect(block.namedChildren[1]?.text).toBe(`${selector} { c: d }`);
      expect(after?.text).toBe('.after { color: blue; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([
  '--mq: (max-width:600px)',
  'x: (a:b)',
  '--x: [a:b]',
  'x: screen and (min-width:100px)',
  'x: var(--a, (a:b))',
  '--x: a: b',
  '--x: a:(b)',
])('parses colons inside values: %s', async (declaration) => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
  const tree = parser.parse(`a { ${declaration}; y: z }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual([
      `${declaration};`,
      'y: z',
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['background: blue;', '--x: y;', '-x: y;', String.raw`c\6f lor: z;`])(
  'keeps the following top-level rule after a declaration without its semicolon before %s',
  async (next) => {
    await Parser.init();
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
    const source = `a {\n  color: red\n  ${next}\n}\n.after { color: blue; }`;
    const tree = parser.parse(source)!;
    try {
      const [outer, after] = tree.rootNode.namedChildren;
      expect(outer?.endIndex).toBe(source.indexOf('\n.after'));
      expect(outer?.descendantsOfType('rule_set')).toHaveLength(1);
      expect(after?.text).toBe('.after { color: blue; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
