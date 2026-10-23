#ifndef TREE_SITTER_CSS_LEXER_H_
#define TREE_SITTER_CSS_LEXER_H_

#include "tree_sitter/parser.h"
#include <wctype.h>

typedef enum { PROBE_GAP, PROBE_PREFIX, PROBE_PLAIN, PROBE_HASH, PROBE_NAME } ProbeContext;

static void scan_value_start_gap(TSLexer *lexer);
static bool scan_probe_component(TSLexer *lexer, bool *stop, ProbeContext *context, ProbeContext *memo_context);
static void scan_probe_slash(TSLexer *lexer, ProbeContext *context, ProbeContext *memo_context);
static bool scan_probe_marker(TSLexer *lexer, ProbeContext *context);
static void scan_quoted_component(TSLexer *lexer);
static bool is_probe_cursor(int32_t character);
static ProbeContext probe_character_context(ProbeContext context, int32_t character);
static bool scan_plain_slash_prefix(TSLexer *lexer);
static bool scan_comment_body(TSLexer *lexer);
static bool is_selector_prefix(int32_t character);
static bool is_html_marker_prefix(int32_t character);
static bool is_name_character(int32_t character);
static bool is_name_start(int32_t character);


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

static void scan_value_start_gap(TSLexer *lexer) {
    ProbeContext context = PROBE_GAP;
    ProbeContext memo_context = PROBE_GAP;
    while (!lexer->eof(lexer)) {
        if (is_regex_whitespace(lexer->lookahead)) advance(lexer);
        else if (lexer->lookahead == '/') scan_probe_slash(lexer, &context, &memo_context);
        else if (is_html_marker_prefix(lexer->lookahead)) scan_probe_marker(lexer, &context);
        else break;
        if (context != PROBE_GAP) break;
    }
}

static bool scan_probe_component(TSLexer *lexer, bool *stop, ProbeContext *context, ProbeContext *memo_context) {
    switch (lexer->lookahead) {
        case '\'': case '"':
            if (*context == PROBE_PLAIN) advance(lexer);
            else { scan_quoted_component(lexer); *context = PROBE_GAP; }
            return true;
        case '\\':
            *stop = !scan_escape(lexer);
            if (*context != PROBE_PLAIN && *context != PROBE_HASH) *context = PROBE_NAME;
            return true;
        case '<': case '-':
            if (*context == PROBE_PLAIN) return false;
            if (*context != PROBE_HASH) *memo_context = PROBE_GAP;
            return scan_probe_marker(lexer, context);
        case '/':
            scan_probe_slash(lexer, context, memo_context);
            return true;
        default: return false;
    }
}

static void scan_probe_slash(TSLexer *lexer, ProbeContext *context, ProbeContext *memo_context) {
    advance(lexer);
    if (lexer->lookahead == '*') {
        scan_comment_body(lexer);
        if (*context != PROBE_HASH) *context = PROBE_GAP;
        *memo_context = *context;
        return;
    }
    bool line_comment = lexer->lookahead == '/';
    if (scan_plain_slash_prefix(lexer)) {
        scan_plain_slash_tail(lexer);
        *context = PROBE_PLAIN;
    } else if (line_comment && *context != PROBE_PLAIN && *context != PROBE_HASH) {
        while (!lexer->eof(lexer) && lexer->lookahead != '\n') advance(lexer);
        *context = PROBE_GAP;
        *memo_context = PROBE_GAP;
    } else {
        *context = PROBE_PLAIN;
    }
}

static bool scan_probe_marker(TSLexer *lexer, ProbeContext *context) {
    ProbeContext previous = *context;
    const char *marker = lexer->lookahead == '<' ? "<!--" : "-->";
    for (unsigned i = 0; marker[i]; i++) {
        if (lexer->lookahead != marker[i]) return true;
        *context = probe_character_context(*context, lexer->lookahead);
        advance(lexer);
    }
    *context = previous == PROBE_HASH ? PROBE_HASH : PROBE_GAP;
    return true;
}

static void scan_quoted_component(TSLexer *lexer) {
    int32_t quote = lexer->lookahead;
    advance(lexer);
    while (!lexer->eof(lexer)) {
        int32_t character = lexer->lookahead;
        advance(lexer);
        if (character == quote) return;
        if (character == '\\' && !lexer->eof(lexer)) advance(lexer);
    }
}

static bool is_probe_cursor(int32_t character) {
    return iswspace(character) || is_selector_prefix(character) || character == '/' || is_html_marker_prefix(character);
}

static ProbeContext probe_character_context(ProbeContext context, int32_t character) {
    if (!is_plain_value_character(character)) return PROBE_GAP;
    if (context == PROBE_PLAIN) return context;
    if ((context == PROBE_HASH || context == PROBE_NAME) && is_name_character(character)) return context;
    if (character == '#') return PROBE_HASH;
    if ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z')) return PROBE_PLAIN;
    if (character == '-' || character == '_') return PROBE_PREFIX;
    return is_name_start(character) ? PROBE_NAME : PROBE_GAP;
}

static bool scan_plain_slash_prefix(TSLexer *lexer) {
    if (lexer->eof(lexer) || lexer->lookahead == '*' || !is_plain_value_character(lexer->lookahead)) return false;
    advance(lexer);
    while (lexer->lookahead == '-' || lexer->lookahead == '_' || lexer->lookahead == '/') {
        if (lexer->lookahead == '/') {
            advance(lexer);
            if (lexer->eof(lexer) || lexer->lookahead == '*' || !is_plain_value_character(lexer->lookahead)) return false;
        }
        advance(lexer);
    }
    return (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
        (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z');
}

static bool scan_comment_body(TSLexer *lexer) {
    if (lexer->lookahead == '/') {
        while (!lexer->eof(lexer) && lexer->lookahead != '\n' && lexer->lookahead != '\r') {
            advance(lexer);
        }
        return true;
    }
    if (lexer->lookahead != '*') {
        return false;
    }
    advance(lexer);
    while (!lexer->eof(lexer)) {
        bool star = lexer->lookahead == '*';
        advance(lexer);
        if (star && lexer->lookahead == '/') {
            advance(lexer);
            return true;
        }
    }
    return false;
}

static bool is_selector_prefix(int32_t character) {
    switch (character) {
        case ':': case '>': case '~': case '|': case '@': case '*': case '+': case '#': case '[': case '.': case '&':
            return true;
        default: return false;
    }
}

static bool is_html_marker_prefix(int32_t character) {
    return character == '<' || character == '-';
}

static bool is_name_character(int32_t character) {
    return is_name_start(character) || is_digit(character) || character == '-';
}

static bool is_name_start(int32_t character) {
    static const int32_t ranges[][2] = {
        {0xB7, 0xB7}, {0xC0, 0xD6}, {0xD8, 0xF6}, {0xF8, 0x37D}, {0x37F, 0x1FFF},
        {0x200C, 0x200D}, {0x203F, 0x2040}, {0x2070, 0x218F}, {0x2C00, 0x2FEF},
        {0x3001, 0xD7FF}, {0xF900, 0xFDCF}, {0xFDF0, 0xFFFD}, {0x10000, 0x10FFFF},
    };
    if ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character == '_') {
        return true;
    }
    for (unsigned i = 0; i < sizeof(ranges) / sizeof(ranges[0]); i++) {
        if (character >= ranges[i][0] && character <= ranges[i][1]) {
            return true;
        }
    }
    return false;
}

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
