import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const values = [String.raw`e\6e -US`, String.raw`e\00006e -US`, 'en-US', String.raw`e\6e/**/-US`, '"en-US"'];
const argumentsLists = values.flatMap((value) =>
  [value, `en, ${value}`, `en, ${value}, fr`].map((args) => [args, value] as const)
);
const pseudos = [':lang', ':foo', '::foo'];

test.each(pseudos.flatMap((pseudo) => argumentsLists.map(([args, value]) => [pseudo, args, value] as const)))(
  'generic pseudo arguments preserve escaped values: %s(%s)',
  (pseudo, args, value) => {
    const parser = new Parser().setLanguage(language);
    const selector = `${pseudo}(${args})`;
    const source = `${selector} {} .after { color: red; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.firstNamedChild!.firstNamedChild!.text).toBe(selector);
      expect(tree.rootNode.descendantsOfType('arguments').map((node) => node.text)).toEqual([`(${args})`]);
      if (value.includes('\\') && !value.includes('/**/')) {
        expect(tree.rootNode.descendantsOfType('plain_value').map((node) => node.text)).toContain(value);
      }
      expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual(
        args.includes('/**/') ? ['/**/'] : []
      );
      const following = tree.rootNode.lastNamedChild!;
      expect(following.type).toBe('rule_set');
      expect(following.text).toBe('.after { color: red; }');
      expect(following.startIndex).toBe(source.indexOf('.after'));
      expect(tree.rootNode.descendantsOfType('declaration').map((node) => node.text)).toEqual(['color: red;']);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(
  [':foo', '::foo', ':nth-of-type', ':nth-last-of-type', ':nth-col'].flatMap((pseudo) =>
    [
      ['1 + 2 * 3', '1 + 2'],
      ['1 - 2 - 3', '1 - 2'],
      ['1 * 2 * 3', '1 * 2'],
      ['2n + 1 + 3', '2n + 1'],
    ].map(([value, left]) => [pseudo, value!, left!] as const)
  )
)('generic pseudo arithmetic stays left associative: %s(%s)', (pseudo, value, left) => {
  const parser = new Parser().setLanguage(language);
  const source = `a${pseudo}(${value}) { c: d; } .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const binary = tree.rootNode.descendantsOfType('binary_expression');
    expect(binary).toHaveLength(2);
    expect(binary[0]!.text).toBe(value);
    expect(binary[0]!.firstNamedChild!.type).toBe('binary_expression');
    expect(binary[0]!.lastNamedChild!.type).toBe('integer_value');
    expect(binary[1]!.text).toBe(left);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

const valueRuns = [
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
    expect(argument.descendantsOfType('comment').map((node) => node.text)).toEqual(args.match(/\/\* c \*\//g) ?? []);
    expect(rule.descendantsOfType('property_name').map((node) => node.text)).toEqual(['c']);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});
