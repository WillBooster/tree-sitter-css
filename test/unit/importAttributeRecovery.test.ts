import path from 'node:path';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const selectors = ['[hidden]', '[data-x="a"]', '[/**/hidden]', '[*|data-x]'];
const multilineCases = [
  'layer("theme);',
  'layer("theme");',
  'layer("theme););',
  "layer('theme);",
  'supports(display: grid)',
  'supports(display: grid) s"creen;',
  'layer(theme) supports(display: grid) s"creen;',
  'supports(a)[[)',
].flatMap((condition) =>
  ['\n', '\r\n', '\f', `\n${' '.repeat(80)}`, '\n/*\n*/'].flatMap((separator) =>
    selectors.map((selector) => [condition, separator, selector] as const)
  )
);
const inlineCases = ['layer("theme");', 'supports(display: grid)'].flatMap((condition) =>
  [' ', '/**/'].flatMap((separator) => selectors.map((selector) => [condition, separator, selector] as const))
);

test.each([...multilineCases, ...inlineCases])(
  'malformed imports retain following attribute-selector rules: %s%s%s',
  (condition, separator, selector) => {
    const parser = new Parser().setLanguage(language);
    const rule = `${selector} { color: red; }`;
    const source = `@import "x" ${condition}${separator}${rule}\n.after { background: blue; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      const rules = tree.rootNode.descendantsOfType('rule_set');
      const following = rules.find((node) => node.text === rule)!;
      expect(following).toBeDefined();
      expect(following.startIndex).toBe(source.indexOf(selector));
      expect(following.endIndex).toBe(source.indexOf(selector) + rule.length);
      expect(following.descendantsOfType('property_name').map((node) => [node.text, node.startIndex])).toEqual([
        ['color', source.indexOf('color:')],
      ]);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { background: blue; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
