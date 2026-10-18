import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each([
  ['url(x)', 'layer(theme)', 'supports(display: grid)', 'screen'],
  ['"x"', 'layer(framework.component)', '', ''],
  ['"x"', 'layer', '', 'screen and (width > 30px)'],
  ['"x"', 'layer()', 'supports((display: grid) and (color: red))', 'print, screen'],
  ['"x"', '', 'supports(selector(:has(.a)))', ''],
  ['"x"', 'LAYER(theme)', 'SUPPORTS(display: grid)', 'screen'],
  ['"x"', String.raw`l\61 yer(theme)`, String.raw`s\75 pports(display: grid)`, ''],
])('import conditions retain their boundaries: %s %s %s %s', (url, layer, supports, media) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const source = `@import ${url} ${layer} ${supports} ${media};`;
  const tree = parser.parse(`${source} .after { color: red; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const statement = tree.rootNode.firstNamedChild!;
    expect(statement.type).toBe('import_statement');
    expect(statement.text).toBe(source);
    expect(statement.descendantsOfType('import_layer').map((node) => node.text)).toEqual(layer ? [layer] : []);
    expect(statement.descendantsOfType('import_supports').map((node) => node.text)).toEqual(supports ? [supports] : []);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['supports', 'screen and (width > 30px)', 'print, screen', 'layered'])(
  'ordinary import media queries remain structured: %s',
  (media) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(`@import "x" ${media};`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const statement = tree.rootNode.firstNamedChild!;
      expect(statement.type).toBe('import_statement');
      expect(statement.descendantsOfType('import_layer')).toHaveLength(0);
      expect(statement.descendantsOfType('import_supports')).toHaveLength(0);
      expect(statement.descendantsOfType('keyword_query').length).toBeGreaterThan(0);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
