import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));

test.each(
  ['\n', '\r\n', '\f'].flatMap((newline) =>
    ['display', String.raw`--\61`].flatMap((property) => [' ', ''].map((gap) => [newline, property, gap]))
  )
)('reports a missing colon across %j before %s with gap %j', (newline, property, gap) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const source = `div {${newline}  padding${newline}  ${property}:${gap}flex;${newline}  color: red;${newline}}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.endIndex).toBe(source.length);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ['div { padding\n: 1px; display: flex; }', 'display: flex;'],
  ['div { padding: 1px\n 2px; display: flex; }', 'display: flex;'],
  ['div { padding\n display:hover { color: red; } }', 'color: red;'],
  ['div { padding\n display { color: red; } }', 'color: red;'],
])('valid multiline declarations and nested selectors stay complete: %s', (source, lastDeclaration) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.endIndex).toBe(source.length);
    expect(tree.rootNode.descendantsOfType('declaration').at(-1)?.text).toBe(lastDeclaration);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  'padding\ndisplay:flex;',
  'div { padding\n /* comment */ display:flex; }',
  'div { padding /* comment */\n display:/* value */flex; }',
  'div { padding\n // comment\n display:flex; }',
  'div { padding\n display/**/:flex; }',
])('reports missing colons in commented declarations and inline snippets: %s', (source) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    expect(tree.rootNode.endIndex).toBe(source.length);
  } finally {
    tree.delete();
    parser.delete();
  }
});
