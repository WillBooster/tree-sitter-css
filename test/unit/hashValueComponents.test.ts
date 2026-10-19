import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  ['#abcdefg', '#abc-def', '#123456789'].flatMap((hash) =>
    ['%', '.', '|', '~', '*', '+'].flatMap((delimiter) =>
      [false, true].map((semicolon) => [hash, delimiter, semicolon] as const)
    )
  )
)('atomic hash retains following delimiter components: %s%s %s', (hash, delimiter, semicolon) => {
  const parser = new Parser().setLanguage(language);
  const declaration = `--x: ${hash}${delimiter}${semicolon ? ';' : ''}`;
  const source = `a { ${declaration} } .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(first.descendantsOfType('declaration').map((node) => node.text)).toEqual([declaration]);
    const atom = first.descendantsOfType('hash_value')[0]!;
    expect(atom.text).toBe(hash);
    expect(atom.startIndex).toBe(source.indexOf(hash));
    expect(atom.endIndex).toBe(source.indexOf(hash) + hash.length);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});
