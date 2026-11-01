import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const keywords = [
  ['@KEYFRAMES', 'FROM', 'TO'],
  ['@KeyFrames', 'FrOm', 'tO'],
  ['@keyframes', String.raw`\66 rom`, String.raw`\74o`],
  [String.raw`@\6b eyframes`, 'from', 'to'],
  ['@-WEBKIT-KEYFRAMES', 'FROM', 'TO'],
  ['@-webkit-keyframes', 'from', 'to'],
  [String.raw`@-\77 ebkit-keyframes`, 'from', 'to'],
  ['@-MOZ-KEYFRAMES', 'FROM', 'TO'],
  ['@-moz-KEYFRAMES', 'from', 'to'],
] as const;

test.each(keywords.flatMap((parts) => ['top', 'group'].map((layout) => [...parts, layout] as const)))(
  'parses %s with %s/%s keywords in %s context',
  (keyword, from, to, layout) => {
    const animation = `${keyword} MixedCase { ${from}, 24.5% { opacity: 0; } ${to} { opacity: 1; } }`;
    const source = (layout === 'group' ? `@media all { ${animation} }` : animation) + ' .after { color: blue; }';
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(false);
      const statements = tree.rootNode.descendantsOfType('keyframes_statement');
      expect(statements).toHaveLength(1);
      expect(statements[0]!.text).toBe(animation);
      expect(statements[0]!.startIndex).toBe(source.indexOf(keyword));
      expect(statements[0]!.descendantsOfType('keyframes_name').map((node) => node.text)).toEqual(['MixedCase']);
      expect(statements[0]!.descendantsOfType('from').map((node) => node.text)).toEqual([from]);
      expect(statements[0]!.descendantsOfType('to').map((node) => node.text)).toEqual([to]);
      expect(statements[0]!.descendantsOfType('keyframe_block')).toHaveLength(2);
      expect(statements[0]!.descendantsOfType('property_name').map((node) => node.text)).toEqual([
        'opacity',
        'opacity',
      ]);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(['KEYFRAMES-extra', 'KEYFRAMES日本語', '-WEBKIT-KEYFRAMES-extra'])(
  'keeps the longer at-keyword @%s as a generic rule',
  (name) => {
    const parser = new Parser().setLanguage(language);
    const source = `@${name} "input.css"; .after { color: blue; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('keyframes_statement')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('at_keyword').map((node) => node.text)).toEqual([`@${name}`]);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
