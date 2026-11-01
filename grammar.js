/**
 * @file CSS grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const queryOpeningParenthesis = choice('(', token.immediate('('));
const selectorFunctionName = choice('has', 'not', 'is', 'where', 'host', 'host-context');
const valueSlash = token(prec(-2, '/'));
const openingBracket = token(prec(1, '['));
const attributeMatchOperator = choice('=', '~=', '^=', '|=', '*=', '$=');
const cssEscape = /\\(?:[0-9a-fA-F]{1,6}(?:[ \t\n\f]|\r\n?)?|[^0-9a-fA-F\n\r\f])/;
const genericNameCharacter = choice(/[-\w\u0080-\u{10FFFF}]/u, cssEscape);
const genericName = repeat1(genericNameCharacter);

const nonAsciiNameStart = /[\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C\u200D\u203F\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{10FFFF}]/u;
const nameStart = choice(/[a-zA-Z_]/, nonAsciiNameStart);
// The non-ASCII code points that `nonAsciiNameStart` excludes, which CSS tokenizes as delimiters. The noncharacters
// U+FFFE and U+FFFF form a token of their own because, in one set with the others, the generator emits an empty C
// condition (WillBooster/tree-sitter#234).
const nonAsciiDelimiter = /[\u0080-\u00B6\u00B8-\u00BF\u00D7\u00F7\u037E\u2000-\u200B\u200E-\u203E\u2041-\u206F\u2190-\u2BFF\u2FF0-\u3000\uE000-\uF8FF\uFDD0-\uFDEF]/u;
const nonAsciiNoncharacterDelimiter = /[\uFFFE\uFFFF]/u;
const nameContinue = choice(nameStart, /[0-9-]/);
const idName = seq(
  choice('--', seq(optional('-'), choice(nameStart, cssEscape))),
  repeat(choice(nameContinue, cssEscape)),
);

// A lone `@` token would be the only conflict-free `@` token, which drops at-keywords from the error-recovery lexer
// so that an at-rule after an error is swallowed; spanning the at-keyword name and losing to it keeps them there.
const valueAt = token(prec(-1, seq('@', optional(idName))));

const escapedName = escapedIdentifier(optional(choice(
  '-',
  seq('--', repeat(nameContinue)),
  seq(optional('-'), nameStart, repeat(nameContinue)),
)));

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
    $._html_comment_marker,
  ],

  externals: $ => [
    $._descendant_operator,
    $.__error_recovery,
    $._at_rule_slash,
    $._incomplete_declaration_end,
    $._value_dot,
    $._invalid_value_dot,
    $._value_ampersand,
    $._value_asterisk,
    $._layer_name_identifier,
    $._layer_name_prefix,
    $._import_supports_start,
    $._import_layer_start,
    $._invalid_import_supports,
    $._invalid_import_layer,
    $._hash_slash_tail,
    $._operator_gap,
    $._combinator_gap,
    $._binary_asterisk,
    $._declaration_continuation,
    $._declaration_operator_gap,
    $._value_call_start,
    $._value_unit_start,
    $._recovery_identifier,
    $._declaration_boundary,
    $._declaration_operand_gap,
    $._hash_tail_gap,
    $._value_number_end,
    $._declaration_terminator_gap,
    $._declaration_comma_gap,
    $._declaration_value_start,
    $._missing_declaration_value,
    $._keyframes_name,
  ],

  inline: $ => [
    $._range_comparison,
    $._escaped_identifier,
    $._top_level_item,
    $._block_item,
    $._binary_combinator_gap,
  ],

  conflicts: $ => [
    [$.namespace_selector, $._pseudo_operand],
    [$.adjacent_sibling_selector, $._pseudo_operand],
    [$.sibling_selector, $._pseudo_operand],
    [$.child_selector, $._pseudo_operand],
    [$.universal_selector, $._pseudo_operand],
    [$.nesting_selector, $._pseudo_operand],
    [$.pseudo_class_arguments, $._pseudo_operand],
    [$._selector, $.pseudo_class_arguments, $._pseudo_operand],
    [$._selector, $.pseudo_class_arguments],
    [$._selector, $._pseudo_operand],
    [$._nth_functional_notation],
    [$.child_selector],
    [$.sibling_selector],
    [$.adjacent_sibling_selector],
    [$.attribute_selector, $._value],
    [$.selectors, $.child_selector, $.descendant_selector, $.sibling_selector, $.adjacent_sibling_selector],
    [$.child_selector, $.descendant_selector, $.sibling_selector, $.adjacent_sibling_selector, $.pseudo_class_with_selector_arguments],
    [$._escaped_attribute_namespace, $.child_selector, $.descendant_selector, $.sibling_selector, $.adjacent_sibling_selector],
    [$.at_rule_bracketed, $._selector, $.attribute_selector],
    [$._selector, $.attribute_selector, $._query_identifier],
    [$._at_rule_component, $._selector, $.attribute_selector],
    [$._selector, $.attribute_selector],
    [$.selectors],
    [$.pseudo_class_selector],
    [$.pseudo_element_selector],
    [$.selectors, $.pseudo_class_selector],
    [$.selectors, $.child_selector],
    [$.selectors, $.sibling_selector],
    [$.selectors, $.adjacent_sibling_selector],
    [$.selectors, $.namespace_selector],
    [$.selectors, $.attribute_selector],
    [$.at_rule_delimiter, $.pseudo_class_selector],
    [$._at_rule_component, $._selector],
    [$._selector, $._query_identifier],
    [$.attribute_selector, $._query_identifier],
    [$._at_rule_component, $.attribute_selector],
    [$.at_rule_bracketed, $._selector],
    [$.at_rule_bracketed, $.attribute_selector],
    [$._at_rule_component, $._escaped_attribute_namespace],
    [$.at_rule_bracketed, $._escaped_attribute_namespace],
    [$._at_rule_component, $.child_selector],
    [$._at_rule_component, $.sibling_selector],
    [$._at_rule_component, $.adjacent_sibling_selector],
    [$._at_rule_component, $.namespace_selector],
    [$.scope_statement, $.at_rule],
    [$.scope_statement, $._scope_selector_group],
    [$._scope_generic_parenthesized, $.at_rule_parenthesized],
    [$._scope_fallback_component, $._selector],
    [$._scope_fallback_component, $.at_rule_parenthesized],
    [$._container_function_arguments, $._style_parenthesized_query],
    [$.at_rule_parenthesized, $._container_function_arguments, $._style_parenthesized_query],
    [$._container_feature_query, $.style_feature],
    [$._at_rule_component, $.general_enclosed_query, $._style_range_operand, $._style_unary_query],
    [$._container_feature_query, $.style_feature, $._style_range_value],
    [$._container_in_parens, $._style_in_parens],
    [$._container_in_parens, $._style_range_operand, $._style_in_parens],
    [$._at_rule_component, $._container_in_parens, $._style_range_operand],
    [$._at_rule_component, $.general_enclosed_query, $._container_unary_query, $._style_range_operand, $._style_unary_query],
    [$._at_rule_component, $._container_unary_query, $._style_range_operand, $._style_unary_query],
    [$._at_rule_component, $.general_enclosed_query, $.style_query, $._style_range_operand],
    [$._container_function_arguments, $.style_query],
    [$.at_rule_parenthesized, $._container_function_arguments, $.style_query],
    [$._at_rule_component, $.general_enclosed_query, $.style_query],
    [$.container_statement, $._at_rule_component, $.general_enclosed_query, $.style_query],
    [$.at_rule_parenthesized, $._container_function_arguments],
    [$.general_enclosed_query, $._style_range_operand],
    [$.general_enclosed_query, $._at_rule_component],
    [$.general_enclosed_query, $._at_rule_component, $._style_range_operand],
    [$.at_rule_value, $._style_range_operand],
    [$._style_range_operand, $._query_identifier],
    [$._at_rule_component, $._style_range_operand],
    [$._style_in_parens, $._style_range_operand],
    [$._at_rule_nested_component, $._style_range_operand],
    [$.container_statement, $._at_rule_component],
    [$.layer_statement, $.at_rule],
    [$.layer_name, $.at_rule],
    [$.container_statement, $._style_range_value],
    [$._container_feature_query, $._style_range_value],
    [$.style_feature, $._style_range_value],
    [$._container_in_parens, $._at_rule_component],
    [$._style_unary_query, $._at_rule_component, $._style_range_operand],
    [$._container_unary_query, $.general_enclosed_query, $._at_rule_component],
    [$._container_unary_query, $._at_rule_component],
    [$._style_parenthesized_query, $.at_rule_parenthesized],
    [$.range_query, $._range_start_value],
    [$._selector, $._missing_declaration, $.declaration],
    [$._selector, $._missing_declaration, $.declaration, $.last_declaration],
  ],

  rules: {
    stylesheet: $ => seq(
      repeat(choice(';', $._top_level_item)),
      optional(alias($.last_declaration, $.declaration)),
    ),

    _html_comment_marker: _ => token(choice('<!--', '-->')),

    _top_level_item: $ => choice(
      $.declaration,
      alias($._missing_declaration, $.declaration),
      $.rule_set,
      $.import_statement,
      $.media_statement,
      $.charset_statement,
      $.namespace_statement,
      $.keyframes_statement,
      $.supports_statement,
      $.container_statement,
      $.scope_statement,
      $.layer_statement,
      $.at_rule,
    ),

    import_statement: $ => seq(
      '@import',
      choice($.string_value, $.url_value, alias($._import_url, $.call_expression), alias($._import_src, $.call_expression)),
      optional($.import_layer),
      choice(
        seq(optional($.import_supports), sep(',', $._media_query)),
        choice($._invalid_import_layer, $._invalid_import_supports),
      ),
      ';',
    ),

    import_layer: $ => choice(
      alias($._import_layer_keyword, 'layer'),
      seq(alias($._import_layer_start, 'layer('), $.layer_name, ')'),
    ),

    _import_layer_keyword: _ => cssKeyword('layer'),

    layer_name: $ => seq(
      repeat(seq(alias($._layer_name_prefix, $.identifier), '.')),
      alias($._layer_name_identifier, $.identifier),
    ),

    // Mirrors the generic at-rule components with own nodes, so that queries can tell support conditions from generic
    // at-rule preludes. A body that starts with a name and `:` is a declaration; groups in condition position may hold
    // declarations, while groups in a declaration value or after a value hold plain components.
    import_supports: $ => seq(
      alias($._import_supports_start, 'supports('),
      choice($.import_supports_declaration, repeat1($._import_supports_condition_component)),
      ')',
    ),

    import_supports_declaration: $ => prec(1, seq(
      field('name', choice(
        $.at_rule_value,
        alias(choice($._style_keyword, $._query_not, $._query_and, $._query_or), $.at_rule_value),
      )),
      alias(':', $.at_rule_delimiter),
      repeat($._import_supports_value_nested_component),
    )),

    _import_supports_condition_component: $ => choice(
      $._import_supports_leaf,
      $._import_supports_function,
      alias($._import_supports_condition_group, $.import_supports_group),
      alias($._import_supports_bracketed, $.at_rule_bracketed),
      alias($._import_supports_braced, $.at_rule_braced),
    ),

    _import_supports_condition_group: $ => seq(
      queryOpeningParenthesis,
      optional(choice(
        $.import_supports_declaration,
        repeat1(choice($._import_supports_condition_component, alias(';', $.at_rule_delimiter))),
      )),
      ')',
    ),

    // A group after a value, such as the arguments of `selector(a:hover)`, holds plain components, not a declaration.
    _import_supports_function: $ => prec(1, seq(
      choice(
        $.at_rule_value,
        alias(choice($._style_keyword, $._at_rule_slash), $.at_rule_value),
        $.at_rule_url,
        $.string_value,
      ),
      alias($._import_supports_value_group, $.import_supports_group),
    )),

    _import_supports_leaf: $ => choice(
      $.at_rule_value,
      alias($._style_keyword, $.at_rule_value),
      alias($._query_not, 'not'),
      alias($._query_and, 'and'),
      alias($._query_or, 'or'),
      alias($._at_rule_slash, $.at_rule_value),
      $.at_rule_url,
      $.string_value,
      $.at_rule_delimiter,
    ),

    _import_supports_value_nested_component: $ => choice(
      $._import_supports_leaf,
      alias($._import_supports_value_group, $.import_supports_group),
      alias($._import_supports_bracketed, $.at_rule_bracketed),
      alias($._import_supports_braced, $.at_rule_braced),
      alias(';', $.at_rule_delimiter),
    ),

    _import_supports_value_group: $ => seq(queryOpeningParenthesis, repeat($._import_supports_value_nested_component), ')'),

    _import_supports_bracketed: $ => seq('[', repeat($._import_supports_value_nested_component), ']'),

    _import_supports_braced: $ => seq('{', repeat($._import_supports_value_nested_component), '}'),

    _import_src: $ => seq(
      alias(cssKeyword('src'), $.function_name),
      alias($._import_src_arguments, $.arguments),
    ),

    _import_src_arguments: $ => seq(
      token.immediate('('),
      choice($.string_value, alias($._import_url_modifier, $.call_expression)),
      importUrlModifiers($),
      ')',
    ),

    _import_url: $ => seq(
      alias(cssKeyword('url'), $.function_name),
      alias($._import_url_arguments, $.arguments),
    ),

    _import_url_arguments: $ => seq(
      token.immediate('('),
      choice(
        seq(
          $.string_value,
          importUrlModifiers($),
        ),
        alias(token(repeat1(choice(/[^\x00-\x20\x7F"'()\\]/, cssEscape))), $.plain_value),
      ),
      ')',
    ),

    _import_url_modifier: $ => seq(
      alias(choice($.identifier, $._escaped_identifier), $.function_name),
      $.arguments,
    ),

    media_statement: $ => seq(
      '@media',
      sep1(',', $._media_query),
      $.block,
    ),

    charset_statement: $ => seq(
      '@charset',
      $._value,
      ';',
    ),

    namespace_statement: $ => seq(
      '@namespace',
      optional(alias(valueIdentifier($), $.namespace_name)),
      choice($.string_value, $.call_expression, $.url_value),
      ';',
    ),

    keyframes_statement: $ => seq(
      choice(
        alias(cssKeyword('@keyframes'), '@keyframes'),
        alias(choice(
          cssKeyword('@-webkit-keyframes'),
          /@[-a-zA-Z]+[kK][eE][yY][fF][rR][aA][mM][eE][sS]/,
        ), $.at_keyword),
      ),
      alias($._keyframes_name, $.keyframes_name),
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

    from: _ => cssKeyword('from'),
    to: _ => cssKeyword('to'),

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

    _layer_keyword: _ => cssKeyword('@layer'),

    layer_statement: $ => prec.dynamic(1, seq(
      alias($._layer_keyword, '@layer'),
      choice(seq(sep1(',', $.layer_name), ';'), seq(optional($.layer_name), $.block)),
    )),

    _scope_keyword: _ => cssKeyword('@scope'),

    _scope_to: _ => cssKeyword('to'),

    scope_statement: $ => prec.dynamic(1, seq(
      alias($._scope_keyword, '@scope'),
      optional(seq(queryOpeningParenthesis, optional($._descendant_combinator), field('start', $.selectors), optional($._descendant_combinator), ')')),
      optional(seq(alias($._scope_to, 'to'), queryOpeningParenthesis, optional($._descendant_combinator), field('end', $.selectors), optional($._descendant_combinator), ')')),
      choice(';', $.block),
    )),

    at_rule: $ => choice(
      seq(choice($.at_keyword, alias($._container_keyword, $.at_keyword)), repeat($._at_rule_component), choice(';', $.block)),
      // The layer-name tokens that layer_statement scans after `@layer` keep an invalid layer prelude a generic at-rule.
      seq(
        alias($._layer_keyword, $.at_keyword),
        repeat(choice($._at_rule_component, alias(choice($._layer_name_identifier, $._layer_name_prefix, '.'), $.at_rule_value))),
        choice(';', $.block),
      ),
      seq(
        alias($._scope_keyword, $.at_keyword),
        repeat(choice(
          $._at_rule_component,
          alias($.identifier, $.at_rule_value),
          alias($._scope_to, $.at_rule_value),
          alias($._scope_selector_group, $.at_rule_parenthesized),
          alias($._scope_generic_parenthesized, $.at_rule_parenthesized),
        )),
        choice(';', $.block),
      ),
    ),

    _scope_selector_group: $ => seq(
      queryOpeningParenthesis,
      optional($._descendant_combinator),
      $.selectors,
      repeat(seq(optional($._descendant_combinator), $._scope_fallback_component)),
      optional($._descendant_combinator),
      ')',
    ),

    _scope_generic_parenthesized: $ => seq(
      queryOpeningParenthesis,
      repeat(seq(optional($._descendant_combinator), $._scope_fallback_component)),
      optional($._descendant_combinator),
      ')',
    ),

    _scope_fallback_component: $ => choice(
      $._at_rule_nested_component,
      alias($.identifier, $.at_rule_value),
      alias(selectorFunctionName, $.at_rule_value),
      alias($._scope_generic_parenthesized, $.at_rule_parenthesized),
    ),

    _at_rule_component: $ => choice(
      $.at_rule_value,
      alias(choice('>', '~', '+', '|'), $.at_rule_value),
      alias(queryKeyword($), $.at_rule_value),
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

    at_rule_parenthesized: $ => seq(queryOpeningParenthesis, repeat($._at_rule_nested_component), ')'),

    at_rule_bracketed: $ => seq(
      openingBracket,
      repeat(seq(optional($._descendant_combinator), choice(
        $._at_rule_nested_component,
        alias(choice($.identifier, $._escaped_identifier), $.at_rule_value),
        alias(attributeMatchOperator, $.at_rule_value),
      ))),
      optional($._descendant_combinator),
      ']',
    ),

    at_rule_braced: $ => seq('{', repeat($._at_rule_nested_component), '}'),

    _custom_property_component: _ => token(seq(
      /(?:-|\\(?:-|0{0,4}2[dD](?:[ \t\n\f]|\r\n?)?))/,
      choice(
        seq(/(?:-|\\-|\\0{4}2[dD](?:[ \t\n\f]|\r\n?)?|\\0{0,3}2[dD](?:[ \t\n\f]|\r\n?))/, repeat1(choice(nameContinue, cssEscape))),
        seq(/\\0{0,3}2[dD]/, choice(/[-g-zG-Z_]/, nonAsciiNameStart, cssEscape), repeat(choice(nameContinue, cssEscape))),
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
      optional($._descendant_combinator),
      $.block,
    ),

    selectors: $ => sep1(seq(optional($._descendant_combinator), ','), $._selector),

    block: $ => seq(
      '{',
      repeat(choice(';', $._block_item)),
      optional(alias($.last_declaration, $.declaration)),
      '}',
    ),

    _block_item: $ => choice(
      $.declaration,
      alias($._missing_declaration, $.declaration),
      $.rule_set,
      $.import_statement,
      $.media_statement,
      $.charset_statement,
      $.namespace_statement,
      $.keyframes_statement,
      $.supports_statement,
      $.container_statement,
      $.scope_statement,
      $.layer_statement,
      $.at_rule,
    ),

    _selector: $ => choice(
      $.universal_selector,
      alias(selectorIdentifier($), $.tag_name),
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

    nesting_selector: $ => choice('&', alias($._value_ampersand, '&')),

    universal_selector: $ => choice('*', alias($._value_asterisk, '*'), alias($._binary_asterisk, '*')),

    class_selector: $ => prec(1, seq(
      optional($._selector),
      choice('.', alias($._value_dot, '.')),
      $.class_name,
    )),

    pseudo_class_selector: $ => seq(
      optional($._selector),
      ':',
      choice(
        seq(
          alias(
            selectorFunctionName,
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
      alias(selectorIdentifier($), $.tag_name),
      optional(alias($.pseudo_element_arguments, $.arguments)),
    ),

    id_selector: $ => seq(
      optional($._selector),
      alias(token(seq('#', idName)), $.id_name),
    ),

    attribute_selector: $ => seq(
      optional($._selector),
      openingBracket,
      optional($._descendant_combinator),
      alias(choice(selectorIdentifier($), $._escaped_identifier, $.namespace_selector, $._escaped_attribute_namespace), $.attribute_name),
      optional(seq(
        optional($._descendant_combinator),
        attributeMatchOperator,
        choice($._value, alias(selectorIdentifier($), $.plain_value)),
        optional(seq(optional($._descendant_combinator), $.attribute_flag)),
      )),
      optional($._descendant_combinator),
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

    child_selector: $ => choice(
      prec.left(seq($._selector, optional($._binary_combinator_gap), '>', $._selector)),
      prec.left(seq('>', optional($._descendant_combinator), $._selector, optional($._descendant_combinator))),
    ),

    _binary_combinator_gap: $ => choice($._descendant_combinator, $._combinator_gap),

    descendant_selector: $ => prec.left(seq($._selector, $._descendant_combinator, $._selector)),

    sibling_selector: $ => choice(
      prec.left(seq($._selector, optional($._binary_combinator_gap), '~', $._selector)),
      prec.left(seq('~', optional($._descendant_combinator), $._selector, optional($._descendant_combinator))),
    ),

    adjacent_sibling_selector: $ => choice(
      prec.left(seq($._selector, optional($._binary_combinator_gap), '+', $._selector)),
      prec.left(seq('+', optional($._descendant_combinator), $._selector, optional($._descendant_combinator))),
    ),

    namespace_selector: $ => prec.left(seq(optional($._selector), '|', $._selector)),

    pseudo_class_arguments: $ => seq(
      token.immediate('('),
      optional($._descendant_combinator),
      optional(sep1(',', pseudoArgument($))),
      ')',
    ),

    pseudo_class_with_selector_arguments: $ => prec.dynamic(2, seq(
      token.immediate('('),
      optional($._descendant_combinator),
      optional(seq(
        sep1(seq(optional($._descendant_combinator), ','), $._selector),
        optional($._descendant_combinator),
      )),
      ')',
    )),

    pseudo_class_nth_child_arguments: $ => prec(-1, seq(
      token.immediate('('),
      optional($._descendant_combinator),
      choice(
        alias(cssKeyword('even'), $.plain_value),
        alias(cssKeyword('odd'), $.plain_value),
        $.integer_value,
        alias($._nth_functional_notation, $.plain_value),
      ),
      optional(
        seq(
          optional($._descendant_combinator),
          alias(cssKeyword('of'), 'of'),
          optional($._descendant_combinator),
          sep1(seq(optional($._descendant_combinator), ','), $._selector),
        ),
      ),
      optional($._descendant_combinator),
      ')',
    )),

    // The standalone `#`, `:` and delimiter values of `_value` stay operands: as in declarations, they keep these
    // single-character tokens from becoming conflict-free in the generator's error-recovery analysis, which would drop
    // `#id`, `::` and custom-property names from the tokens error recovery can resume at.
    _pseudo_operand: $ => choice(
      pseudoValue($),
      pseudoEscapedValue($),
      '#',
      prec.dynamic(-1, alias(choice($._value_dot, $._value_ampersand, $._value_asterisk, '=', '?', valueAt, '|', '^', '$', '~', '<', '>', '+', valueSlash, '`', token(prec(-1, nonAsciiDelimiter)), token(prec(-1, nonAsciiNoncharacterDelimiter))), $.plain_value)),
      alias(token(prec(-1, ':')), $.plain_value),
    ),

    _pseudo_binary_expression: $ => prec.left(3, seq(
      choice($._pseudo_operand, alias($._pseudo_binary_expression, $.binary_expression)),
      optional(choice($._operator_gap, $._combinator_gap)),
      choice('+', '-', '*', alias($._value_asterisk, '*'), alias($._binary_asterisk, '*'), valueSlash),
      optional($._descendant_combinator),
      $._pseudo_operand,
    )),


    _nth_functional_notation: $ => choice(
      /[+-]?\d*[nN][\t\n\f\r ]*[+-][\t\n\f\r ]*\d+/,
      seq(/[+-]?\d*[nN]/, optional(seq(
        optional($._descendant_combinator),
        choice(/[+-]\d+/, seq(choice('+', '-'), optional($._descendant_combinator), /\d+/)),
      ))),
    ),

    pseudo_element_arguments: $ => seq(
      token.immediate('('),
      optional($._descendant_combinator),
      optional(sep1(',', pseudoArgument($))),
      ')',
    ),

    _descendant_combinator: $ => choice($._descendant_operator, $._incomplete_declaration_end, $._operator_gap),

    _missing_declaration: $ => seq(
      alias(propertyIdentifier($), $.property_name),
      optional($._descendant_combinator),
      ':',
      $._declaration_value_start,
      choice($._declaration_continuation, $._declaration_boundary),
      alias($._missing_declaration_value, $.plain_value),
    ),

    declaration: $ => prec.dynamic(1, seq(declarationValue($), optional($._declaration_terminator_gap), ';')),

    last_declaration: $ => prec.dynamic(1, declarationValue($, true)),

    _star_property_name: _ => token(seq('*', choice('--', seq(optional('-'), nameStart)), repeat(nameContinue))),

    _custom_property_name: _ => escapedIdentifier(seq('--', repeat(nameContinue))),

    _escaped_identifier: $ => choice(
      $._custom_property_name,
      escapedIdentifier(optional(choice(
        '-',
        seq(optional('-'), nameStart, repeat(nameContinue)),
      ))),
    ),

    important: _ => /![ \t\n\r\f]*[iI][mM][pP][oO][rR][tT][aA][nN][tT]/,

    _query: $ => choice(
      alias(featureIdentifier($), $.keyword_query),
      $.feature_query,
      $.binary_query,
      $.unary_query,
      $.selector_query,
      $.parenthesized_query,
    ),

    feature_query: $ => seq(
      '(',
      alias(featureIdentifier($), $.feature_name),
      ':',
      repeat1($._value),
      ')',
    ),

    _media_query: $ => choice(
      alias(featureIdentifier($), $.keyword_query),
      $.feature_query,
      $.range_query,
      alias($._media_binary_query, $.binary_query),
      alias($._media_unary_query, $.unary_query),
      $.selector_query,
      alias($._media_parenthesized_query, $.parenthesized_query),
    ),

    _media_binary_query: $ => prec.left(seq($._media_query, choice('and', 'or'), $._media_query)),

    _media_unary_query: $ => prec(1, seq(choice('not', 'only'), $._media_query)),

    _media_parenthesized_query: $ => seq('(', $._media_query, ')'),

    range_query: $ => seq(
      '(',
      choice(
        prec.dynamic(1, seq(alias(choice(featureIdentifier($), $._escaped_identifier), $.feature_name), $._range_comparison, $._range_value)),
        seq($._range_start_value, $._range_comparison, alias(choice(featureIdentifier($), $._escaped_identifier), $.feature_name)),
        seq($._range_start_value, choice('<', '<='), alias(choice(featureIdentifier($), $._escaped_identifier), $.feature_name), choice('<', '<='), $._range_value),
        seq($._range_start_value, choice('>', '>='), alias(choice(featureIdentifier($), $._escaped_identifier), $.feature_name), choice('>', '>='), $._range_value),
      ),
      ')',
    ),

    _range_comparison: _ => choice('<', '<=', '>', '>=', '='),

    _range_start_value: $ => choice(
      $.integer_value,
      $.float_value,
      alias(choice(featureIdentifier($), $._escaped_identifier), $.plain_value),
      $.ratio_value,
      alias($._range_start_call_expression, $.call_expression),
    ),

    _range_start_call_expression: $ => seq(alias(featureIdentifier($), $.function_name), $.arguments),

    _range_value: $ => choice(
      $.integer_value,
      $.float_value,
      alias(choice(valueIdentifier($), $._escaped_identifier), $.plain_value),
      $.ratio_value,
      $.call_expression,
    ),

    ratio_value: $ => seq(
      choice(alias($._integer, $.integer_value), alias($._float, $.float_value)),
      valueSlash,
      choice(alias($._integer, $.integer_value), alias($._float, $.float_value)),
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
      optional($._descendant_combinator),
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
      queryOpeningParenthesis, alias($._query_identifier, $.feature_name), ':',
      repeat($._at_rule_nested_component), ')',
    )),

    general_enclosed_query: $ => prec.dynamic(2, seq(
      choice($.at_rule_value, alias(queryKeyword($), $.at_rule_value)),
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

    _container_parenthesized_query: $ => seq(queryOpeningParenthesis, $._container_query, ')'),

    style_query: $ => prec.dynamic(3, seq(
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
        alias(queryKeyword($), $.at_rule_value),
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

    identifier: _ => token(seq(choice('--', seq(optional('-'), nameStart)), repeat(nameContinue))),

    _query_identifier: $ => choice($._custom_property_component, token(seq(
      choice(seq(optional('-'), choice(/[_a-zA-Z\u0080-\u{10FFFF}]/u, cssEscape)), '--'),
      repeat(genericNameCharacter),
    ))),

    _style_range_value: $ => choice($._query_identifier, token(seq(choice(
      seq(optional(/[#@]/), genericName),
      seq(/[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/, optional(choice(genericName, '%'))),
      /[^\s(){}\[\];,:"'\\/<>=]/,
    ), repeat('//')))),

    _style_parenthesized_query: $ => seq(queryOpeningParenthesis, choice($._style_condition, repeat($._at_rule_nested_component)), ')'),

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

    _value: $ => value($, $.binary_expression),

    _declaration_value: $ => value($, alias($._declaration_binary_expression, $.binary_expression), true),

    _declaration_binary_expression: $ => choice(
      prec.left(2, seq($._declaration_value, $._declaration_operator_gap, arithmeticOperator($), $._declaration_operand_gap, $._declaration_value)),
      prec.left(1, seq($._declaration_value, $._declaration_operator_gap, arithmeticOperator($))),
    ),

    parenthesized_value: $ => seq(
      '(',
      valueSequence($),
      ')',
    ),

    color_value: _ => token(seq('#', choice(/[0-9a-fA-F]{3,4}/, /[0-9a-fA-F]{6}/, /[0-9a-fA-F]{8}/))),

    hash_value: _ => token(seq('#', repeat1(choice(nameContinue, cssEscape)))),

    string_value: $ => choice(
      seq(
        '\'',
        repeat(choice(
          alias(token(prec(1, /[^\\'\n\r\f]+/)), $.string_content),
          $.escape_sequence,
          alias($._string_continuation, $.escape_sequence),
        )),
        '\'',
      ),
      seq(
        '"',
        repeat(choice(
          alias(token(prec(1, /[^\\"\n\r\f]+/)), $.string_content),
          $.escape_sequence,
          alias($._string_continuation, $.escape_sequence),
        )),
        '"',
      ),
    ),

    _string_continuation: _ => token(seq('\\', /\r\n?|[\n\f]/)),

    escape_sequence: _ => token(seq(
      '\\',
      choice(
        /[0-9a-fA-F]{1,6}\s?/,
        /[^0-9a-fA-F\n\r\f]/,
      ),
    )),

    integer_value: $ => seq($._integer, optional(valueUnit($))),

    _declaration_integer_value: $ => seq($._integer, choice(
      seq($._value_unit_start, $.unit),
      $._value_number_end,
    )),

    float_value: $ => seq($._float, optional(valueUnit($))),

    _declaration_float_value: $ => seq($._float, choice(
      seq($._value_unit_start, $.unit),
      $._value_number_end,
    )),

    _integer: _ => token(seq(
      optional(choice('+', '-')),
      /\d+/,
    )),

    _float: _ => token(seq(
      optional(choice('+', '-')),
      /\d*/,
      choice(
        seq('.', /\d+/),
        seq(/[eE]/, optional(choice('+', '-')), /\d+/),
        seq('.', /\d+/, /[eE]/, optional(choice('+', '-')), /\d+/),
      ),
    )),

    unit: _ => token.immediate(/[a-zA-Z%]+/),

    grid_value: $ => seq(
      '[',
      valueSequence($),
      ']',
    ),

    url_value: _ => token(unquotedUrl),

    call_expression: $ => seq(alias(valueIdentifier($), $.function_name), $.arguments),

    _declaration_call_expression: $ => prec.dynamic(4, seq(
      alias(valueIdentifier($), $.function_name),
      optional($._value_call_start),
      $.arguments,
    )),

    binary_expression: $ => choice(
      prec.left(2, seq($._value, arithmeticOperator($), $._value)),
      prec.left(1, seq($._value, arithmeticOperator($))),
    ),

    arguments: $ => seq(
      token.immediate('('),
      valueSequence($),
      ')',
    ),

    class_name: $ => choice(
      $.identifier,
      alias(choice(queryKeyword($), $._custom_property_component), $.identifier),
      alias(escapedIdentifier(optional(choice(
        '-',
        seq('--', repeat(nameContinue)),
        seq(optional('-'), nameStart, repeat(nameContinue)),
      )), 1), $.identifier),
    ),

    at_keyword: _ => token(seq('@', idName)),

    js_comment: _ => token(prec(-1, seq('//', /.*/))),

    comment: _ => token(seq(
      '/*',
      /[^*]*\*+([^/*][^*]*\*+)*/,
      '/',
    )),

    plain_value: _ => plainValue(),

    // Plain values in generic pseudo arguments end at selector delimiters, so that compound and namespaced selectors
    // such as `a.b:hover` and `svg|a` keep their selector interpretation.
    _pseudo_plain_value: _ => plainValue('.#|>+~'),
  },
});

