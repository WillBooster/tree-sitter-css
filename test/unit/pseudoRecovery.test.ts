import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  ['not(.x', 'is(.x,.y', 'where(.x', 'has(> b', 'not(.x, )', 'is(.x,.y, )', 'where(.x,)', 'has(> b,)'].flatMap(
    (argument) => ['', ' ', '/**/'].map((gap) => [argument, gap] as const)
  )
)('incomplete selector functions retain selector nodes: %s%s', (argument, gap) => {
  const parser = new Parser().setLanguage(language);
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
    }
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { background: blue; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    expect(tree.rootNode.descendantsOfType('property_name').map((node) => node.text)).toEqual(['color', 'background']);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  [':foo', '::foo', ':matches', '::slotted'].flatMap((name) =>
    ['.x', '.x:hover', String.raw`.\63 lass`, '.x .y', '.x > .y', '.x/**/:hover'].map(
      (selector) => [name, selector] as const
    )
  )
)('generic pseudos retain class selector nodes: %s(%s)', (name, selector) => {
  const parser = new Parser().setLanguage(language);
  const source = `${name}(${selector}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const first = tree.rootNode.firstNamedChild!;
    expect(first.descendantsOfType('class_selector').length).toBeGreaterThan(0);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each(
  ['nth-child', 'nth-last-child'].flatMap((name) =>
    ['.a, .b', '.a /**/, /**/ .b', 'article > .a, [data-x="b"] .b'].map((selectors) => [name, selectors] as const)
  )
)('nth selector lists retain pseudo ranges: %s(%s)', (name, selectors) => {
  const parser = new Parser().setLanguage(language);
  const selector = `a:${name}(2n+1 of ${selectors})`;
  const tree = parser.parse(`${selector} { color: red; } .after {}`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const rule = tree.rootNode.firstNamedChild!;
    const pseudo = rule.descendantsOfType('pseudo_class_selector')[0]!;
    expect(pseudo.text).toBe(selector);
    expect(pseudo.startIndex).toBe(0);
    expect(pseudo.endIndex).toBe(selector.length);
    expect(pseudo.descendantsOfType('class_selector').map((node) => node.text)).toEqual(
      expect.arrayContaining(['.a', '.b'])
    );
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
    parser.delete();
  }
});
