import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
await Parser.init();
const language = await Language.load(path.join(root, 'tree-sitter-css.wasm'));

test.each(['\n', '\r\n', '\r', '\f'].flatMap((newline) => ['"', "'"].map((quote) => [newline, quote])))(
  'string continuation across %j in %s preserves following declarations',
  (newline, quote) => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = `a { content: ${quote}one\\${newline}two${quote}; color: red; }`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('string_value').map((node) => node.text)).toEqual([
        `${quote}one\\${newline}two${quote}`,
      ]);
      expect(tree.rootNode.descendantsOfType('escape_sequence').map((node) => node.text)).toEqual([`\\${newline}`]);
      expect(tree.rootNode.descendantsOfType('declaration').at(-1)?.text).toBe('color: red;');
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
