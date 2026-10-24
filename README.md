# @willbooster/tree-sitter-css

[![npm version](https://img.shields.io/npm/v/@willbooster/tree-sitter-css.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-css)
[![license](https://img.shields.io/npm/l/@willbooster/tree-sitter-css.svg)](https://www.npmjs.com/package/@willbooster/tree-sitter-css)
[![Test](https://github.com/WillBooster/tree-sitter-css/actions/workflows/test.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-css/actions/workflows/test.yml)
[![Test rust](https://github.com/WillBooster/tree-sitter-css/actions/workflows/test-rust.yml/badge.svg)](https://github.com/WillBooster/tree-sitter-css/actions/workflows/test-rust.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![wbfy](https://img.shields.io/badge/wbfy-20.48.8-1e90ff.svg)](https://github.com/WillBooster/shared/tree/main/packages/wbfy)
[![crates.io](https://img.shields.io/crates/v/willbooster-tree-sitter-css.svg)](https://crates.io/crates/willbooster-tree-sitter-css)

CSS grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter), forked from
[tree-sitter/tree-sitter-css](https://github.com/tree-sitter/tree-sitter-css). We are grateful
to its authors and contributors. This is not an official release of that project.

This fork is based on upstream's version 0.23.2 grammar and generates the parser with the
[WillBooster/tree-sitter](https://github.com/WillBooster/tree-sitter) generator. The parser carries that fork's own ABI
number (`0x57420009`) and is tested with that fork's runtime 13.0.0. Upstream's tree-sitter runtime
rejects it; newer fork runtimes with a different minimum grammar ABI also require a regenerated grammar. This grammar accepts keyframe selectors with fractional percentages or comma-separated lists, which upstream 0.23.2
rejects. Attribute selectors accept the case-insensitive `i`/`I` and case-sensitive `s`/`S` flags.
Imports expose optional layer assignment and support conditions before media queries.
Declarations accept CSS whitespace between `!` and `important` and ASCII case variants of that keyword.
Scope statements expose independently optional start and end selector fields.
Custom properties accept empty and comment-only values, including important declarations.
A custom property whose whole value is a `{}` block, as in `--mixin: { color: red; }`, exposes it as a `block_value`.
Escaped function values remain complete in arithmetic and nested parentheses.
Class names accept digit- or hyphen-starting continuations after escape sequences.
Nesting selectors may follow descendant combinators, as in `b &`.
A comment before an explicit combinator keeps both operands, as in `b /* c */ > d`.
Attribute names accept CSS escape sequences, including namespace prefixes and local names.
Values accept angle-bracket type names such as `attr(size type(<number>), 0)`, including `+` and `#` list multipliers.
Declaration property names accept CSS escape sequences, including custom-property names (`\63 olor`, `co\6c or`, `--\63 olor`).
Generic pseudo arguments keep compound and namespaced selectors, as in `:matches(a.b:hover)` and `:foo(svg|a)`.
Legacy star-prefixed declaration names, such as `*display`, remain single property names.
Blocks, inline declaration lists, and stylesheets accept empty semicolon statements, including between top-level rules.
The HTML comment markers `<!--` and `-->` are skipped like comments wherever a comment is allowed and are absent from the tree; CSS ignores them only between top-level statements, so inside selectors, preludes and values this parser also hides markers that CSS would keep as invalid tokens.
A stylesheet may end with a declaration without a trailing semicolon, as in inline style content such as `color: red`.
Incomplete input can produce an `ERROR` root instead of `stylesheet`, including a single block with an
unterminated string (`a { content: "x`) and nested unclosed blocks. Consumers must handle
error roots during editing; recovery structure is not guaranteed for arbitrary incomplete input.
Braces and semicolons inside comments do not change whether a construct is a declaration or a selector.
A NUL character inside a token such as a string or a comment is part of that token, where upstream's lexer
reports an error.

## Usage

The npm package ships `tree-sitter-css.wasm` for
[@willbooster/web-tree-sitter](https://www.npmjs.com/package/@willbooster/web-tree-sitter) (tested with version 13.0.0), which runs in Node.js, Bun, browsers, and Cloudflare Workers. In Node.js and Bun, load the grammar from its path:

```js
import { fileURLToPath } from 'node:url';

import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const parser = new Parser();
const wasmPath = fileURLToPath(import.meta.resolve('@willbooster/tree-sitter-css/tree-sitter-css.wasm'));
parser.setLanguage(await Language.load(wasmPath));
const tree = parser.parse('.foo {\n  color: red;\n}\n');
```

In browsers, serve both `.wasm` files and load them by URL (the example uses Vite's `?url` imports):

```js
import cssUrl from '@willbooster/tree-sitter-css/tree-sitter-css.wasm?url';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtimeUrl from '@willbooster/web-tree-sitter/web-tree-sitter.wasm?url';

await Parser.init({ locateFile: () => runtimeUrl });
const parser = new Parser();
parser.setLanguage(await Language.load(cssUrl));
```

Cloudflare Workers do not allow compiling Wasm at run time, so import both `.wasm` files as modules, with or without
Node.js compatibility:

```js
import css from '@willbooster/tree-sitter-css/tree-sitter-css.wasm';
import { Language, Parser } from '@willbooster/web-tree-sitter';
import runtime from '@willbooster/web-tree-sitter/web-tree-sitter.wasm';

await Parser.init({ wasmModule: runtime });
const parser = new Parser();
parser.setLanguage(await Language.load(css));
```

The package also ships `grammar.js`, the queries in `queries/`, and the node types in `src/node-types.json`.

In Rust, depend on the [crate](https://crates.io/crates/willbooster-tree-sitter-css) and on
[willbooster-tree-sitter](https://crates.io/crates/willbooster-tree-sitter), the runtime this package is tested and
fuzzed with:

```toml
[dependencies]
tree-sitter = { package = "willbooster-tree-sitter", version = "=13.0.0" }
tree-sitter-css = { package = "willbooster-tree-sitter-css", version = "7" }
```

```rust
let mut parser = tree_sitter::Parser::new();
parser.set_language(&tree_sitter_css::LANGUAGE.into())?;
```

## Development

```sh
mise install
bun install --frozen-lockfile
bun run test/ci-setup # installs Chromium for the browser test
bun run build/ci
bun run test
script/parse-examples
cargo test
```

The scripts and tests generate, build, test, and parse with `script/tree-sitter`, the tree-sitter CLI of the
WillBooster/tree-sitter runtime version locked in `Cargo.lock`, since the generator and the runtime of upstream's CLI are
not the ones this package ships with. Its first run downloads that CLI from the runtime's GitHub Release, or builds it
with `cargo` (whose build runs the CMake that `mise.toml` pins) when the download fails or the release has no binary that runs here. Run other CLI commands through it as
well (e.g. `script/tree-sitter parse file.css`).

`bun run generate` records a fresh generation profile from the applicable `test/corpus` cases and Git-tracked
files in `examples/`, then generates compact parser tables. The parser also embeds metadata from `tree-sitter.json`. After changing a grammar,
`tree-sitter.json`, a corpus case, or a tracked example,
regenerate and commit `src/`. Stage added or removed examples with `git add -A examples` before generation so the profile uses the intended file list.
Profiles in `.tmp/generation-profiles/` are temporary and must not be committed. `bun run build-wasm`, `bun run build/ci`,
and the release build regenerate the parsers before compiling them.

`bun run test` runs:

- the corpus in `test/corpus`, with the native build and with the Wasm build (the first run downloads the WASI SDK);
- an incremental-parsing check (`test/unit/incremental.test.ts`): `script/fuzz-corpus` runs `tree-sitter fuzz`, which
  edits each corpus case at random, reparses it, undoes the edits, and reparses again. `TREE_SITTER_SEED`,
  `TREE_SITTER_ITERATIONS`, and `TREE_SITTER_EDITS` run other or more edits;
- a check that the real-world CSS files in `examples/`, the checked-in ones and those of the cloned repositories, fail to
  parse exactly as listed in `script/known-failures.txt`. The first run clones the repositories. The example repositories are pinned to commits in
  `script/parse-examples`. After a grammar change or a moved pin alters that list, `script/parse-examples` rewrites it;
  review its diff before committing;
- recovery checks (`test/unit/recovery.test.ts`) for empty declaration values and complete declarations inside unclosed blocks;
- performance checks (`test/unit/performance.test.ts`) for linear recovery on independent invalid-value lines and
  repeated invalid values inside one block, including punctuation inside closed comments. These load the Wasm build through @willbooster/web-tree-sitter;
- a check (`test/unit/runtimeVersion.test.ts`) that `@willbooster/web-tree-sitter` in `package.json` and
  `willbooster-tree-sitter` in `Cargo.lock` are the same version, since the Wasm tests run on the former and the Rust
  tests, the fuzzer, and the CLI on the latter;
- tests that load the Wasm build with @willbooster/web-tree-sitter in Chromium (`test/e2e/browser.test.ts`) and in
  Cloudflare Workers with and without Node.js compatibility (`test/e2e/workers.test.ts`).

The tests and `script/parse-examples` compile the parser into `.tmp/tree-sitter-lib` rather than the CLI's cache shared
by every checkout; `script/fuzz-corpus` builds a parser of its own in `.tmp/fuzz` for each run and deletes it
afterwards.

CI also runs these tests on Linux arm64 and macOS, where the CLI compiles the parser and the scanner natively, and fuzzes the parser
with libFuzzer and sanitizers (`.github/workflows/robustness.yml`).

### References

- [CSS Syntax Guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Syntax)
