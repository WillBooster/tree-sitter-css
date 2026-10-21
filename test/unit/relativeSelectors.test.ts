import path from 'node:path';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  ['>', '+', '~'].flatMap((combinator) =>
    ['/* gap */', '// gap\n'].flatMap((comment) =>
      ['top', 'nested', 'media'].map((layout) => [combinator, comment, layout] as const)
    )
  )
)('relative selector trailing comments preserve rule boundaries: %s %s in %s', (combinator, comment, layout) => {
  const parser = new Parser().setLanguage(language);
  const rule = `${combinator} b ${comment} { color: red; }`;
  const prefix = layout === 'nested' ? `a { ${rule} }` : layout === 'media' ? `@media screen { ${rule} }` : rule;
  const source = `${prefix} .after { background: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const relative = tree.rootNode.descendantsOfType('rule_set').find((node) => node.text === rule);
    expect(relative?.startIndex).toBe(source.indexOf(rule));
    expect(relative?.endIndex).toBe(source.indexOf(rule) + rule.length);
    expect(relative?.descendantsOfType('tag_name').map((node) => node.text)).toEqual(['b']);
    expect(relative?.descendantsOfType(['comment', 'js_comment']).map((node) => node.text)).toEqual([
      comment.trimEnd(),
    ]);
    expect(relative?.descendantsOfType('declaration').map((node) => node.text)).toEqual(['color: red;']);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { background: blue; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color', 'background']);
  } finally {
    tree.delete();
    parser.delete();
  }
});
