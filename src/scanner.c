#include "tree_sitter/parser.h"

#include <wctype.h>

enum TokenType {
    DESCENDANT_OP,
    ERROR_RECOVERY,
    CLASS_NAME_ESCAPE_WITH_SUFFIX,
    AT_RULE_SLASH,
    INCOMPLETE_DECLARATION_END,
};

static bool scan_incomplete_declaration_end(TSLexer *lexer, bool allow_descendant);
static bool scan_at_rule_slash(TSLexer *lexer);
static bool scan_class_name_escape_with_suffix(TSLexer *lexer);
static bool scan_escape(TSLexer *lexer);
static bool scan_descendant_operator(TSLexer *lexer);
static bool is_name_character(int32_t character);
static bool is_name_start(int32_t character);
static bool is_hex_digit(int32_t character);
static bool is_digit(int32_t character);
static void advance(TSLexer *lexer);
static void skip(TSLexer *lexer);

void *tree_sitter_css_external_scanner_create() { return NULL; }

void tree_sitter_css_external_scanner_destroy(void *payload) {}

unsigned tree_sitter_css_external_scanner_serialize(void *payload, char *buffer) { return 0; }

void tree_sitter_css_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {}

bool tree_sitter_css_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    if (valid_symbols[ERROR_RECOVERY]) {
        return false;
    }
    if (valid_symbols[INCOMPLETE_DECLARATION_END] && iswspace(lexer->lookahead)) {
        return scan_incomplete_declaration_end(lexer, valid_symbols[DESCENDANT_OP]);
    }
    if (valid_symbols[AT_RULE_SLASH]) {
        return scan_at_rule_slash(lexer);
    }
    if (valid_symbols[CLASS_NAME_ESCAPE_WITH_SUFFIX] && lexer->lookahead == '\\') {
        return scan_class_name_escape_with_suffix(lexer);
    }
    if (iswspace(lexer->lookahead) && valid_symbols[DESCENDANT_OP]) {
        return scan_descendant_operator(lexer);
    }
    return false;
}

static bool scan_incomplete_declaration_end(TSLexer *lexer, bool allow_descendant) {
    bool newline = false;
    while (iswspace(lexer->lookahead)) {
        newline |= lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->lookahead == '\f';
        advance(lexer);
    }
    lexer->mark_end(lexer);
    bool descendant = allow_descendant && (lexer->lookahead == '#' || lexer->lookahead == '.' ||
        lexer->lookahead == '[' || lexer->lookahead == '-' || lexer->lookahead == '*' ||
        lexer->lookahead == '&' || lexer->lookahead == ':' || iswalnum(lexer->lookahead));
    lexer->result_symbol = DESCENDANT_OP;
    if (!newline || !(is_name_start(lexer->lookahead) || lexer->lookahead == '-')) {
        return descendant;
    }
    while (is_name_character(lexer->lookahead)) {
        advance(lexer);
    }
    while (iswspace(lexer->lookahead)) {
        advance(lexer);
    }
    if (lexer->lookahead != ':') {
        return descendant;
    }
    advance(lexer);
    if (!iswspace(lexer->lookahead)) {
        return descendant;
    }
    lexer->result_symbol = INCOMPLETE_DECLARATION_END;
    return true;
}

static bool scan_at_rule_slash(TSLexer *lexer) {
    while (iswspace(lexer->lookahead)) {
        skip(lexer);
    }
    if (lexer->lookahead != '/') {
        return false;
    }
    advance(lexer);
    lexer->mark_end(lexer);
    if (lexer->lookahead == '*' || lexer->lookahead == '/') {
        return false;
    }
    lexer->result_symbol = AT_RULE_SLASH;
    return true;
}

static bool scan_class_name_escape_with_suffix(TSLexer *lexer) {
    if (!scan_escape(lexer)) {
        return false;
    }
    if (lexer->lookahead == '-') {
        advance(lexer);
        if (is_name_start(lexer->lookahead) || lexer->lookahead == '-') {
            return false;
        }
    } else if (!is_digit(lexer->lookahead)) {
        return false;
    }
    while (is_name_character(lexer->lookahead)) {
        advance(lexer);
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = CLASS_NAME_ESCAPE_WITH_SUFFIX;
    return true;
}

static bool scan_escape(TSLexer *lexer) {
    advance(lexer);
    if (lexer->eof(lexer) || lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->lookahead == '\f') {
        return false;
    }
    if (!is_hex_digit(lexer->lookahead)) {
        advance(lexer);
        return true;
    }
    unsigned digits = 0;
    while (digits < 6 && is_hex_digit(lexer->lookahead)) {
        advance(lexer);
        digits++;
    }
    if (lexer->lookahead == '\r') {
        advance(lexer);
        if (lexer->lookahead == '\n') {
            advance(lexer);
        }
    } else if (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\n' || lexer->lookahead == '\f') {
        advance(lexer);
    }
    return true;
}

static bool scan_descendant_operator(TSLexer *lexer) {
    lexer->result_symbol = DESCENDANT_OP;
    skip(lexer);
    while (iswspace(lexer->lookahead)) {
        skip(lexer);
    }
    lexer->mark_end(lexer);
    if (lexer->lookahead == '#' || lexer->lookahead == '.' || lexer->lookahead == '[' || lexer->lookahead == '-' ||
        lexer->lookahead == '*' || lexer->lookahead == '&' || iswalnum(lexer->lookahead)) {
        return true;
    }
    return lexer->lookahead == ':';
}

static bool is_name_character(int32_t character) {
    return is_name_start(character) || is_digit(character) || character == '-';
}

static bool is_name_start(int32_t character) {
    return (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || character == '_' ||
           (character >= 0xA0 && character <= 0xFF);
}

static bool is_hex_digit(int32_t character) {
    return is_digit(character) || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F');
}

static bool is_digit(int32_t character) { return character >= '0' && character <= '9'; }

static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static void skip(TSLexer *lexer) { lexer->advance(lexer, true); }
