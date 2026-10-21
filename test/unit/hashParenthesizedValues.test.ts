import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const hashes = ['#fn', '#abcdefg', String.raw`#a\62 c`];
const groups = ['', 'a b', 'a, b', 'a; b', '/* c */', '1 + 2', '(#abc, 0)', 'fn(a b), 1'];

test.each(hashes.flatMap((hash) => groups.map((group) => [hash, group] as const)))(
  'parenthesized components after a complete hash retain ownership: %s(%s)',
  (hash, group) => {
    const parser = new Parser().setLanguage(language);
    const value = `${hash}(${group})`;
    const source = `a { --x: ${value}; color: red; } .after { color: blue; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const declaration = tree.rootNode.descendantsOfType('declaration')[0]!;
      expect(declaration.text).toBe(`--x: ${value};`);
      const parsedHash = declaration.descendantsOfType('hash_value')[0]!;
      expect(parsedHash.text).toBe(hash);
      expect(parsedHash.startIndex).toBe(source.indexOf(hash));
      expect(parsedHash.endIndex).toBe(source.indexOf(hash) + hash.length);
      const parenthesized = declaration.descendantsOfType('parenthesized_value')[0]!;
      expect(parenthesized.text).toBe(`(${group})`);
      expect(parenthesized.startIndex).toBe(parsedHash.endIndex);
      expect(parenthesized.endIndex).toBe(source.indexOf(hash) + value.length);
      expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual([
        '--x',
        'color',
        'color',
      ]);
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: blue; }');
      expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
