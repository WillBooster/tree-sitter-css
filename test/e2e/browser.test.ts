import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';
import { expect, test } from 'vitest';

import cssUrl from '../../tree-sitter-css.wasm?url';
import { Source, Tree } from '../fixtures/parse.js';

test('parses CSS in a browser, loading the Wasm files over HTTP', async () => {
  await Parser.init({ locateFile: () => runtimeUrl });
  const parser = new Parser();
  parser.setLanguage(await Language.load(cssUrl));
  expect(parser.parse(Source)?.rootNode.toString()).toBe(Tree);
});
