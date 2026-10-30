import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(['from', 'to', 'only', 'selector'].flatMap((name) => ['"x"', 'url(x)'].map((url) => ({ name, url }))))(
  'keyword namespace prefixes retain their name: $name $url',
  ({ name, url }) => {
    const parser = new Parser().setLanguage(language);
    const source = `@namespace ${name} ${url}; .after { color: red; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const prefix = tree.rootNode.descendantsOfType('namespace_name');
      expect(prefix.map((node) => [node.text, node.startIndex, node.endIndex])).toEqual([
        [name, source.indexOf(name), source.indexOf(name) + name.length],
      ]);
      expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each(
  ['from', 'to'].flatMap((name) => [
    { name, source: `@media (${name}) {}`, kind: 'keyword_query' },
    { name, source: `@media (${name}: 1) {}`, kind: 'feature_name' },
    { name, source: `@media not (${name}) {}`, kind: 'keyword_query' },
    { name, source: `@media screen and (${name}) {}`, kind: 'keyword_query' },
  ])
)('keyword media names keep their query role: $source', ({ name, source, kind }) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const names = tree.rootNode.descendantsOfType(kind).filter((node) => node.text === name);
    expect(names.map((node) => [node.startIndex, node.endIndex])).toEqual([
      [source.indexOf(name), source.indexOf(name) + name.length],
    ]);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  ...['from', 'to', 'only', 'selector'].map((value) => ({ feature: 'width', value })),
  ...['from', 'to'].map((feature) => ({ feature, value: 'width' })),
])('keyword media range operands keep feature names: $feature > $value', ({ feature, value }) => {
  const parser = new Parser().setLanguage(language);
  const source = `@media (${feature} > ${value}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const range = tree.rootNode.descendantsOfType('range_query')[0]!;
    expect(range.namedChildren.map((node) => [node.type, node.text])).toEqual([
      ['feature_name', feature],
      ['plain_value', value],
    ]);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['only', 'selector'].flatMap((name) => [
    `@media (${name} > width) {}`,
    `@media (${name} < width < ${name}) {}`,
    `@media (${name}() > width) {}`,
  ])
)('reserved leading media operands remain errors: %s', (source) => {
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['from', 'to', 'only', 'selector'].flatMap((name) =>
    ['url', 'src'].flatMap((kind) => [name, `${name}(a)`].map((modifier) => ({ kind, modifier })))
  )
)('keyword import modifiers retain bare and called forms: $kind $modifier', ({ kind, modifier }) => {
  const parser = new Parser().setLanguage(language);
  const source = `@import ${kind}("x" ${modifier}); .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const argumentsNode = tree.rootNode.descendantsOfType('arguments')[0]!;
    expect(argumentsNode.namedChildren.map((node) => [node.type, node.text])).toEqual([
      ['string_value', '"x"'],
      [modifier.includes('(') ? 'call_expression' : 'plain_value', modifier],
    ]);
    expect(tree.rootNode.lastNamedChild!.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});
