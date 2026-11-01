import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const names = ['日本語', 'écho', 'naïve', 'a日本語', '-日本語', '--日本語', '𐐀name', 'a💩'];

test.each(names.flatMap((name) => ['top', 'nested', 'group'].map((layout) => [name, layout] as const)))(
  'keeps the entire Unicode at-keyword @%s in %s context',
  (name, layout) => {
    const statement = `@${name} "input.css" (width > 1px);`;
    const source =
      (layout === 'nested'
        ? `a { ${statement} color: red; }`
        : layout === 'group'
          ? `@media all { ${statement} }`
          : statement) + ' .after { color: blue; }';
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(false);
      const keywords = tree.rootNode.descendantsOfType('at_keyword');
      expect(keywords.map((node) => node.text)).toEqual([`@${name}`]);
      expect(keywords[0]!.startIndex).toBe(source.indexOf(`@${name}`));
      const rules = tree.rootNode.descendantsOfType('at_rule');
      expect(rules.map((node) => node.text)).toEqual([statement]);
      expect(rules[0]!.namedChildren.slice(1).map((node) => node.type)).toEqual([
        'string_value',
        'at_rule_parenthesized',
      ]);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(['\u00D7', '\u037E', '\u2000', '\u3000', '\uFFFE'])(
  'does not turn excluded delimiter %j into a keyword',
  (name) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(`@${name} "input.css";`)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
