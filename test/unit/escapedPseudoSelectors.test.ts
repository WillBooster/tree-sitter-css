import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const selectors = [
  [String.raw`.sm\:flex:hover`, [String.raw`sm\:flex`, 'hover']],
  [String.raw`.sm\:flex`, [String.raw`sm\:flex`]],
  [String.raw`.a\62 `, [String.raw`a\62 `]],
  [String.raw`.a\62  .b`, [String.raw`a\62 `, 'b']],
  [String.raw`a .sm\:flex`, [String.raw`sm\:flex`]],
  [String.raw`.sm\:flex, .b`, [String.raw`sm\:flex`, 'b']],
] as const;

test.each(
  ['::slotted', ':matches', ':-webkit-any', ':foo', '::foo', '::cue'].flatMap((pseudo) =>
    selectors.map(([selector, classes]) => [pseudo, selector, classes] as const)
  )
)('generic pseudos retain escaped class selectors: %s(%s)', (pseudo, selector, classes) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const source = `${pseudo}(${selector}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const args = tree.rootNode.descendantsOfType('arguments')[0]!;
    const parsed = args.descendantsOfType('class_name');
    expect(parsed.map((node) => node.text)).toEqual(classes);
    expect(
      query
        .captures(args)
        .filter(({ name }) => name === 'property')
        .map(({ node }) => node.text)
    ).toEqual(classes);
    for (const node of parsed) {
      expect(node.startIndex).toBe(source.indexOf(node.text, pseudo.length + 1));
      expect(node.endIndex).toBe(source.indexOf(node.text, pseudo.length + 1) + node.text.length);
    }
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
