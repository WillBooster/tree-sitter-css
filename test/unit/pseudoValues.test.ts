import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const values = [String.raw`e\6e -US`, String.raw`e\00006e -US`, 'en-US', String.raw`e\6e/**/-US`, '"en-US"'];
const argumentsLists = values.flatMap((value) =>
  [value, `en, ${value}`, `en, ${value}, fr`].map((args) => [args, value] as const)
);
const pseudos = [':lang', ':foo', '::foo'];

test.each(pseudos.flatMap((pseudo) => argumentsLists.map(([args, value]) => [pseudo, args, value] as const)))(
  'generic pseudo arguments preserve escaped values: %s(%s)',
  (pseudo, args, value) => {
    const parser = new Parser().setLanguage(language);
    const selector = `${pseudo}(${args})`;
    const source = `${selector} {} .after { color: red; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.firstNamedChild!.firstNamedChild!.text).toBe(selector);
      expect(tree.rootNode.descendantsOfType('arguments').map((node) => node.text)).toEqual([`(${args})`]);
      if (value.includes('\\') && !value.includes('/**/')) {
        expect(tree.rootNode.descendantsOfType('plain_value').map((node) => node.text)).toContain(value);
      }
      expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual(
        args.includes('/**/') ? ['/**/'] : []
      );
      const following = tree.rootNode.lastNamedChild!;
      expect(following.type).toBe('rule_set');
      expect(following.text).toBe('.after { color: red; }');
      expect(following.startIndex).toBe(source.indexOf('.after'));
      expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual(['color: red;']);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
