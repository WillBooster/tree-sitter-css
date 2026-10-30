import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  [':matches', '::slotted', ':foo', '::foo'].flatMap((pseudo) =>
    ['a.b', 'a#id', 'a.b.c', 'a.b#id', 'a#id.b', 'svg|a.b'].flatMap((prefix) =>
      [':hover', ':focus-visible', '::before', ':not(.x)', '/**/:hover'].map(
        (suffix) => [pseudo, prefix, suffix] as const
      )
    )
  )
)('compound generic pseudo selectors retain suffixes: %s(%s%s)', (pseudo, prefix, suffix) => {
  const parser = new Parser().setLanguage(language);
  const source = `${pseudo}(${prefix}${suffix}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(
      first
        .descendantsOfType('tag_name')
        .some((node) => node.text === 'a' && node.startIndex === source.indexOf('a', pseudo.length + 1))
    ).toBe(true);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  [':foo', ':lang', '::foo'].flatMap((pseudo) =>
    [
      'foo@bar',
      'foo?bar',
      'foo&bar',
      'foo$bar',
      'foo^bar',
      'foo=bar',
      '<length>',
      '<custom-ident>+',
      'en-*',
      '*-Latn',
    ].map((value) => [pseudo, value] as const)
  )
)('generic pseudo components retain accepted argument and following ranges: %s(%s)', (pseudo, value) => {
  const parser = new Parser().setLanguage(language);
  const selector = `${pseudo}(${value})`;
  const source = `${selector}{} .after{color:red;}`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.firstNamedChild?.text).toBe(selector);
    expect(tree.rootNode.descendantsOfType('arguments').map((node) => node.text)).toEqual([`(${value})`]);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after{color:red;}');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  [':matches', ':-webkit-any', ':foo', '::foo'].flatMap((pseudo) =>
    ['b', '.b', '#id', ':hover', '::before', '> b', '&', '*', '[x]'].map((tail) => [pseudo, tail] as const)
  )
)('generic pseudo arguments keep a spaced universal selector: %s(a * %s)', (pseudo, tail) => {
  const parser = new Parser().setLanguage(language);
  const source = `${pseudo}(a * ${tail}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild!.descendantsOfType('universal_selector').length).toBeGreaterThan(0);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([':not(.x/**/+.y)', ':is(a/**/+b)', ':has(a/* c */+b)', ':foo(a/**/+b)'])(
  'a comment glued before `+` keeps the adjacent-sibling combinator: %s',
  (selector) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(`${selector} {}`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const argument = tree.rootNode.descendantsOfType('arguments')[0]!.firstNamedChild!;
      expect(argument.type).toBe('adjacent_sibling_selector');
      expect(argument.text).toBe(selector.slice(selector.indexOf('(') + 1, -1));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
