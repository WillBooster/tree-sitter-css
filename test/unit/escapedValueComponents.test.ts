import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  [
    ['font-family', String.raw`Arial, \5FAE\8F6F\96C5\9ED1, sans-serif`, String.raw`\5FAE\8F6F\96C5\9ED1`],
    ['font-family', String.raw`x, \5FAE`, String.raw`\5FAE`],
    ['background', String.raw`url(x) no-repeat \9`, String.raw`\9`],
    ['b', String.raw`c(d) e \9`, String.raw`\9`],
    ['color', String.raw`r\65 d`, String.raw`r\65 d`],
    ['--x', String.raw`foo\;`, String.raw`foo\;`],
    ['--x', String.raw`foo\}`, String.raw`foo\}`],
    ['--x', String.raw`foo\{`, String.raw`foo\{`],
    ['--x', String.raw`foo\/bar`, String.raw`foo\/bar`],
    ['--x', String.raw`foo\\ /* real */ red`, String.raw`foo\\`],
  ].flatMap(([property, value, atom]) =>
    ['complete', 'final', 'inline'].map((layout) => [property!, value!, atom!, layout] as const)
  )
)('escaped declaration components retain ownership: %s %s (%s) in %s', (property, value, atom, layout) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const endsWithShortHexEscape = /\\[0-9a-f]{1,5}$/i.test(value);
  const declaration = `${property}: ${value}${layout === 'final' ? (endsWithShortHexEscape ? ' ' : '') : ';'}`;
  const content = layout === 'final' ? `color: blue; ${declaration}` : `${declaration} color: blue;`;
  const source = layout === 'inline' ? content : `a { ${content} } .after { background: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const parsed = tree.rootNode.descendantsOfType('declaration').find((node) => node.text === declaration);
    expect(parsed?.startIndex).toBe(source.indexOf(declaration));
    expect(parsed?.endIndex).toBe(source.indexOf(declaration) + declaration.length);
    const identifierText = `${atom}${layout === 'final' && endsWithShortHexEscape ? ' ' : ''}`;
    const identifier = parsed?.descendantsOfType('plain_value').find((node) => node.text === identifierText);
    expect(identifier?.startIndex).toBe(source.indexOf(atom));
    expect(identifier?.endIndex).toBe(source.indexOf(atom) + identifierText.length);
    expect(
      query
        .captures(parsed!)
        .filter(({ name }) => name === 'property')
        .map(({ node }) => node.text)
    ).toEqual([property]);
    expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual(
      value.includes('/* real */') ? ['/* real */'] : []
    );
    const following = tree.rootNode.descendantsOfType('declaration').find((node) => node.text === 'color: blue;');
    expect(following?.startIndex).toBe(source.indexOf('color: blue;'));
    if (layout !== 'inline') {
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after { background: red; }');
      expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  ['.', '=', '%', '?', '@', '#', '&', '|', '^', '$', '~', ':', '<', '>', '*', '+', '/', '`'].flatMap((delimiter) =>
    ['', 'a'].flatMap((suffix) => [false, true].map((semicolon) => [delimiter, suffix, semicolon] as const))
  )
)('escaped function values retain delimiter tails: %s%s %s', (delimiter, suffix, semicolon) => {
  const parser = new Parser().setLanguage(language);
  const atom = String.raw`a\31 b`;
  const value = `f(${atom}${delimiter}${suffix})`;
  const declaration = `--x: ${value}${semicolon ? ';' : ''}`;
  const source = `a { ${declaration} } .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(first.descendantsOfType('declaration').map((node) => node.text)).toEqual([declaration]);
    expect(first.descendantsOfType('call_expression').map((node) => node.text)).toEqual([value]);
    const identifier = first.descendantsOfType('plain_value').find((node) => node.text === atom);
    expect(identifier?.startIndex).toBe(source.indexOf(atom));
    expect(identifier?.endIndex).toBe(source.indexOf(atom) + atom.length);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild!.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  [String.raw`a\31 b`, String.raw`\61 b`].flatMap((atom) =>
    [':', ': c', '.c', '#', '#c', '+', '*', '>c', '&c', '|c', '~c', '@c'].flatMap((tail) =>
      ['--x', 'x'].map((name) => [name, `${atom}${tail}`] as const)
    )
  )
)('escaped values keep the tails plain values continue through: %s: %s', (name, value) => {
  const parser = new Parser().setLanguage(language);
  const source = `a { ${name}: ${value}; y: z }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const block = tree.rootNode.firstNamedChild!.descendantsOfType('block')[0]!;
    expect(block.namedChildren.map((node) => node.text)).toEqual([`${name}: ${value};`, 'y: z']);
  } finally {
    tree.delete();
    parser.delete();
  }
});
