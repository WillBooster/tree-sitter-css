import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const components = [
  ['[a,b]', 'grid_value'],
  ['[1px]', 'grid_value'],
  ['1 + 2', 'binary_expression'],
  ['1 + 2 * 3', 'binary_expression'],
  ['f(1)', 'call_expression'],
] as const;

test.each(
  [':foo', '::foo', ':matches', '::slotted'].flatMap((pseudo) =>
    components.flatMap(([component, type]) =>
      [String.raw`a\31 b`, String.raw`e\6e -US`].flatMap((escaped) =>
        [
          `${component} ${escaped}`,
          `${escaped} ${component}`,
          `${component} ${escaped} ${component}`,
          `${escaped} ${component} ${escaped}`,
        ]
          .filter((argumentsText) => type !== 'grid_value' || !argumentsText.startsWith(component))
          .map((argumentsText) => [pseudo, component, type, escaped, argumentsText] as const)
      )
    )
  )
)(
  'mixed escaped pseudo arguments retain component nodes and ranges: %s(%s)',
  (pseudo, component, type, escaped, argumentsText) => {
    const parser = new Parser().setLanguage(language);
    const source = `${pseudo}(${argumentsText}) {} .after { color: red; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const first = tree.rootNode.firstNamedChild!;
      expect(
        first
          .descendantsOfType(type)
          .some((node) => node.text === component && node.startIndex === source.indexOf(component))
      ).toBe(true);
      expect(
        first
          .descendantsOfType('plain_value')
          .some((node) => node.text === escaped && node.startIndex === source.indexOf(escaped))
      ).toBe(true);
      expect(first.descendantsOfType('arguments')[0]?.text).toBe(`(${argumentsText})`);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(source.indexOf('.after'));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
