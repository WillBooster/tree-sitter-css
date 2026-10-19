import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

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