function importUrlModifiers($) {
  return repeat(choice(
    alias(choice($.identifier, $._escaped_identifier), $.plain_value),
    alias($._import_url_modifier, $.call_expression),
  ));
}

function declarationValue($, final = false) {
  const ending = seq(
    optional($.important),
    optional($._declaration_boundary),
    ...(final ? [$._declaration_terminator_gap] : []),
  );
  return choice(
    seq(
      alias(propertyIdentifier($), $.property_name),
      optional($._descendant_combinator),
      ':',
      $._declaration_value_start,
      $._declaration_continuation,
      $._declaration_value,
      repeat(seq(optional(seq(optional($._declaration_comma_gap), ',')), $._declaration_continuation, $._declaration_value)),
      ending,
    ),
    seq(
      alias($._custom_property_component, $.property_name),
      optional($._descendant_combinator),
      ':',
      $._declaration_value_start,
      choice($._declaration_continuation, $._declaration_boundary),
      choice(
        seq(alias($.at_rule_braced, $.block_value), ending),
        optional($._declaration_boundary),
      ),
    ),
  );
}

function propertyIdentifier($) {
  return choice(selectorIdentifier($), $._recovery_identifier, $._custom_property_name, $._star_property_name);
}

function selectorIdentifier($) {
  return choice(
    valueIdentifier($),
    'and',
    'or',
    escapedName,
    selectorFunctionName,
    queryKeyword($),
    $._custom_property_component,
  );
}

