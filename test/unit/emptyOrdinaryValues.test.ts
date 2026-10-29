import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const highlights = fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8');
const followingNames = [
  'x',
  'g',
  'z',
  'a',
  'b',
  'c',
  'e',
  'ab',
  'abc',
  'left',
  'gap',
  'bg',
  'color',
  'height',
  'padding',
  'top',
  String.raw`co\6c or`,
  '--x',
  String.raw`--co\6c or`,
];
const inputs = ['width', 'margin', 'color', 'background', 'padding'].flatMap((broken) =>
  followingNames.flatMap((name) => ['', '/**/', '\n/* comment */\n'].map((gap) => [broken, name, gap] as const))
);

test.each(inputs)('empty %s values preserve the following %s declaration across %j', (broken, name, gap) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const source = `a { ${broken}: ${gap}; ${name}: red; } .after { color: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const block = tree.rootNode.firstNamedChild!.descendantsOfType('block')[0]!;
    const valid = block.descendantsOfType('declaration').filter((node) => !node.hasError);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.text).toBe(`${name}: red;`);
    expect(valid[0]!.startIndex).toBe(source.indexOf(`${name}: red;`));
    expect(valid[0]!.endIndex).toBe(source.indexOf(`${name}: red;`) + `${name}: red;`.length);
    expect(valid[0]!.descendantsOfType('property_name').map((node) => node.text)).toEqual([name]);
    expect(
      query
        .captures(valid[0]!)
        .filter(({ name: capture }) => capture === 'property')
        .map(({ node }) => node.text)
    ).toEqual([name]);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: blue; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

const emptyProperties = ['color', '*zoom', String.raw`co\6c or`];
const emptyGaps = ['', ' ', '\n', '/**/', ' // note\rbody\n'];
const emptyEndings = ['', '\n> b { c:d; }', '\n:hover { c:d; }', '\n@media screen { b { c:d; } }'];

test.each(
  emptyProperties.flatMap((property) =>
    emptyGaps.flatMap((gap) => emptyEndings.map((ending) => [property, gap, ending]))
  )
)('empty %s before %j %j retains its missing value and following rules', (property, gap, ending) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, highlights);
  const source = `/* Ω🙂 */\na { ${property}:${gap}${ending} } .after { z:y; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const [outer, after] = tree.rootNode.namedChildren.filter((node) => node.type === 'rule_set');
    const start = source.indexOf(`${property}:`);
    const declaration = outer!.descendantsOfType('declaration').find((node) => node.startIndex === start)!;
    expect(declaration).toBeDefined();
    const name = declaration.namedChildren.find((node) => node.type === 'property_name')!;
    expect(name.text).toBe(property);
    expect(name.startIndex).toBe(start);
    expect(name.endIndex).toBe(start + property.length);
    expect(declaration.descendantsOfType('plain_value').some((node) => node.isMissing)).toBe(true);
    expect(
      query.captures(declaration).some(({ name: capture, node }) => capture === 'property' && node.id === name.id)
    ).toBe(true);
    expect(outer!.endIndex).toBe(source.indexOf(' .after'));
    expect(after!.text).toBe('.after { z:y; }');
    expect(after!.startIndex).toBe(source.indexOf('.after'));
    if (ending) {
      const block = outer!.namedChildren.find((node) => node.type === 'block')!;
      expect(block.namedChildren.some((node) => node.text === ending.trim())).toBe(true);
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
