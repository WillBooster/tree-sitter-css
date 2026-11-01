import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const reserved = ['none', 'initial', 'inherit', 'unset', 'revert', 'revert-layer', 'revert-rule', 'default'];
const validNames = [
  'MixedCase',
  '--',
  '--1',
  '-x',
  '日本語',
  String.raw`\66 oo`,
  String.raw`\31 x`,
  String.raw`-\31 x`,
  String.raw`\000066oo`,
  '"hello"',
  "'space name'",
  '"None"',
  '"initial"',
  '"revert-rule"',
  '"default"',
  '"x\\\ny"',
  '"\\\nx"',
  String.raw`"\0"`,
  'none-more',
  'revert-layered',
  'initial日本語',
  String.raw`\6e one-more`,
  String.raw`"\""`,
];

test.each(validNames.flatMap((name) => ['top', 'group'].map((layout) => [name, layout] as const)))(
  'parses keyframe name %s in %s context',
  (name, layout) => {
    const animation = `@keyframes ${name} { 0% { opacity: 0; } 100% { opacity: 1; } }`;
    const source = (layout === 'group' ? `@media all { ${animation} }` : animation) + ' .after { color: blue; }';
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(false);
      const statements = tree.rootNode.descendantsOfType('keyframes_statement');
      expect(statements).toHaveLength(1);
      expect(statements[0]!.text).toBe(animation);
      expect(statements[0]!.descendantsOfType('keyframes_name').map((node) => node.text)).toEqual([name]);
      expect(statements[0]!.descendantsOfType('keyframe_block')).toHaveLength(2);
      expect(statements[0]!.descendantsOfType('property_name').map((node) => node.text)).toEqual([
        'opacity',
        'opacity',
      ]);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([
  ...reserved,
  ...reserved.map((name) => name.toUpperCase()),
  ...reserved.map((name) => `\\${name.codePointAt(0)!.toString(16)} ${name.slice(1)}`),
  "''",
  '""',
  '"\\\n"',
  '"\\\r\n"',
  '1foo',
  '-1foo',
  '-',
])('diagnoses invalid keyframe name %s', (name) => {
  const source = `@keyframes ${name} { 0% { opacity: 0; } } .after { color: blue; }`;
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError, source).toBe(true);
  } finally {
    tree.delete();
    parser.delete();
  }
});