function valueUnit($) {
  return choice(
    $.unit,
    ...['from', 'to', 'only', 'selector'].map(name => alias(token.immediate(name), $.unit)),
  );
}

function valueIdentifier($) {
  return choice($.identifier, $.from, $.to, 'only', 'selector');
}

function featureIdentifier($) {
  return choice($.identifier, $.from, $.to);
}

function queryKeyword($) {
  return choice($._style_keyword, $._query_not, $._query_and, $._query_or);
}

function value($, binaryExpression, declaration = false) {
  return choice(
    seq(alias($._invalid_value_dot, $.plain_value), $.__error_recovery),
    prec(-1, choice(
      alias(valueIdentifier($), $.plain_value),
      $.plain_value,
      hashValue($, declaration),
      '#',
      declaration ? alias($._declaration_integer_value, $.integer_value) : $.integer_value,
      declaration ? alias($._declaration_float_value, $.float_value) : $.float_value,
      $.string_value,
      $.grid_value,
      binaryExpression,
      $.parenthesized_value,
      declaration ? alias($._declaration_call_expression, $.call_expression) : $.call_expression,
      declaration ? prec.dynamic(4, $.url_value) : $.url_value,
      $.important,
      prec.dynamic(-1, alias(choice($._value_dot, $._value_ampersand, $._value_asterisk, '=', '?', valueAt, '|', '^', '$', '~', '<', '>', '+', valueSlash, '`', token(prec(-1, nonAsciiDelimiter)), token(prec(-1, nonAsciiNoncharacterDelimiter))), $.plain_value)),
      alias(token(prec(-1, '%')), $.plain_value),
      alias(token(prec(-1, ':')), $.plain_value),
    )),
    ...(declaration ? [prec.dynamic(4, seq(
      alias(choice($._escaped_identifier, escapedName), $.plain_value),
      $._value_call_start,
    ))] : []),
    alias(choice($._escaped_identifier, escapedName), $.plain_value),
  );
}

