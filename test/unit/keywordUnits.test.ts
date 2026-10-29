import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const highlights = fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8');
const keywords = ['from', 'to', 'only', 'selector'];
const contexts = [
  'a { b: f(VALUE); }',
  ':foo(VALUE) {}',
  'a { b: (VALUE); }',
  '@media (width: VALUE) {}',
  '@supports (a: VALUE) {}',
  'a { b: calc(VALUE + 2); }',
];

test.each(keywords.flatMap((unit) => contexts.map((context) => [unit, context])))(
  'keyword dimensions retain units and highlights: %s in %s',
  (unit, context) => {
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, highlights);
    try {
      for (const number of ['1', '-1', '.5', '1e2']) {
        const source = context.replace('VALUE', number + unit);
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError).toBe(false);
          const start = source.indexOf(number + unit) + number.length;
          expect(
            tree.rootNode
              .descendantsOfType('unit')
              .map((node) => [node.text, node.startIndex, node.endIndex, node.parent!.text])
          ).toEqual([[unit, start, start + unit.length, number + unit]]);
          expect(
            query
              .captures(tree.rootNode)
              .filter(({ name }) => name === 'type')
              .map(({ node }) => [node.text, node.startIndex, node.endIndex])
          ).toEqual([[unit, start, start + unit.length]]);
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  }
);

test.each(keywords.flatMap((name) => [' ', '/**/', '/bar', '-x', '"x"'].map((tail) => [name, tail])))(
  'dimension boundaries preserve separated and longer plain values: %s %j',
  (name, tail) => {
    const separated = tail === ' ' || tail === '/**/';
    const value = separated ? `1${tail}${name}` : `1${name}${tail}`;
    const source = `a { b: f(${value}); }`;
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('unit')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('integer_value').map((node) => node.text)).toEqual(['1']);
      const plain = separated ? name : name + tail;
      const start = source.indexOf(plain);
      expect(
        tree.rootNode.descendantsOfType('plain_value').map((node) => [node.text, node.startIndex, node.endIndex])
      ).toEqual([[plain, start, start + plain.length]]);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
