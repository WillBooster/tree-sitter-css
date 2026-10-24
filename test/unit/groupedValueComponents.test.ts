import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const inputs = ['a:b', 'min-width:100px', 'a:b/c:d'].flatMap((content) =>
  [
    ['(', ')', 'parenthesized_value'],
    ['[', ']', 'grid_value'],
  ].flatMap(([open, close, kind]) =>
    ['--x', 'b'].flatMap((property) => [false, true].map((final) => ({ content, open, close, kind, property, final })))
  )
);

test.each(inputs)(
  'colon components retain grouped $property values: $open$content$close, final=$final',
  ({ content, open, close, kind, property, final }) => {
    const parser = new Parser().setLanguage(language);
    const value = `${open}${content}${close}`;
    const declaration = `${property}: ${value}${final ? '' : ';'}`;
    const block = final ? `color: red; ${declaration}` : `${declaration} color: red;`;
    const source = `a { ${block} } .after { color: blue; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const parsed = tree.rootNode
        .firstNamedChild!.descendantsOfType('declaration')
        .find((node) => node.text === declaration)!;
      expect(parsed).toBeDefined();
      expect(parsed.startIndex).toBe(source.indexOf(declaration));
      expect(parsed.endIndex).toBe(source.indexOf(declaration) + declaration.length);
      expect(parsed.descendantsOfType('property_name').map((node) => node.text)).toEqual([property]);
      const group = parsed.descendantsOfType(kind!)[0]!;
      expect(group.text).toBe(value);
      expect(group.startIndex).toBe(source.indexOf(value));
      expect(group.endIndex).toBe(source.indexOf(value) + value.length);
      expect(
        tree.rootNode.firstNamedChild!.descendantsOfType('declaration').some((node) => node.text === 'color: red;')
      ).toBe(true);
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: blue; }');
      expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
