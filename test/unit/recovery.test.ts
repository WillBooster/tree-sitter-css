import path from 'node:path';
import { expect, test } from 'vitest';

import { Language, Parser } from '@willbooster/web-tree-sitter';

test('preserves empty-value recovery and the following declaration', async () => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
  const tree = parser.parse('a { --x: ; color: red; }');
  try {
    expect(tree?.rootNode.toString()).toBe(
      '(stylesheet (rule_set (selectors (tag_name)) (block (declaration (property_name) (integer_value (MISSING "integer_value_token1"))) (declaration (property_name) (plain_value)))))'
    );
  } finally {
    tree?.delete();
    parser.delete();
  }
});

test.each([
  ['a:hover', '(stylesheet (ERROR (pseudo_class_selector (tag_name) (class_name (identifier)))))'],
  [
    'a { b:hover',
    '(stylesheet (ERROR (selectors (tag_name)) (pseudo_class_selector (tag_name) (class_name (identifier)))))',
  ],
])('preserves pseudo-class recovery at EOF for %s', async (source, expected) => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm')));
  const tree = parser.parse(source);
  try {
    expect(tree?.rootNode.toString()).toBe(expected);
  } finally {
    tree?.delete();
    parser.delete();
  }
});
