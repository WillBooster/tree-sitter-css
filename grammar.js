/**
 * @file CSS grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const cssEscape = /\\(?:[0-9a-fA-F]{1,6}(?:[ \t\n\f]|\r\n?)?|[^0-9a-fA-F\n\r\f])/;
const genericNameCharacter = choice(/[-\w\u0080-\u{10FFFF}]/u, cssEscape);
const genericName = repeat1(genericNameCharacter);

const unquotedUrl = seq(
  /(?:[uU]|\\(?:[uU]|0{0,4}[57]5(?:[ \t\n\f]|\r\n?)?))/,
  /(?:[rR]|\\(?:[rR]|0{0,4}[57]2(?:[ \t\n\f]|\r\n?)?))/,
  /(?:[lL]|\\(?:[lL]|0{0,4}[46][cC](?:[ \t\n\f]|\r\n?)?))/,
  '(',
  /[ \t\n\r\f]*/,
  repeat(choice(
    /[^\x00-\x20\x7F"'()\\]/,
    cssEscape,
  )),
  /[ \t\n\r\f]*/,
  ')',
);

module.exports = grammar({
  name: 'css',

  extras: $ => [
    /\s/,
    $.comment,
    $.js_comment,
  ],

  externals: $ => [
    $._descendant_operator,
    $.__error_recovery,
    $._class_name_escape_with_suffix,
    $._at_rule_slash,
  ],

  inline: $ => [
    $._escaped_identifier,
    $._top_level_item,
    $._block_item,
  ],

  conflicts: $ => [
    [$.at_rule_value, $._style_range_operand],
    [$._style_range_operand, $._query_identifier],
    [$._at_rule_component, $._style_range_operand],
    [$._style_in_parens, $._style_range_operand],
    [$._at_rule_nested_component, $._style_range_operand],
    [$.container_statement, $._at_rule_component],
    [$.container_statement, $._style_range_value],
    [$._container_feature_query, $._style_range_value],
    [$.style_feature, $._style_range_value],
    [$._container_in_parens, $._at_rule_component],
    [$._style_unary_query, $._at_rule_component, $._style_range_operand],
    [$._container_unary_query, $._at_rule_component],
    [$._style_parenthesized_query, $.at_rule_parenthesized],
    [$._selector, $.declaration],
    [$._selector, $.declaration, $.last_declaration],
  ],

  rules: {
    stylesheet: $ => seq(
      repeat(choice(';', $._top_level_item)),
      optional(alias($.last_declaration, $.declaration)),
    ),

    _top_level_item: $ => choice(
      $.declaration,
      $.rule_set,
      $.import_statement,
      $.media_statement,
      $.charset_statement,
      $.namespace_statement,
      $.keyframes_statement,
      $.supports_statement,
      $.container_statement,
      $.at_rule,
    ),

    import_statement: $ => seq(
      '@import',
      $._value,
      sep(',', $._query),
      ';',
    ),

    media_statement: $ => seq(
      '@media',
      sep1(',', $._query),
      $.block,
    ),

    charset_statement: $ => seq(
      '@charset',
      $._value,
      ';',
    ),

    namespace_statement: $ => seq(
      '@namespace',
      optional(alias($.identifier, $.namespace_name)),
      choice($.string_value, $.call_expression, $.url_value),
      ';',
    ),

    keyframes_statement: $ => seq(
      choice(
        '@keyframes',
        alias(/@[-a-z]+keyframes/, $.at_keyword),
      ),
      alias($.identifier, $.keyframes_name),
      $.keyframe_block_list,
    ),

    keyframe_block_list: $ => seq(
      '{',
      repeat($.keyframe_block),
      '}',
    ),

    keyframe_block: $ => seq(
      sep1(',', choice($.from, $.to, $.integer_value, $.float_value)),
      $.block,
    ),

    from: _ => 'from',
    to: _ => 'to',

    supports_statement: $ => seq(
      '@supports',
      $._query,
      $.block,
    ),

    _container_keyword: _ => cssKeyword('@container'),

    _style_keyword: _ => cssKeyword('style'),

    _query_and: _ => cssKeyword('and'),

    _query_or: _ => cssKeyword('or'),

    _query_not: _ => cssKeyword('not'),

    container_statement: $ => prec.dynamic(1, seq(
      alias($._container_keyword, '@container'),
      sep1(',', choice(
        seq(alias(choice($._query_identifier, $._style_keyword), $.container_name), optional($._container_query)),
        $._container_query,
      )),
      $.block,
    )),

    at_rule: $ => seq(
      choice($.at_keyword, alias($._container_keyword, $.at_keyword)),
      repeat($._at_rule_component),
      choice(';', $.block),
    ),

    _at_rule_component: $ => choice(
      $.at_rule_value,
      alias(choice($._style_keyword, $._query_not, $._query_and, $._query_or), $.at_rule_value),
      alias($._at_rule_slash, $.at_rule_value),
      $.at_rule_url,
      $.string_value,
      $.at_rule_delimiter,
      $.at_rule_parenthesized,
      $.at_rule_bracketed,
    ),

    _at_rule_nested_component: $ => choice(
      $._at_rule_component,
      $.at_rule_braced,
      alias(';', $.at_rule_delimiter),
    ),

    at_rule_delimiter: _ => choice(',', ':'),

    at_rule_parenthesized: $ => seq('(', repeat($._at_rule_nested_component), ')'),

    at_rule_bracketed: $ => seq('[', repeat($._at_rule_nested_component), ']'),

    at_rule_braced: $ => seq('{', repeat($._at_rule_nested_component), '}'),

    _custom_property_component: _ => token(seq(
      /(?:-|\\(?:-|0{0,4}2[dD](?:[ \t\n\f]|\r\n?)?))/,
      choice(
        seq(/(?:-|\\-|\\0{4}2[dD](?:[ \t\n\f]|\r\n?)?|\\0{0,3}2[dD](?:[ \t\n\f]|\r\n?))/, genericName),
        seq(/\\0{0,3}2[dD]/, choice(/[-g-zG-Z_\u0080-\u{10FFFF}]/u, cssEscape), repeat(genericNameCharacter)),
      ),
    )),

    at_rule_value: $ => choice(
      $._style_range_value,
      token(seq(/[<>=]/, repeat('//'))),
    ),

    at_rule_url: _ => token(choice(
      /\/\/[^\s(){}\[\];,"'\\]+/,
      unquotedUrl,
    )),

    rule_set: $ => seq(
      $.selectors,
      $.block,
    ),

    selectors: $ => sep1(',', $._selector),

    block: $ => seq(
      '{',
      repeat(choice(';', $._block_item)),
      optional(alias($.last_declaration, $.declaration)),
      '}',
    ),

    _block_item: $ => choice(
      $.declaration,
      $.rule_set,
      $.import_statement,
      $.media_statement,
      $.charset_statement,
      $.namespace_statement,
      $.keyframes_statement,
      $.supports_statement,
      $.container_statement,
      $.at_rule,
    ),

    _selector: $ => choice(
      $.universal_selector,
      alias($.identifier, $.tag_name),
      $.class_selector,
      $.nesting_selector,
      $.pseudo_class_selector,
      $.pseudo_element_selector,
      $.id_selector,
      $.attribute_selector,
      $.string_value,
      $.child_selector,
      $.descendant_selector,
      $.sibling_selector,
      $.adjacent_sibling_selector,
      $.namespace_selector,
    ),

    nesting_selector: _ => '&',

    universal_selector: _ => '*',

    class_selector: $ => prec(1, seq(
      optional($._selector),
      '.',
      $.class_name,
    )),

    pseudo_class_selector: $ => seq(
      optional($._selector),
      ':',
      choice(
        seq(
          alias(
            choice('has', 'not', 'is', 'where', 'host', 'host-context'),
            $.class_name,
          ),
          alias($.pseudo_class_with_selector_arguments, $.arguments),
        ),

        $._nth_child_pseudo_class_selector,

        seq(
          $.class_name,
          optional(alias($.pseudo_class_arguments, $.arguments)),
        ),

        alias('host', $.class_name),
      ),
    ),

    _nth_child_pseudo_class_selector: $ => seq(
      alias(
        choice('nth-child', 'nth-last-child'),
        $.class_name,
      ),
      alias($.pseudo_class_nth_child_arguments, $.arguments),
    ),

    pseudo_element_selector: $ => seq(
      optional($._selector),
      '::',
      alias($.identifier, $.tag_name),
      optional(alias($.pseudo_element_arguments, $.arguments)),
    ),

    id_selector: $ => seq(
      optional($._selector),
      '#',
      alias($.identifier, $.id_name),
    ),

    attribute_selector: $ => seq(
      optional($._selector),
      token(prec(1, '[')),
      alias(choice($.identifier, $._escaped_identifier, $.namespace_selector, $._escaped_attribute_namespace), $.attribute_name),
      optional(seq(
        choice('=', '~=', '^=', '|=', '*=', '$='),
        $._value,
        optional($.attribute_flag),
      )),
      ']',
    ),

    _escaped_attribute_namespace: $ => choice(
      seq(
        alias($._escaped_identifier, $.tag_name),
        '|',
        choice($._selector, alias($._escaped_identifier, $.tag_name)),
      ),
      seq(
        optional($._selector),
        '|',
        alias($._escaped_identifier, $.tag_name),
      ),
    ),

    attribute_flag: _ => /[iIsS]/,

    child_selector: $ => prec.left(seq(optional($._selector), '>', $._selector)),

    descendant_selector: $ => prec.left(seq($._selector, $._descendant_operator, $._selector)),

    sibling_selector: $ => prec.left(seq(optional($._selector), '~', $._selector)),

    adjacent_sibling_selector: $ => prec.left(seq(optional($._selector), '+', $._selector)),

    namespace_selector: $ => prec.left(seq(optional($._selector), '|', $._selector)),

    pseudo_class_arguments: $ => seq(
      token.immediate('('),
      sep(',', choice($._selector, repeat1($._value))),
      ')',
    ),

    pseudo_class_with_selector_arguments: $ => seq(
      token.immediate('('),
      sep(',', $._selector),
      ')',
    ),

    pseudo_class_nth_child_arguments: $ => prec(-1, seq(
      token.immediate('('),
      choice(
        alias('even', $.plain_value),
        alias('odd', $.plain_value),
        $.integer_value,
        alias($._nth_functional_notation, $.plain_value),
      ),
      optional(
        seq(
          'of',
          $._selector,
        ),
      ),
      ')',
    )),

    _nth_functional_notation: _ => /-?(\d)*n\s*(\+\s*\d+)?/,

    pseudo_element_arguments: $ => seq(
      token.immediate('('),
      sep(',', choice($._selector, repeat1($._value))),
      ')',
    ),

    declaration: $ => prec.dynamic(1, seq(
      alias(choice($.identifier, $._custom_property_name), $.property_name),
      optional($._descendant_operator),
      ':',
      $._value,
      repeat(seq(
        optional(','),
        $._value,
      )),
      optional($.important),
      ';',
    )),

    last_declaration: $ => prec.dynamic(1, seq(
      alias(choice($.identifier, $._custom_property_name), $.property_name),
      optional($._descendant_operator),
      ':',
      $._value,
      repeat(seq(
        optional(','),
        $._value,
      )),
      optional($.important),
    )),

    _custom_property_name: _ => escapedIdentifier(seq('--', /[-a-zA-Z0-9_\xA0-\xFF]*/)),

    _escaped_identifier: $ => choice(
      $._custom_property_name,
      escapedIdentifier(optional(choice(
        '-',
        /-?[a-zA-Z_\xA0-\xFF][a-zA-Z0-9-_\xA0-\xFF]*/,
      ))),
    ),

    important: _ => /![ \t\n\r\f]*[iI][mM][pP][oO][rR][tT][aA][nN][tT]/,

    _query: $ => choice(
      alias($.identifier, $.keyword_query),
      $.feature_query,
      $.binary_query,
      $.unary_query,
      $.selector_query,
      $.parenthesized_query,
    ),

    feature_query: $ => seq(
      '(',
      alias($.identifier, $.feature_name),
      ':',
      repeat1($._value),
      ')',
    ),

    parenthesized_query: $ => seq(
      '(',
      $._query,
      ')',
    ),

    binary_query: $ => prec.left(seq(
      $._query,
      choice('and', 'or'),
      $._query,
    )),

    unary_query: $ => prec(1, seq(
      choice('not', 'only'),
      $._query,
    )),

    selector_query: $ => seq(
      'selector',
      '(',
      $._selector,
      ')',
    ),

    _container_query: $ => choice(
      $._container_in_parens,
      alias($._container_and_query, $.binary_query),
      alias($._container_or_query, $.binary_query),
      alias($._container_unary_query, $.unary_query),
    ),

    _container_in_parens: $ => choice(
      alias($._container_feature_query, $.feature_query),
      $.style_query,
      $.at_rule_parenthesized,
      $.general_enclosed_query,
      alias($._container_parenthesized_query, $.parenthesized_query),
    ),

    _container_feature_query: $ => prec.dynamic(1, seq(
      '(', alias($._query_identifier, $.feature_name), ':',
      repeat($._at_rule_nested_component), ')',
    )),

    general_enclosed_query: $ => prec.dynamic(2, seq(
      choice($.at_rule_value, alias(choice($._style_keyword, $._query_not, $._query_and, $._query_or), $.at_rule_value)),
      alias($._container_function_arguments, $.at_rule_parenthesized),
    )),

    _container_function_arguments: $ => seq(
      token.immediate('('), repeat($._at_rule_nested_component), ')',
    ),

    _container_and_query: $ => prec.left(seq(
      choice($._container_in_parens, alias($._container_and_query, $.binary_query)),
      alias($._query_and, 'and'),
      $._container_in_parens,
    )),

    _container_or_query: $ => prec.left(seq(
      choice($._container_in_parens, alias($._container_or_query, $.binary_query)),
      alias($._query_or, 'or'),
      $._container_in_parens,
    )),

    _container_unary_query: $ => seq(alias($._query_not, 'not'), $._container_in_parens),

    _container_parenthesized_query: $ => seq('(', $._container_query, ')'),

    style_query: $ => prec(1, seq(
      alias($._style_keyword, 'style'), token.immediate('('),
      choice($._style_condition, repeat($._at_rule_nested_component)),
      ')',
    )),

    _style_condition: $ => choice(
      $.style_feature,
      $._style_in_parens,
      alias($._style_and_query, $.binary_query),
      alias($._style_or_query, $.binary_query),
      alias($._style_unary_query, $.unary_query),
    ),

    style_feature: $ => prec.dynamic(1, choice(
      seq(
        alias($._query_identifier, $.feature_name),
        optional(seq(':', repeat($._at_rule_nested_component))),
      ),
      seq($._style_range_operand, choice('<', '<=', '>', '>=', '='), $._style_range_operand),
      seq($._style_range_operand, choice('<', '<='), $._style_range_operand, choice('<', '<='), $._style_range_operand),
      seq($._style_range_operand, choice('>', '>='), $._style_range_operand, choice('>', '>='), $._style_range_operand),
    )),

    _style_range_operand: $ => choice(
      prec.dynamic(1, alias($._custom_property_component, $.feature_name)),
      repeat1(choice(
        alias($._style_range_value, $.at_rule_value),
        alias(choice($._style_keyword, $._query_not, $._query_and, $._query_or), $.at_rule_value),
        $.at_rule_url,
        $.string_value,
        $.general_enclosed_query,
        $.at_rule_parenthesized,
        $.at_rule_bracketed,
        $.at_rule_braced,
        $.at_rule_delimiter,
        alias($._at_rule_slash, $.at_rule_value),
      )),
    ),

    _query_identifier: $ => choice($._custom_property_component, token(seq(
      choice(seq(optional('-'), choice(/[_a-zA-Z\u0080-\u{10FFFF}]/u, cssEscape)), '--'),
      repeat(genericNameCharacter),
    ))),

    _style_range_value: $ => choice($._query_identifier, token(seq(choice(
      seq(optional(/[#@]/), genericName),
      seq(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/, optional(choice(genericName, '%'))),
      /[^\s(){}\[\];,:"'\\/<>=]/,
    ), repeat('//')))),

    _style_parenthesized_query: $ => seq('(', choice($._style_condition, repeat($._at_rule_nested_component)), ')'),

    _style_in_parens: $ => choice(
      alias($._style_parenthesized_query, $.parenthesized_query),
      $.general_enclosed_query,
    ),

    _style_and_query: $ => prec.left(seq(
      choice($._style_in_parens, alias($._style_and_query, $.binary_query)),
      alias($._query_and, 'and'),
      $._style_in_parens,
    )),

    _style_or_query: $ => prec.left(seq(
      choice($._style_in_parens, alias($._style_or_query, $.binary_query)),
      alias($._query_or, 'or'),
      $._style_in_parens,
    )),

    _style_unary_query: $ => seq(alias($._query_not, 'not'), $._style_in_parens),

    _value: $ => prec(-1, choice(
      alias($.identifier, $.plain_value),
      $.plain_value,
      $.color_value,
      $.integer_value,
      $.float_value,
      $.string_value,
      $.grid_value,
      $.binary_expression,
      $.parenthesized_value,
      $.call_expression,
      $.url_value,
      $.important,
    )),

    parenthesized_value: $ => seq(
      '(',
      $._value,
      ')',
    ),

    color_value: _ => seq('#', token.immediate(/[0-9a-fA-F]{3,8}/)),

    string_value: $ => choice(
      seq(
        '\'',
        repeat(choice(
          alias(/[^\\'\n]+/, $.string_content),
          $.escape_sequence,
        )),
        '\'',
      ),
      seq(
        '"',
        repeat(choice(
          alias(/[^\\"\n]+/, $.string_content),
          $.escape_sequence,
        )),
        '"',
      ),
    ),

    escape_sequence: _ => token(seq(
      '\\',
      choice(
        /[0-9a-fA-F]{1,6}\s?/,
        /[^0-9a-fA-F\n\r]/,
      ),
    )),

    integer_value: $ => seq(
      token(seq(
        optional(choice('+', '-')),
        /\d+/,
      )),
      optional($.unit),
    ),

    float_value: $ => seq(
      token(seq(
        optional(choice('+', '-')),
        /\d*/,
        choice(
          seq('.', /\d+/),
          seq(/[eE]/, optional('-'), /\d+/),
          seq('.', /\d+/, /[eE]/, optional('-'), /\d+/),
        ),
      )),
      optional($.unit),
    ),

    unit: _ => token.immediate(/[a-zA-Z%]+/),

    grid_value: $ => seq(
      '[',
      sep1(',', $._value),
      ']',
    ),

    url_value: _ => token(unquotedUrl),

    call_expression: $ => seq(
      alias($.identifier, $.function_name),
      $.arguments,
    ),

    binary_expression: $ => prec.left(seq(
      $._value,
      choice('+', '-', '*', '/'),
      $._value,
    )),

    arguments: $ => seq(
      token.immediate('('),
      sep(choice(',', ';'), repeat1($._value)),
      ')',
    ),

    class_name: $ => repeat1(choice(
      $.identifier,
      $.escape_sequence,
      alias($._class_name_escape_with_suffix, $.identifier),
    )),

    identifier: _ => /(--|-?[a-zA-Z_\xA0-\xFF])[a-zA-Z0-9-_\xA0-\xFF]*/,

    at_keyword: _ => /@[a-zA-Z-_]+/,

    js_comment: _ => token(prec(-1, seq('//', /.*/))),

    comment: _ => token(seq(
      '/*',
      /[^*]*\*+([^/*][^*]*\*+)*/,
      '/',
    )),

    plain_value: _ => token(choice(
      /<[a-zA-Z-]+>[+#]?/,
      seq(
        repeat(choice(
          /[-_]/,
          /\/[^\*\s,;!{}()\[\]]/,
        )),
        /[a-zA-Z]/,
        repeat(choice(
          /[^/\s,;!{}()\[\]]/,
          /\/[^\*\s,;!{}()\[\]]/,
        )),
      ),
    )),
  },
});

function cssKeyword(word) {
  return token(new RegExp(cssKeywordPattern(word)));
}

function cssKeywordPattern(word, escapedOnly = false) {
  if (!word) return '';
  const character = word[0];
  const rest = word.slice(1);
  const suffix = cssKeywordPattern(rest);
  if (character === '@') return `@${suffix}`;
  const letters = `[${character}${character.toUpperCase()}]`;
  const codes = [character, character.toUpperCase()].map(value =>
    value.charCodeAt(0).toString(16).replace(/[a-f]/g, digit => `[${digit}${digit.toUpperCase()}]`),
  );
  const code = `(?:${codes.join('|')})`;
  const whitespace = String.raw`(?:[ \t\n\f]|\r\n?)`;
  const alternatives = escapedOnly ? [] : [`${letters}${suffix}`];
  if (!/[a-f]/.test(character)) alternatives.push(String.raw`\\${letters}${suffix}`);
  if (rest && /[a-f]/.test(rest[0])) {
    alternatives.push(
      String.raw`\\0{4}${code}${whitespace}?${suffix}`,
      String.raw`\\0{0,3}${code}${whitespace}${suffix}`,
      String.raw`\\0{0,3}${code}${cssKeywordPattern(rest, true)}`,
    );
  } else {
    alternatives.push(String.raw`\\0{0,4}${code}${whitespace}?${suffix}`);
  }
  return `(?:${alternatives.join('|')})`;
}

/** @param {RuleOrLiteral} prefix */
function escapedIdentifier(prefix) {
  return token(seq(
    prefix,
    repeat1(seq(
      '\\',
      choice(
        /[0-9a-fA-F]{1,6}(?:[ \t\n\f]|\r\n?)?/,
        /[^0-9a-fA-F\n\r\f]/,
      ),
      /[-a-zA-Z0-9_\xA0-\xFF]*/,
    )),
  ));
}

/**
 * @param {RuleOrLiteral} separator
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {ChoiceRule}
 */
function sep(separator, rule) {
  return optional(sep1(separator, rule));
}

/**
 * @param {RuleOrLiteral} separator
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function sep1(separator, rule) {
  return seq(rule, repeat(seq(separator, rule)));
}
