import path from 'node:path';
import fs from 'node:fs';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  ['not(.x', 'is(.x,.y', 'where(.x', 'has(> b', 'not(.x, )', 'is(.x,.y, )', 'where(.x,)', 'has(> b,)'].flatMap(
    (argument) => ['', ' ', '/**/'].map((gap) => [argument, gap] as const)
  )
)('incomplete selector functions retain selector nodes and captures: %s%s', (argument, gap) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const source = `a:${argument}${gap}{ color: red; } .after { background: blue; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(true);
    const pseudo = tree.rootNode.descendantsOfType('pseudo_class_selector')[0]!;
    expect(pseudo).toBeDefined();
    expect(pseudo.startIndex).toBe(0);
    expect(pseudo.endIndex).toBeLessThanOrEqual(source.indexOf('{'));
    expect(pseudo.descendantsOfType('arguments')).toHaveLength(1);
    for (const name of ['x', 'y'].filter((name) => argument.includes(`.${name}`))) {
      const className = pseudo.descendantsOfType('class_name').find((node) => node.text === name)!;
      expect(className.startIndex).toBe(source.indexOf(`.${name}`) + 1);
      expect(
        query.captures(pseudo).some(({ name: capture, node }) => capture === 'property' && node.text === name)
      ).toBe(true);
    }
    expect(
      query
        .captures(pseudo)
        .filter(({ name }) => name === 'attribute')
        .map(({ node }) => node.text)
    ).toContain(argument.slice(0, argument.indexOf('(')));
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { background: blue; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color', 'background']);
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  [':foo', '::foo', ':matches', '::slotted'].flatMap((name) =>
    ['.x', '.x:hover', String.raw`.\63 lass`, '.x .y', '.x > .y', '.x/**/:hover'].map(
      (selector) => [name, selector] as const
    )
  )
)('generic pseudos retain class selector nodes and captures: %s(%s)', (name, selector) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const source = `${name}(${selector}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(first.descendantsOfType('class_selector').length).toBeGreaterThan(0);
    expect(
      query
        .captures(first)
        .some(({ name: capture, node }) => capture === 'property' && ['x', String.raw`\63 lass`].includes(node.text))
    ).toBe(true);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
