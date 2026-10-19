#include "tree_sitter/parser.h"

#include <wctype.h>

enum TokenType {
    DESCENDANT_OP,
    ERROR_RECOVERY,
    AT_RULE_SLASH,
    INCOMPLETE_DECLARATION_END,
};

static bool scan_incomplete_declaration_end(TSLexer *lexer, bool allow_descendant);
static bool scan_property_colon(TSLexer *lexer);
static bool scan_separator_comment(TSLexer *lexer);
static bool scan_comment_body(TSLexer *lexer);
static bool scan_at_rule_slash(TSLexer *lexer, bool allow_descendant);
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
    if (valid_symbols[INCOMPLETE_DECLARATION_END] && !valid_symbols[AT_RULE_SLASH] &&
        (iswspace(lexer->lookahead) || lexer->lookahead == '/')) {
        return scan_incomplete_declaration_end(lexer, valid_symbols[DESCENDANT_OP]);
    }
    if (valid_symbols[AT_RULE_SLASH] || (iswspace(lexer->lookahead) && valid_symbols[DESCENDANT_OP])) {
        bool whitespace = false;
        while (iswspace(lexer->lookahead)) {
            whitespace = true;
            skip(lexer);
        }
        lexer->mark_end(lexer);
        if (lexer->lookahead == '/' && valid_symbols[AT_RULE_SLASH]) {
            return scan_at_rule_slash(lexer, whitespace && valid_symbols[DESCENDANT_OP]);
        }
        return whitespace && valid_symbols[DESCENDANT_OP] && scan_descendant_operator(lexer);
    }
    return false;
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
        lexer->lookahead == '&' || lexer->lookahead == ':' || lexer->lookahead == '\\' || is_name_character(lexer->lookahead));
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
    return scan_comment_body(lexer);
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

static bool scan_at_rule_slash(TSLexer *lexer, bool allow_descendant) {
    if (lexer->lookahead != '/') {
        return false;
    }
    advance(lexer);
    if (lexer->lookahead == '*' || lexer->lookahead == '/') {
        if (!allow_descendant || !scan_comment_body(lexer)) {
            return false;
        }
        while (iswspace(lexer->lookahead) || lexer->lookahead == '/') {
            if (iswspace(lexer->lookahead)) {
                advance(lexer);
            } else if (!scan_separator_comment(lexer)) {
                return false;
            }
        }
        return scan_descendant_operator(lexer);
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = AT_RULE_SLASH;
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
    if (lexer->lookahead == '#' || lexer->lookahead == '.' || lexer->lookahead == '[' || lexer->lookahead == '-' ||
        lexer->lookahead == '*' || lexer->lookahead == '&' || lexer->lookahead == '\\' || is_name_character(lexer->lookahead)) {
        return true;
    }
    return lexer->lookahead == ':';
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

static bool is_hex_digit(int32_t character) {
    return is_digit(character) || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F');
}

static bool is_digit(int32_t character) { return character >= '0' && character <= '9'; }

static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static void skip(TSLexer *lexer) { lexer->advance(lexer, true); }
