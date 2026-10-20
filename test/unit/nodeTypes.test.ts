import path from 'node:path';
import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import nodeTypes from '../../src/node-types.json';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-css.wasm'));

test.each(['article {}', '@scope (style) {}', '@scope ([style]) {}', '@scope to ([and=or]) {}'])(
  'published node metadata describes emitted selector nodes: %s',
  (source) => {
    const parser = new Parser().setLanguage(language);
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      const pending = [tree.rootNode];
      while (pending.length > 0) {
        const node = pending.pop()!;
        const definition = nodeTypes.find(({ type, named }) => type === node.type && named === node.isNamed);
        expect(definition, node.type).toBeDefined();
        if (definition?.children?.required) expect(node.namedChildCount, node.type).toBeGreaterThan(0);
        pending.push(...node.namedChildren);
      }
    } finally {
      tree.delete();
      parser.delete();
    }
  }
);
