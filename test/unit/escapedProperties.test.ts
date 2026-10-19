import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const properties = [
  String.raw`\63 olor`,
  String.raw`co\6c or`,
  String.raw`h\61 s`,
  String.raw`\000063olor`,
  String.raw`\000063 olor`,
  String.raw`c\olor`,
  String.raw`c\6F lor`,
  String.raw`color\+`,
  String.raw`\31 23`,
  String.raw`-\63 olor`,
  String.raw`--\63 olor`,
  '--theme',
  'color',
];

test.each(
  properties.flatMap((property) =>
    ['complete', 'last', 'incomplete', 'inline'].map((layout) => [property, layout] as const)
  )
)('escaped property names retain nodes and highlights: %s in %s', (property, layout) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const declaration = `${property}: red`;
  const source =
    layout === 'last'
      ? `a { color: blue; ${declaration} }`
      : layout === 'incomplete'
        ? `a { ${property}\ncolor: blue; }`
        : layout === 'inline'
          ? `${declaration}; color: blue`
          : `a { ${declaration}; color: blue; }`;
  const input = source + (layout === 'inline' ? '' : ' .after {}');
  const tree = parser.parse(input)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const names = layout === 'last' ? ['color', property] : [property, 'color'];
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(names);
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === 'property')
        .map(({ node }) => node.text)
    ).toEqual(layout === 'inline' ? names : [...names, 'after']);
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
    for (const node of declarations) expect(node.startIndex).toBe(input.indexOf(node.text));
    if (layout !== 'inline') {
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after {}');
      expect(tree.rootNode.lastNamedChild!.startIndex).toBe(input.indexOf('.after'));
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
