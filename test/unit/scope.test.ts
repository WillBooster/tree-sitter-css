import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));

test('scope limits retain selector fields and highlights when a start is inserted', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
  const source = '@scope to (.limit) { .content { color: red; } } .after {}';
  const tree = parser.parse(source)!;
  const insertion = '(.card, #article) ';
  try {
    const scope = tree.rootNode.firstNamedChild!;
    expect(tree.rootNode.hasError).toBe(false);
    expect(scope.type).toBe('scope_statement');
    expect(scope.childForFieldName('start')).toBeNull();
    expect(scope.childForFieldName('end')?.text).toBe('.limit');
    tree.edit(
      new Edit({
        startIndex: 7,
        oldEndIndex: 7,
        newEndIndex: 7 + insertion.length,
        startPosition: { row: 0, column: 7 },
        oldEndPosition: { row: 0, column: 7 },
        newEndPosition: { row: 0, column: 7 + insertion.length },
      })
    );
    const updated = source.slice(0, 7) + insertion + source.slice(7);
    const incremental = parser.parse(updated, tree)!;
    const fresh = parser.parse(updated)!;
    try {
      expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
      expect(incremental.rootNode.hasError).toBe(false);
      const changedScope = incremental.rootNode.firstNamedChild!;
      expect(changedScope.childForFieldName('start')?.text).toBe('.card, #article');
      expect(changedScope.childForFieldName('end')?.text).toBe('.limit');
      expect(
        query
          .captures(changedScope)
          .filter(({ name }) => name === 'property')
          .map(({ node }) => node.text)
      ).toEqual(['card', 'article', 'limit', 'content', 'color']);
      expect(
        query
          .captures(changedScope)
          .filter(({ name }) => name === 'keyword')
          .map(({ node }) => node.text)
      ).toEqual(['@scope', 'to']);
      expect(incremental.rootNode.lastNamedChild?.text).toBe('.after {}');
    } finally {
      incremental.delete();
      fresh.delete();
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(['article .card', 'article section'])('scope boundaries retain descendant combinators in %s', (selector) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`@scope (${selector}) to (${selector}) { .content {} } .after {}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const scope = tree.rootNode.firstNamedChild!;
    expect(scope.type).toBe('scope_statement');
    for (const field of ['start', 'end']) {
      const boundary = scope.childForFieldName(field)!;
      expect(boundary.text).toBe(selector);
      expect(boundary.descendantsOfType('descendant_selector')).toHaveLength(1);
    }
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(['@scope (.a);', '@scope (.a) to (.b);'])(
  'a terminated scope prelude preserves the following rule: %s',
  (prelude) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(`${prelude}\n.after { color: red; }`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.namedChildCount).toBe(2);
      expect(tree.rootNode.lastNamedChild?.type).toBe('rule_set');
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([String.raw`@scope\74 o`, String.raw`@\73 copeto`])(
  'an escaped unknown keyword stays a complete at-keyword: %s',
  (keyword) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(`${keyword} (.limit) {} .after {}`)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.firstNamedChild?.type).toBe('at_rule');
      expect(tree.rootNode.firstNamedChild?.firstNamedChild?.text).toBe(keyword);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([
  ['#card', 'card'],
  ['article#card', 'card'],
  [String.raw`#\31 foo`, String.raw`\31 foo`],
  [String.raw`article#\#hash`, String.raw`\#hash`],
])('an ID boundary keeps its selector and highlight: %s', (selector, name) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
  const tree = parser.parse(`@scope (${selector}) {}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const scope = tree.rootNode.firstNamedChild!;
    expect(scope.type).toBe('scope_statement');
    const boundary = scope.childForFieldName('start')!;
    expect(boundary.descendantsOfType('id_name').map((node) => node.text)).toEqual([name]);
    expect(
      query
        .captures(boundary)
        .filter(({ name }) => name === 'property')
        .map(({ node }) => node.text)
    ).toEqual([name]);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(['日本語', '𐐀'])('a Unicode ID boundary retains its selector and the following rule: %s', (name) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`@scope (#${name}) {} .after { color: red; }`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.type).toBe('scope_statement');
    expect(tree.rootNode.descendantsOfType('id_name').map((node) => node.text)).toEqual([name]);
    expect(tree.rootNode.lastNamedChild?.type).toBe('rule_set');
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([
  '(.a), (.b)',
  '(.a) foo',
  '(.a) toa (.b)',
  String.raw`(.a) t\6fa (.b)`,
  '(.a) to',
  '(.a) to (.b) to (.c)',
  '(.card) topic (.limit)',
  '(.card) today',
])('an unrecognized scope prelude remains an at-rule: %s', (prelude) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
  const tree = parser.parse(`@scope ${prelude} { h1 { color: red; } } .after {}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.type).toBe('at_rule');
    expect(tree.rootNode.firstNamedChild?.text).toBe(`@scope ${prelude} { h1 { color: red; } }`);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
    expect(
      query
        .captures(tree.rootNode)
        .filter(({ name }) => name === 'keyword')
        .map(({ node }) => node.text)
    ).not.toContain('to');
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
