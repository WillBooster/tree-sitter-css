import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { generationInputMtime } from '../helpers/generationInputs.js';

import { Language, Parser } from '@willbooster/web-tree-sitter';

const Root = path.join(import.meta.dirname, '../..');
const WasmPath = path.join(Root, 'tree-sitter-css.wasm');
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(WasmPath));

test('uses a Wasm build built from the current parser', () => {
  const sources = ['grammar.js', 'src/parser.c', 'src/scanner.c', 'src/tree_sitter/parser.h'].map(
    (name) => fs.statSync(path.join(Root, name)).mtimeMs
  );
  expect(
    Math.max(generationInputMtime(Root), ...sources) > fs.statSync(WasmPath).mtimeMs,
    'generation inputs or src/ changed after the Wasm build was built; run `bun run build/ci`'
  ).toBe(false);
});

// Consumers parse files being edited, so parsing and error recovery must stay linear: ten times the input takes about
// ten times as long, against a hundred times for quadratic recovery. The ratio catches a cost that grows faster than
// the input even on a slow CI runner. The parses are timed in the CPU time of the thread that runs them: wall-clock
// time is inflated unevenly by the test files running alongside, and the process's CPU time also counts the engine's
// background threads, which compile the Wasm build and collect garbage during the parses. 2,000 and 20,000 repetitions are
// measured after warm-up parses and in alternation, each keeping its fastest run; their ratio is about 10 locally, and
// 18 leaves a margin over that while failing for growth faster than about n^1.25.
test.each([
  ['unexpected value punctuation', 'a { b: ) }\n', '', '', true],
  ['comment punctuation before a delimiter value', 'a { b: /* }; : { */ ? }\n', '', '', false],
  ['comment punctuation before an invalid closer', 'a { b: /* }; : { */ ] }\n', '', '', true],
  ['comment braces inside one delimiter-value block', 'b:/*{*/?', 'a{', '}', false],
  ['comment braces inside one malformed block', 'b:/*{*/]', 'a{', '}', true],
  ['unterminated comments after dot components', ' .a/*', 'a{b:f(', '', true],
  ['dot components in function arguments', '.token ', 'a { b: f(', '); } .after {}', false],
  ['generic prelude with scheme-like components', 'a+', '.a { @apply ', 'a; color: red; }', false],
])('parses %s in linear time', { timeout: 60_000 }, (_name, source, prefix, suffix, hasError) => {
  const small = prefix + source.repeat(2000) + suffix;
  const large = prefix + source.repeat(20_000) + suffix;
  parseCpuTime(large, hasError);
  parseCpuTime(large, hasError);
  let smallFastest = Infinity;
  let largeFastest = Infinity;
  for (let run = 0; run < 5; run++) {
    smallFastest = Math.min(smallFastest, parseCpuTime(small, hasError));
    largeFastest = Math.min(largeFastest, parseCpuTime(large, hasError));
  }
  expect(largeFastest / smallFastest).toBeLessThan(18);
});

test.each([
  ['descendant', '@scope (a ', '.b) {} .after {}'],
  ['trailing', '@scope (a ', ') {} .after {}'],
  ['attribute', '@scope ([a ', ']) {} .after {}'],
  ['nested selector', '@scope (:has(a ', ')) {} .after {}'],
  ['child', '@scope (a ', '> b) {} .after {}'],
  ['sibling', '@scope (a ', '~ b) {} .after {}'],
  ['adjacent sibling', '@scope (a ', '+ b) {} .after {}'],
  ['attribute flag', '@scope ([a="x" ', 'i]) {} .after {}'],
  ['attribute operator', '@scope ([a ', '= "x"]) {} .after {}'],
  ['selector list', '@scope (a ', ', b) {} .after {}'],
  ['leading scope', '@scope ( ', '.a) {} .after {}'],
  ['leading attribute', '@scope ([ ', 'a]) {} .after {}'],
  ['leading function', '@scope (:has( ', 'a)) {} .after {}'],
  ['nth clause', '@scope (:nth-child(2n ', 'of .a)) {} .after {}'],
  ['nth selector', '@scope (:nth-child(2n of ', '.a)) {} .after {}'],
  ['selector query', '@scope { @supports selector(a ', ') { .x {} } } .after {}'],
])('parses repeated %s scope comments in linear time', { timeout: 30_000 }, (_name, prefix, suffix) => {
  const small = prefix + '/**/ '.repeat(1000) + suffix;
  const large = prefix + '/**/ '.repeat(4000) + suffix;
  parseCpuTime(large, false);
  // Single parses can register zero CPU time on Linux; compare equal batches above the timer's resolution.
  const minimumSampleMicroseconds = 20_000;
  let iterations = 1;
  let smallFastest = 0;
  let largeFastest = Infinity;
  while (smallFastest < minimumSampleMicroseconds) {
    smallFastest = Infinity;
    largeFastest = Infinity;
    for (let run = 0; run < 3; run++) {
      smallFastest = Math.min(smallFastest, parseCpuTime(small, false, iterations));
      largeFastest = Math.min(largeFastest, parseCpuTime(large, false, iterations));
    }
    if (smallFastest < minimumSampleMicroseconds) iterations *= 2;
  }
  expect(largeFastest / smallFastest).toBeLessThan(8);
  const tree = parser.parse(large)!;
  try {
    expect(tree.rootNode.firstNamedChild?.type).toBe('scope_statement');
    expect(tree.rootNode.descendantsOfType('comment')).toHaveLength(4000);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
  }
});

function parseCpuTime(source: string, expectedError: boolean, iterations = 1): number {
  const start = process.threadCpuUsage();
  let hasUnexpectedError = false;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const tree = parser.parse(source);
    if (!tree) throw new Error('The parser returned no tree');
    hasUnexpectedError ||= tree.rootNode.hasError !== expectedError;
    tree.delete();
  }
  const { system, user } = process.threadCpuUsage(start);
  expect(hasUnexpectedError).toBe(false);
  return system + user;
}