function hashValue($, declaration) {
  const hash = choice($.color_value, $.hash_value);
  const tail = optional(alias($._hash_slash_tail, $.plain_value));
  return declaration ? seq(hash, optional($._hash_tail_gap), tail) : seq(hash, tail);
}

function arithmeticOperator($) {
  return choice('+', '-', '*', alias($._value_asterisk, '*'), alias($._binary_asterisk, '*'), valueSlash);
}

function valueSequence($) {
  return sep(choice(',', ';'), repeat1($._value));
}

function pseudoArgument($) {
  return choice(
    prec.dynamic(1, seq($._selector, optional($._descendant_combinator))),
    prec.left(repeat1(seq(choice(pseudoComponent($), pseudoEscapedValue($)), optional($._descendant_combinator)))),
  );
}

function pseudoComponent($) {
  return choice(prec(-1, pseudoValue($)), alias($._pseudo_binary_expression, $.binary_expression));
}

function pseudoValue($) {
  return choice(
    alias(valueIdentifier($), $.plain_value),
    $.integer_value,
    $.float_value,
    $.string_value,
    $.parenthesized_value,
    $.call_expression,
    $.url_value,
    $.important,
    alias($._pseudo_plain_value, $.plain_value),
    $.color_value,
    $.grid_value,
    alias(token(seq('*-', genericName)), $.plain_value),
  );
}

