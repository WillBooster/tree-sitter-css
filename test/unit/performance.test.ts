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

// Thread CPU time excludes unrelated concurrent test work; batching avoids zero-duration Linux samples.
// Fastest alternating samples limit scheduler/GC noise while retaining a ratio sensitive to superlinear growth.
test.each([
  ['unexpected value punctuation', 'a { b: ) }\n', '', '', true],
  ['comment punctuation before a delimiter value', 'a { b: /* }; : { */ ? }\n', '', '', false],
  ['comment punctuation before an invalid closer', 'a { b: /* }; : { */ ] }\n', '', '', true],
  ['comment braces inside one delimiter-value block', 'b:/*{*/?', 'a{', '}', false],
  ['comment braces inside one malformed block', 'b:/*{*/]', 'a{', '}', true],
  ['unterminated comments after dot components', ' .a/*', 'a{b:f(', '', true],
  ['ampersand components in function arguments', '& word ', 'a { b: f(', '); } .after {}', false],
  ['asterisk components in function arguments', '* word ', 'a { b: f(', '); } .after {}', false],
  ['dot components in function arguments', '.token ', 'a { b: f(', '); } .after {}', false],
  ['generic prelude with scheme-like components', 'a+', '.a { @apply ', 'a; color: red; }', false],
])('parses %s in linear time', { timeout: 60_000 }, (_name, source, prefix, suffix, hasError) => {
  const small = prefix + source.repeat(2000) + suffix;
  const large = prefix + source.repeat(20_000) + suffix;
  expect(parseGrowth(small, large, hasError)).toBeLessThan(18);
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
  expect(parseGrowth(small, large, false)).toBeLessThan(8);
  const tree = parser.parse(large)!;
  try {
    expect(tree.rootNode.firstNamedChild?.type).toBe('scope_statement');
    expect(tree.rootNode.descendantsOfType('comment')).toHaveLength(4000);
    expect(tree.rootNode.lastNamedChild?.text).toBe('.after {}');
  } finally {
    tree.delete();
  }
});

test.each(['&', '*'])(
  'parses nested %s prefixes before a malformed brace in linear time',
  { timeout: 30_000 },
  (prefix) => {
    const source = (count: number): string =>
      'a { --x: f(' + `${prefix} f(`.repeat(count) + '{' + ')'.repeat(count + 1) + '; } .after {}';
    expect(parseGrowth(source(1000), source(4000), true)).toBeLessThan(8);
  }
);

function parseGrowth(small: string, large: string, expectedError: boolean): number {
  parseCpuTime(large, expectedError);
  parseCpuTime(large, expectedError);
  let iterations = 1;
  let smallFastest = 0;
  let largeFastest = Infinity;
  while (smallFastest < 20_000) {
    smallFastest = Infinity;
    largeFastest = Infinity;
    for (let run = 0; run < 5; run++) {
      smallFastest = Math.min(smallFastest, parseCpuTime(small, expectedError, iterations));
      largeFastest = Math.min(largeFastest, parseCpuTime(large, expectedError, iterations));
    }
    if (smallFastest < 20_000) iterations *= 2;
  }
  return largeFastest / smallFastest;
}

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
