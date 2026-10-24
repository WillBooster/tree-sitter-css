import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(
  [':matches', '::slotted', ':foo', '::foo'].flatMap((name) =>
    ['svg|a:hover', 'svg|a:focus-visible', 'svg|a::before', 'svg|a:not(.x)', '*|a:hover', '|a:hover'].map(
      (selector) => [name, selector] as const
    )
  )
)('generic pseudo arguments preserve namespaced selectors: %s(%s)', (name, selector) => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, fs.readFileSync(new URL('../../queries/highlights.scm', import.meta.url), 'utf8'));
  const source = `${name}(${selector}) {} .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const namespace = tree.rootNode.descendantsOfType('namespace_selector')[0]!;
    expect(namespace).toBeDefined();
    expect(namespace.startIndex).toBe(name.length + 1);
    const tag = namespace.descendantsOfType('tag_name').find((node) => node.text === 'a')!;
    expect(tag.startIndex).toBe(source.indexOf('|a') + 1);
    const pseudo = selector.includes('focus-visible')
      ? 'focus-visible'
      : selector.includes('hover')
        ? 'hover'
        : undefined;
    if (pseudo) {
      expect(
        query
          .captures(tree.rootNode.firstNamedChild!)
          .some(({ name: capture, node }) => capture === 'attribute' && node.text === pseudo)
      ).toBe(true);
    }
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test.each(
  ['alpha|beta', 'f(alpha|beta)', 'f(alpha | beta)'].flatMap((value) =>
    ['b', '--x'].flatMap((property) => [false, true].map((semicolon) => [value, property, semicolon] as const))
  )
)('pipe components retain declarations and following ranges: %s %s %s', (value, property, semicolon) => {
  const parser = new Parser().setLanguage(language);
  const declaration = `${property}: ${value}${semicolon ? ';' : ''}`;
  const source = `a { ${declaration} } .after { color: red; }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.descendantsOfType('declaration')[0]?.text).toBe(declaration);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
    expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
  } finally {
    tree.delete();
    parser.delete();
  }
});
