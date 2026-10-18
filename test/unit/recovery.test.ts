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
    expect(emptyValue?.type).toBe('integer_value');
    expect(emptyValue?.text).toBe('');
    expect(emptyValue?.hasError).toBe(true);
    expect(declarations?.[1]?.text).toBe('color: red;');
    expect(declarations?.[1]?.hasError).toBe(false);
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
