#ifndef TREE_SITTER_CSS_LEXER_H_
#define TREE_SITTER_CSS_LEXER_H_

#include "tree_sitter/parser.h"

static bool scan_unquoted_url_tail(TSLexer *lexer);
static bool scan_plain_value_tail(TSLexer *lexer);
static bool scan_plain_slash_tail(TSLexer *lexer);
static bool is_plain_value_character(int32_t character);
static bool scan_escape(TSLexer *lexer);
static bool scan_decoded_escape(TSLexer *lexer, int32_t *decoded);
static void scan_escape_terminator(TSLexer *lexer);
static bool is_unit_character(int32_t character);
static bool is_css_whitespace(int32_t character);
static bool is_regex_whitespace(int32_t character);
static char keyword_character(int32_t character);
static bool is_hex_digit(int32_t character);
static bool is_digit(int32_t character);
static void advance(TSLexer *lexer);
static void skip(TSLexer *lexer);

static bool scan_unquoted_url_tail(TSLexer *lexer) {
    advance(lexer);
    while (is_css_whitespace(lexer->lookahead)) advance(lexer);
    while (!lexer->eof(lexer) && lexer->lookahead != ')' && !is_css_whitespace(lexer->lookahead)) {
        if (lexer->lookahead <= 0x20 || lexer->lookahead == 0x7F || lexer->lookahead == '\'' ||
            lexer->lookahead == '"' || lexer->lookahead == '(') return false;
        if (lexer->lookahead != '\\') {
            advance(lexer);
            continue;
        }
        if (!scan_escape(lexer)) return false;
    }
    while (is_css_whitespace(lexer->lookahead)) advance(lexer);
    return lexer->lookahead == ')';
}

static bool scan_plain_value_tail(TSLexer *lexer) {
    if (lexer->eof(lexer)) return false;
    if (lexer->lookahead == '/') {
        advance(lexer);
        return !lexer->eof(lexer) && lexer->lookahead != '*' && is_plain_value_character(lexer->lookahead);
    }
    return is_plain_value_character(lexer->lookahead);
}

static bool scan_plain_slash_tail(TSLexer *lexer) {
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '/') {
            advance(lexer);
            if (lexer->eof(lexer) || lexer->lookahead == '*' || !is_plain_value_character(lexer->lookahead)) return false;
        } else if (!is_plain_value_character(lexer->lookahead)) {
            return true;
        }
        advance(lexer);
    }
    return true;
}

static bool is_plain_value_character(int32_t character) {
    switch (character) {
        case ',': case ';': case ':': case '!': case '{': case '}': case '(': case ')': case '[': case ']':
            return false;
        default: return !is_regex_whitespace(character);
    }
}

static bool scan_escape(TSLexer *lexer) {
    return scan_decoded_escape(lexer, NULL);
}

static bool scan_decoded_escape(TSLexer *lexer, int32_t *decoded) {
    advance(lexer);
    if (lexer->eof(lexer) || lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->lookahead == '\f') {
        return false;
    }
    if (!is_hex_digit(lexer->lookahead)) {
        if (decoded) *decoded = lexer->lookahead;
        advance(lexer);
        return true;
    }
    unsigned digits = 0;
    int32_t value = 0;
    while (digits < 6 && is_hex_digit(lexer->lookahead)) {
        int32_t digit = lexer->lookahead;
        value = value * 16 + (digit <= '9' ? digit - '0' : (digit | 32) - 'a' + 10);
        advance(lexer);
        digits++;
    }
    if (decoded) *decoded = value == 0 ? 0xFFFD : value;
    scan_escape_terminator(lexer);
    return true;
}

static void scan_escape_terminator(TSLexer *lexer) {
    if (lexer->lookahead == '\r') {
        advance(lexer);
        if (lexer->lookahead == '\n') advance(lexer);
    } else if (is_css_whitespace(lexer->lookahead)) {
        advance(lexer);
    }
}

static bool is_unit_character(int32_t character) {
    return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character == '%';
}

static bool is_css_whitespace(int32_t character) {
    return character == ' ' || character == '\t' || character == '\n' || character == '\r' || character == '\f';
}

// The generated lexer matches the `\s` that grammar.js excludes from at_rule_url as ASCII whitespace only, which
// includes the vertical tab that CSS does not treat as whitespace.
static bool is_regex_whitespace(int32_t character) {
    return (character >= '\t' && character <= '\r') || character == ' ';
}

static char keyword_character(int32_t character) {
    if (character >= 'A' && character <= 'Z') return (char)(character + 'a' - 'A');
    return character < 0x80 ? (char)character : '?';
}

static bool is_hex_digit(int32_t character) {
    return is_digit(character) || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F');
}

static bool is_digit(int32_t character) { return character >= '0' && character <= '9'; }

static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

#endif
