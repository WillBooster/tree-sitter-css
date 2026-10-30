import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const keywords = ['style', 'and', 'or', 'not', 'has', 'is', 'where', 'host', 'host-context'];
const properties = [
  ...new Set([
    ...keywords,
    ...keywords.map((word) => word.toUpperCase()),
    String.raw`s\74 yle`,
    String.raw`\61 nd`,
    String.raw`\6f r`,
    String.raw`\6e ot`,
  ]),
];

test.each(
  properties.flatMap((property) =>
    ['complete', 'last', 'incomplete', 'inline'].map((layout) => [property, layout] as const)
  )
)('keyword property names retain nodes: %s in %s', (property, layout) => {
  const parser = new Parser().setLanguage(language);
  const declaration = `${property}: red`;
  const source =
    layout === 'last'
      ? `a { color: blue; ${declaration} }`
      : layout === 'incomplete'
        ? `a { ${property}\ncolor: blue; }`
        : layout === 'inline'
          ? `${declaration}; color: blue`
          : `a { ${declaration}; color: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const names = layout === 'last' ? ['color', property] : [property, 'color'];
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(names);
    expect(tree.rootNode.descendantsOfType('incomplete_declaration').map((node) => node.text)).toEqual(
      layout === 'incomplete' ? [property] : []
    );
    const declarations = tree.rootNode.descendantsOfType('declaration');
    expect(declarations.map((node) => node.text)).toEqual(
      layout === 'last'
        ? ['color: blue;', declaration]
        : layout === 'incomplete'
          ? ['color: blue;']
          : [declaration + ';', layout === 'inline' ? 'color: blue' : 'color: blue;']
    );
    for (const node of declarations) expect(node.startIndex).toBe(source.indexOf(node.text));
  } finally {
    tree.delete();
    parser.delete();
  }
});
