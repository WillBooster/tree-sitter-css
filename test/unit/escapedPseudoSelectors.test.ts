import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

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

const valueRuns = [
  ['1 2', ['1', '2']],
  ['1 + 2 * 3', ['1', '2', '3']],
  ['1 /* c */ + 2 * 3', ['1', '2', '3']],
  ['"a" "b" "c"', []],
  ['f(x) g(y) h(z)', []],
  ['1 2 3', ['1', '2', '3']],
  ['1 2 3 4', ['1', '2', '3', '4']],
  ['1px 2px 3px', ['1px', '2px', '3px']],
  ['1 2 1 2', ['1', '2', '1', '2']],
  ['b, 1 /* c */', ['1']],
  ['1 /* c */ 1 /* c */', ['1', '1']],
  ['fn(1 2 3) 4 5', ['1', '2', '3', '4', '5']],
] as const;

test.each(
  [':foo', ':lang', '::foo'].flatMap((pseudo) =>
    ['', 'a'].flatMap((prefix) => valueRuns.map(([args, numbers]) => [prefix, pseudo, args, numbers] as const))
  )
)('generic pseudo value runs retain their owning selector: %s%s(%s)', (prefix, pseudo, args, numbers) => {
  const parser = new Parser().setLanguage(language);
  const selector = `${prefix}${pseudo}(${args})`;
  const source = `${selector} { c: d; } .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const rule = tree.rootNode.firstNamedChild!;
    expect(rule.firstNamedChild!.text).toBe(selector);
    const argument = rule.descendantsOfType('arguments')[0]!;
    expect(argument.text).toBe(`(${args})`);
    expect(argument.startIndex).toBe(selector.indexOf('('));
    expect(argument.endIndex).toBe(selector.length);
    expect(argument.descendantsOfType('integer_value').map((node) => node.text)).toEqual(numbers);
    if (args.includes(' + 2 * 3')) {
      const binaries = argument.descendantsOfType('binary_expression');
      expect(binaries.map((node) => node.text)).toEqual([args, args.slice(0, args.indexOf(' * 3'))]);
      for (const binary of binaries) {
        expect(binary.namedChildren.filter((node) => node.type !== 'comment')).toHaveLength(2);
      }
    }
    expect(argument.descendantsOfType('comment').map((node) => node.text)).toEqual(args.match(/\/\* c \*\//g) ?? []);
    expect(rule.descendantsOfType('property_name').map((node) => node.text)).toEqual(['c']);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});