function pseudoEscapedValue($) {
  return alias(choice($._escaped_identifier, escapedName), $.plain_value);
}

function plainValue(selectorDelimiters = '') {
  const continuation = new RegExp(`[^/\\s,;:!{}()\\[\\]${selectorDelimiters}]`);
  const slashContinuation = new RegExp(`\\/[^\\*\\s,;:!{}()\\[\\]${selectorDelimiters}]`);
  return token(choice(
    /<[a-zA-Z-]+>[+#]?/,
    seq(
      repeat(choice(/[-_]/, slashContinuation)),
      /[a-zA-Z]/,
      repeat(choice(continuation, slashContinuation)),
    ),
  ));
}

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
  const alternatives = escapedOnly ? [] : [letters];
  if (!/[a-f]/.test(character)) alternatives.push(String.raw`\\${letters}`);
  if (rest && /[a-f]/.test(rest[0])) {
    alternatives.push(
      String.raw`\\0{4}${code}${whitespace}?`,
      String.raw`\\0{0,3}${code}${whitespace}`,
    );
    return String.raw`(?:(?:${alternatives.join('|')})${suffix}|\\0{0,3}${code}${cssKeywordPattern(rest, true)})`;
  }
  alternatives.push(String.raw`\\0{0,4}${code}${whitespace}?`);
  return `(?:${alternatives.join('|')})${suffix}`;
}

/** @param {RuleOrLiteral} prefix */
function escapedIdentifier(prefix, precedence = 0) {
  return token(prec(precedence, seq(
    prefix,
    repeat1(seq(
      '\\',
      choice(
        /[0-9a-fA-F]{1,6}(?:[ \t\n\f]|\r\n?)?/,
        /[^0-9a-fA-F\n\r\f]/,
      ),
      repeat(nameContinue),
    )),
  )));
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
