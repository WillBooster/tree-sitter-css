import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const offsets = [
  '2n-1',
  '2n -1',
  '2n- 1',
  '2n - 1',
  '-n-1',
  '+2N -2',
  '2n\n-\t1',
  '2n\r\n-1',
  '2n\f-\t1',
  '2n/**/-1',
  '2n/**/-/**/1',
  '2n /**/ -1',
  '2n/**/ -1',
  '2n /**/-1',
  '2n /**/ - /**/ 1',
  '2n\r\n/**/\t-\r\n/**/\t1',
  '2n /* gap */ +1',
  '-n /**/ -1',
  '+2N /**/ -2',
  'n /**/ + /**/ 1',
  '2n',
  '-n',
  '+2N',
  '2n /**/',
  '2n /* gap */ ',
  '2n\r\n/**/\t',
  'odd',
  'ODD',
  'eVeN',
  String.raw`\6f dd`,
  String.raw`\65 ven`,
  String.raw`o\64 d`,
  String.raw`ev\65 n`,
];
const filters = [
  '',
  ' of .a, .b',
  ' OF .a, .b',
  ' oF .a, .b',
  String.raw` \6f f .a, .b`,
  String.raw` o\66 .a, .b`,
  String.raw` \6f\66 .a, .b`,
];

test.each(
  ['nth-child', 'nth-last-child'].flatMap((name) =>
    offsets.flatMap((offset) =>
      filters.flatMap((filter) => ['rule', 'start', 'end'].map((context) => [name, offset, filter, context] as const))
    )
  )
)('nth notation retains selector boundaries: %s(%s%s) in %s', (name, offset, filter, context) => {
  const parser = new Parser().setLanguage(language);
  const selector = `:${name}(${offset}${filter})`;
  const first = context === 'rule' ? `${selector} {}` : `@scope ${context === 'end' ? 'to ' : ''}(${selector}) {}`;
  const source = `${first} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const owner = tree.rootNode.firstNamedChild!;
    if (context !== 'rule') {
      expect(owner.type).toBe('scope_statement');
      expect(owner.childForFieldName(context)?.text).toBe(selector);
    }
    const pseudo = owner.descendantsOfType('pseudo_class_selector')[0]!;
    expect(pseudo.text).toBe(selector);
    expect(pseudo.startIndex).toBe(source.indexOf(selector));
    expect(pseudo.endIndex).toBe(source.indexOf(selector) + selector.length);
    expect(pseudo.descendantsOfType('comment').map((node) => node.text)).toEqual(
      offset.match(/\/\*[\s\S]*?\*\//g) ?? []
    );
    if (filter) {
      expect(pseudo.descendantsOfType('class_selector').map((node) => node.text)).toEqual(['.a', '.b']);
    }
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color']);
  } finally {
    tree.delete();
    parser.delete();
  }
});
