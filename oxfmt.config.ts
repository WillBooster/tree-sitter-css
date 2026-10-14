// wbfy:start oxfmt-base
import type { OxfmtConfig } from 'oxfmt';

// oxlint-disable unicorn/prefer-module -- Oxfmt config files are only auto-discovered as .ts, and CommonJS avoids ESM package loading issues.
const oxfmtConfig = require('@willbooster/oxfmt-config');

const oxfmtResolvedConfig: OxfmtConfig = oxfmtConfig.default ?? oxfmtConfig;
// wbfy:end oxfmt-base

// Keep generator output and the grammar's upstream layout to make semantic changes easy to compare.
// examples/ holds real-world CSS that the parser is profiled and tested on as written.
oxfmtResolvedConfig.ignorePatterns = [
  ...(oxfmtResolvedConfig.ignorePatterns ?? []),
  'bindings/**',
  'examples/**',
  'grammar.js',
  'src/**',
];

// wbfy:start oxfmt-export
module.exports = oxfmtResolvedConfig;
// wbfy:end oxfmt-export
