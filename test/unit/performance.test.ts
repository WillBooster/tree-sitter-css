import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { generationInputMtime } from '../helpers/generationInputs.js';

import { Language, Parser } from '@willbooster/web-tree-sitter';

const Root = path.join(import.meta.dirname, '../..');
// The Wasm build is the one the package ships.
const WasmPath = path.join(Root, 'tree-sitter-css.wasm');
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(WasmPath));

// The tests load the existing Wasm build, so a stale one would hide an edit that makes error recovery slower than linear.
test('uses a Wasm build built from the current parser', () => {
  const sources = ['grammar.js', 'src/parser.c', 'src/scanner.c', 'src/tree_sitter/parser.h'].map(
    (name) => fs.statSync(path.join(Root, name)).mtimeMs
  );
  expect(
    Math.max(generationInputMtime(Root), ...sources) > fs.statSync(WasmPath).mtimeMs,
    'generation inputs or src/ changed after the Wasm build was built; run `bun run build/ci`'
  ).toBe(false);
});

// Consumers parse files being edited, so recovering from many errors must stay linear: ten times the input takes about
// ten times as long, against a hundred times for quadratic recovery. The ratio catches a cost that grows faster than
// the input even on a slow CI runner. The parses are timed in the CPU time of the thread that runs them: wall-clock
// time is inflated unevenly by the test files running alongside, and the process's CPU time also counts the engine's
// background threads, which compile the Wasm build and collect garbage during the parses. 2,000 and 20,000 repetitions are
// measured after warm-up parses and in alternation, each keeping its fastest run; their ratio is about 10 locally, and
// 18 leaves a margin over that while failing for growth faster than about n^1.25.
test.each([
  ['unexpected value punctuation', 'a { b: ) }\n', '', ''],
  ['comment punctuation before an invalid value', 'a { b: /* }; : { */ ? }\n', '', ''],
  ['comment braces inside one malformed block', 'b:/*{*/?', 'a{', '}'],
])('recovers from %s in linear time', { timeout: 60_000 }, (_name, source, prefix, suffix) => {
  const small = prefix + source.repeat(2000) + suffix;
  const large = prefix + source.repeat(20_000) + suffix;
  parseCpuTime(large);
  parseCpuTime(large);
  let smallFastest = Infinity;
  let largeFastest = Infinity;
  for (let run = 0; run < 5; run++) {
    smallFastest = Math.min(smallFastest, parseCpuTime(small));
    largeFastest = Math.min(largeFastest, parseCpuTime(large));
  }
  expect(largeFastest / smallFastest).toBeLessThan(18);
});

function parseCpuTime(source: string): number {
  const start = process.threadCpuUsage();
  const tree = parser.parse(source);
  const { system, user } = process.threadCpuUsage(start);
  if (!tree) throw new Error('The parser returned no tree');
  const { hasError } = tree.rootNode;
  tree.delete();
  expect(hasError).toBe(true);
  return system + user;
}
