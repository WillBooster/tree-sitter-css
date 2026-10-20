import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));
const followingRules = ['.r1 { color: red; }', '.r2 { padding: 1px; }'];

const malformed = [
  `layer("theme););`,
  `layer('theme););`,
  `layer("););`,
  `layer('););`,
  `layer("a"));`,
  `layer('a'));`,
  `supports(display: grid) s"creen;`,
  `supports(display: grid) s'creen;`,
  `layer(theme) supports(display: grid) s"creen;`,
  `layer(theme) s"creen;`,
  `layer(theme) s'creen;`,
  String.raw`\6c ayer("theme););`,
];

test.each(malformed.flatMap((prelude) => [' ', '/**/', '/* condition */\n'].map((gap) => [prelude, gap])))(
  'malformed import conditions preserve following rules: %s %s',
  (prelude, gap) => {
    const parser = new Parser().setLanguage(language);
    const source = `@import "x"${gap}${prelude}\n${followingRules.join('\n')}\n`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      expect(
        tree.rootNode.descendantsOfType('rule_set').map((node) => [node.text, node.startIndex, node.endIndex])
      ).toEqual(followingRules.map((rule) => [rule, source.indexOf(rule), source.indexOf(rule) + rule.length]));
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);

test.each([
  `layer(theme);`,
  `layer(a/**/./**/b) screen;`,
  `supports(display: grid) -foo;`,
  `layer(theme) (unknown: "a;b)");`,
  `supports(display: grid) (unknown: "a;b)");`,
  String.raw`layer(a\"b);`,
])('valid import components retain condition and following-rule boundaries: %s', (prelude) => {
  const parser = new Parser().setLanguage(language);
  const statement = `@import "x" ${prelude}`;
  const source = `${statement}\n${followingRules.join('\n')}\n`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.firstNamedChild?.type).toBe('import_statement');
    expect(tree.rootNode.firstNamedChild?.text).toBe(statement);
    expect(tree.rootNode.descendantsOfType('rule_set').map((node) => node.text)).toEqual(followingRules);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test.each([`${'future('.repeat(512)}token${')'.repeat(512)}`, Array.from({ length: 4000 }, () => '{a:b;}').join(' ')])(
  'valid deeply nested or long component values retain their import boundaries',
  (value) => {
    const parser = new Parser().setLanguage(language);
    const statement = `@import "x" supports(--theme: ${value});`;
    const source = `${statement}\n.after { color: red; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.firstNamedChild?.text).toBe(statement);
      expect(tree.rootNode.lastNamedChild?.text).toBe('.after { color: red; }');
      expect(tree.rootNode.lastNamedChild?.startIndex).toBe(statement.length + 1);
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
