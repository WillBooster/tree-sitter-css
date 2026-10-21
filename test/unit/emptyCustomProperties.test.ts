import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  ['--x', '--1', '--漢字', '--😀', String.raw`--c\6f lor`, String.raw`\2d\2d x`, String.raw`-\2d x`].flatMap((name) =>
    ['complete', 'final', 'comment', 'important', 'inline', 'inlineFinal'].map((layout) => [name, layout] as const)
  )
)('empty custom properties retain valid declarations and captures: %s in %s', (name, layout) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const final = layout === 'final' || layout === 'inlineFinal';
  const inline = layout === 'inline' || layout === 'inlineFinal';
  const declaration = final
    ? `${name}:`
    : layout === 'important'
      ? `${name}: /* empty */ ! IMPORTANT;`
      : layout === 'comment'
        ? `${name}: /* empty */;`
        : layout === 'inline'
          ? `${name}:;`
          : `${name}: ;`;
  const content = final ? `color: red; ${declaration}` : `${declaration} color: red;`;
  const source = inline ? content : `a { ${content} } .after { background: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const empty = tree.rootNode.descendantsOfType('declaration').find((node) => node.text === declaration);
    expect(empty?.startIndex).toBe(source.indexOf(declaration));
    expect(empty?.endIndex).toBe(source.indexOf(declaration) + declaration.length);
    const property = empty?.descendantsOfType('property_name')[0];
    expect(property?.text).toBe(name);
    expect(property?.startIndex).toBe(source.indexOf(name));
    expect(property?.endIndex).toBe(source.indexOf(name) + name.length);
    expect(empty?.descendantsOfType('plain_value')).toHaveLength(0);
    expect(
      query
        .captures(empty!)
        .filter(({ name: capture }) => capture === 'property')
        .map(({ node }) => node.text)
    ).toEqual([name]);
    const following = tree.rootNode.descendantsOfType('declaration').find((node) => node.text === 'color: red;');
    expect(following?.startIndex).toBe(source.indexOf('color: red;'));
    expect(following?.endIndex).toBe(source.indexOf('color: red;') + 'color: red;'.length);
    expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual(
      layout === 'important' || layout === 'comment' ? ['/* empty */'] : []
    );
    if (!inline) {
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { background: blue; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(['--', String.raw`\2d\2d `, String.raw`-\2d `])(
  'reserved bare dashed names remain errors without losing following declarations: %s',
  (name) => {
    const parser = new Parser().setLanguage(language);
    const source = `a { ${name}: ; color: red; } .after { background: blue; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      const following = tree.rootNode.descendantsOfType('declaration').find((node) => node.text === 'color: red;');
      expect(following?.startIndex).toBe(source.indexOf('color: red;'));
      expect(following?.endIndex).toBe(source.indexOf('color: red;') + 'color: red;'.length);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { background: blue; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
