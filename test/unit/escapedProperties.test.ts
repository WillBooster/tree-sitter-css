import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

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
)('escaped property names retain nodes: %s in %s', (property, layout) => {
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
  const input = source + (layout === 'inline' ? '' : ' .after {}');
  const tree = parser.parse(input)!;
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
    for (const node of declarations) expect(node.startIndex).toBe(input.indexOf(node.text));
    if (layout !== 'inline') {
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after {}');
      expect(tree.rootNode.lastNamedChild!.startIndex).toBe(input.indexOf('.after'));
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  [
    String.raw`b \61 `,
    String.raw`b \61 .active`,
    String.raw`.b \61 `,
    String.raw`:is(b \61 )`,
    'b\n\\61 ',
    String.raw`b /* gap */ \61 `,
  ].flatMap((selector) => ['top', 'nested', 'media'].map((layout) => [selector, layout] as const))
)('escaped descendant selectors retain separate names and rules: %s in %s', (selector, layout) => {
  const parser = new Parser().setLanguage(language);
  const rule = `${selector} { color: red; }`;
  const before = layout === 'nested' ? `a { ${rule} }` : layout === 'media' ? `@media screen { ${rule} }` : rule;
  const source = `${before} .after { color: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const parsedRule = tree.rootNode.descendantsOfType('rule_set').find((node) => node.text === rule);
    expect(parsedRule?.startIndex).toBe(source.indexOf(rule));
    expect(parsedRule?.descendantsOfType('tag_name').map((node) => node.text)).toContain(String.raw`\61 `);
    expect(parsedRule?.descendantsOfType('descendant_selector')).toHaveLength(1);
    expect(parsedRule?.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color']);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color', 'color']);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  [String.raw`\61 `, String.raw`b\61 `, String.raw`c\6c ass`].flatMap((name) =>
    ['', ':hover', '.active', ' > x'].flatMap((suffix) =>
      ['top', 'nested', 'media'].map((layout) => [name, suffix, layout] as const)
    )
  )
)('escaped type selectors retain rule ownership: %s%s in %s', (name, suffix, layout) => {
  const parser = new Parser().setLanguage(language);
  const rule = `${name}${suffix} { color: red; }`;
  const before = layout === 'nested' ? `a { ${rule} }` : layout === 'media' ? `@media screen { ${rule} }` : rule;
  const source = `${before} .after { color: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const parsedRule = tree.rootNode.descendantsOfType('rule_set').find((node) => node.text === rule);
    expect(parsedRule?.startIndex).toBe(source.indexOf(rule));
    expect(parsedRule?.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color']);
    expect(parsedRule?.descendantsOfType('tag_name').map((node) => node.text)).toContain(name);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: blue; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color', 'color']);
  } finally {
    tree.delete();
    parser.delete();
  }
});
