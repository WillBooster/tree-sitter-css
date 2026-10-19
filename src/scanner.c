#include "tree_sitter/parser.h"

#include <wctype.h>

enum TokenType {
    DESCENDANT_OP,
    ERROR_RECOVERY,
    CLASS_NAME_ESCAPE_WITH_SUFFIX,
    AT_RULE_SLASH,
    INCOMPLETE_DECLARATION_END,
    LAYER_NAME_IDENTIFIER,
    LAYER_NAME_PREFIX,
};

static bool scan_layer_name_identifier(TSLexer *lexer, const bool *valid_symbols);
static bool scan_layer_name_token(TSLexer *lexer);
static bool scan_layer_name_tail(TSLexer *lexer);
static bool scan_layer_name_gap(TSLexer *lexer, bool *whitespace);
static bool is_css_whitespace(int32_t character);
static bool scan_incomplete_declaration_end(TSLexer *lexer, bool allow_descendant);
static bool scan_property_colon(TSLexer *lexer);
static bool scan_separator_comment(TSLexer *lexer);
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
    if (valid_symbols[LAYER_NAME_IDENTIFIER] || valid_symbols[LAYER_NAME_PREFIX]) {
        return scan_layer_name_identifier(lexer, valid_symbols);
    }
    if (valid_symbols[INCOMPLETE_DECLARATION_END] && (iswspace(lexer->lookahead) || lexer->lookahead == '/')) {
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

static bool scan_layer_name_identifier(TSLexer *lexer, const bool *valid_symbols) {
    while (is_css_whitespace(lexer->lookahead)) skip(lexer);
    if (!scan_layer_name_token(lexer)) {
        return false;
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = LAYER_NAME_IDENTIFIER;
    bool whitespace = false;
    if (scan_layer_name_gap(lexer, &whitespace) && lexer->lookahead == '.' && !whitespace) {
        advance(lexer);
        if (scan_layer_name_gap(lexer, &whitespace) && !whitespace && scan_layer_name_token(lexer)) {
            lexer->result_symbol = LAYER_NAME_PREFIX;
        }
    }
    return valid_symbols[lexer->result_symbol];
}

static bool scan_layer_name_token(TSLexer *lexer) {
    if (lexer->lookahead == '-') {
        advance(lexer);
        if (lexer->lookahead == '-') {
            advance(lexer);
            return scan_layer_name_tail(lexer);
        }
    }
    if (!(lexer->lookahead == '\\' || is_name_start(lexer->lookahead) || lexer->lookahead >= 0x80)) {
        return false;
    }
    return scan_layer_name_tail(lexer);
}

static bool scan_layer_name_tail(TSLexer *lexer) {
    while (is_name_character(lexer->lookahead) || lexer->lookahead >= 0x80 || lexer->lookahead == '\\') {
        if (lexer->lookahead == '\\') {
            if (!scan_escape(lexer)) return false;
        } else {
            advance(lexer);
        }
    }
    return true;
}

static bool scan_layer_name_gap(TSLexer *lexer, bool *whitespace) {
    for (;;) {
        if (is_css_whitespace(lexer->lookahead)) {
            *whitespace = true;
            advance(lexer);
        } else if (lexer->lookahead == '/') {
            if (!scan_separator_comment(lexer)) return false;
        } else {
            return true;
        }
    }
}

static bool is_css_whitespace(int32_t character) {
    return character == ' ' || character == '\t' || character == '\n' || character == '\r' || character == '\f';
}

static bool scan_incomplete_declaration_end(TSLexer *lexer, bool allow_descendant) {
    bool newline = false;
    bool whitespace = false;
    lexer->mark_end(lexer);
    for (;;) {
        if (iswspace(lexer->lookahead)) {
            whitespace = true;
            newline |= lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->lookahead == '\f';
            advance(lexer);
        } else if (lexer->lookahead == '/') {
            if (!scan_separator_comment(lexer)) {
                return false;
            }
        } else {
            break;
        }
    }
    bool descendant = allow_descendant && whitespace && (lexer->lookahead == '#' || lexer->lookahead == '.' ||
        lexer->lookahead == '[' || lexer->lookahead == '-' || lexer->lookahead == '*' ||
        lexer->lookahead == '&' || lexer->lookahead == ':' || iswalnum(lexer->lookahead));
    lexer->result_symbol = DESCENDANT_OP;
    if (!newline || !(is_name_start(lexer->lookahead) || lexer->lookahead == '-' || lexer->lookahead == '\\')) {
        return descendant;
    }
    if (!scan_property_colon(lexer)) {
        return descendant;
    }
    lexer->result_symbol = INCOMPLETE_DECLARATION_END;
    return true;
}

static bool scan_property_colon(TSLexer *lexer) {
    while (is_name_character(lexer->lookahead) || lexer->lookahead == '\\') {
        if (lexer->lookahead != '\\') {
            advance(lexer);
            continue;
        }
        if (!scan_escape(lexer)) {
            return false;
        }
    }
    while (iswspace(lexer->lookahead) || lexer->lookahead == '/') {
        if (lexer->lookahead != '/') {
            advance(lexer);
            continue;
        }
        if (!scan_separator_comment(lexer)) {
            return false;
        }
    }
    return lexer->lookahead == ':';
}

static bool scan_separator_comment(TSLexer *lexer) {
    advance(lexer);
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
