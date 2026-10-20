import path from 'node:path';
import { expect, test } from 'vitest';

import { Language, Parser } from '@willbooster/web-tree-sitter';

test('preserves empty-value recovery and the following declaration', async () => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
  const tree = parser.parse('a { --x: ; color: red; }');
  try {
    expect(tree?.rootNode.hasError).toBe(true);
    const declarations = tree?.rootNode.descendantsOfType('declaration');
    expect(declarations).toHaveLength(2);
    const emptyValue = declarations?.[0]?.lastNamedChild;
    expect(declarations?.[0]?.text).toBe('--x: ;');
    expect(emptyValue?.text).toBe('');
    expect(emptyValue?.hasError).toBe(true);
    expect(declarations?.[1]?.text).toBe('color: red;');
    expect(declarations?.[1]?.hasError).toBe(false);
    expect(declarations?.[1]?.startIndex).toBe(11);
    expect(declarations?.[1]?.endIndex).toBe(22);
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

test.each(['.c', '&', '& .b', '&:hover', ':hover', '> b', '~ b', '|b'])(
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
