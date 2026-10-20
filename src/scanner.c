#include "tree_sitter/parser.h"

#include <wctype.h>
#include <stdlib.h>
#include <stdatomic.h>
#include <string.h>
#include <limits.h>

typedef struct { uint32_t byte; uint32_t origin; bool used; bool result; } Memo;
typedef struct { uint32_t byte; unsigned depth; size_t previous; bool result; } ProbePrefix;
static atomic_uint_fast64_t next_parse_cookie = 1;
typedef struct {
    uint64_t cookie;
    uint64_t active_cookie;
    uint32_t active_origin;
    uint32_t probe_origin;
    size_t pending;
    Memo *memo;
    size_t count;
    size_t capacity;
    ProbePrefix *prefixes;
    size_t prefix_count;
    size_t prefix_capacity;
} Scanner;

enum TokenType {
    DESCENDANT_OP,
    ERROR_RECOVERY,
    AT_RULE_SLASH,
    INCOMPLETE_DECLARATION_END,
    VALUE_DOT,
    INVALID_VALUE_DOT,
    VALUE_AMPERSAND,
    VALUE_ASTERISK,
};

static bool scan_rule_gap(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols);
static bool scan_value_dot(TSLexer *lexer, bool allow_invalid);
static bool scan_value_selector_prefix(Scanner *scanner, TSLexer *lexer, TSSymbol symbol, bool guard_rule);
static bool probe_selector_boundary(Scanner *scanner, TSLexer *lexer, uint32_t byte);
static bool scan_probe_component(TSLexer *lexer, bool *stop);
static void scan_quoted_component(TSLexer *lexer);
static bool remember_probe(Scanner *scanner, bool result, unsigned brace_depth);
static void finish_probe_level(Scanner *scanner, unsigned depth);
static void record_probe_prefix(Scanner *scanner, uint32_t byte, unsigned depth);
static Memo *memo_slot(Scanner *scanner, uint32_t byte);
static void grow_memo(Scanner *scanner);
static bool scan_dot_following_gap(TSLexer *lexer);
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

void *tree_sitter_css_external_scanner_create() {
    Scanner *scanner = calloc(1, sizeof(Scanner));
    scanner->cookie = atomic_fetch_add_explicit(&next_parse_cookie, 1, memory_order_relaxed);
    if (!scanner->cookie) abort();
    return scanner;
}

void tree_sitter_css_external_scanner_destroy(void *payload) {
    Scanner *scanner = payload;
    free(scanner->memo);
    free(scanner->prefixes);
    free(scanner);
}

// A memo hit must inherit a recorded full probe's lookahead dependency through the external-token chain.
unsigned tree_sitter_css_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = payload;
    memcpy(buffer, &scanner->active_cookie, sizeof(uint64_t));
    memcpy(buffer + sizeof(uint64_t), &scanner->active_origin, sizeof(uint32_t));
    return sizeof(uint64_t) + sizeof(uint32_t);
}

void tree_sitter_css_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = payload;
    scanner->active_cookie = 0;
    scanner->active_origin = 0;
    if (length != sizeof(uint64_t) + sizeof(uint32_t)) return;
    memcpy(&scanner->active_cookie, buffer, sizeof(uint64_t));
    memcpy(&scanner->active_origin, buffer + sizeof(uint64_t), sizeof(uint32_t));
}

bool tree_sitter_css_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = payload;
    if (valid_symbols[ERROR_RECOVERY]) {
        return false;
    }
    if (valid_symbols[VALUE_AMPERSAND] && lexer->lookahead == '&') return scan_value_selector_prefix(scanner, lexer, VALUE_AMPERSAND, valid_symbols[INVALID_VALUE_DOT]);
    if (valid_symbols[VALUE_ASTERISK] && lexer->lookahead == '*') return scan_value_selector_prefix(scanner, lexer, VALUE_ASTERISK, valid_symbols[INVALID_VALUE_DOT]);
    if (valid_symbols[VALUE_DOT] && lexer->lookahead == '.') return scan_value_dot(lexer, valid_symbols[INVALID_VALUE_DOT]);
    if (valid_symbols[INCOMPLETE_DECLARATION_END] && !valid_symbols[AT_RULE_SLASH] &&
        (iswspace(lexer->lookahead) || lexer->lookahead == '/')) {
        return scan_incomplete_declaration_end(lexer, valid_symbols[DESCENDANT_OP]);
    }
    if (valid_symbols[AT_RULE_SLASH] || (iswspace(lexer->lookahead) &&
        (valid_symbols[DESCENDANT_OP] || valid_symbols[VALUE_DOT] || valid_symbols[VALUE_AMPERSAND] || valid_symbols[VALUE_ASTERISK]))) {
        return scan_rule_gap(scanner, lexer, valid_symbols);
    }
    return false;
}

static bool scan_rule_gap(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    bool whitespace = false;
    while (iswspace(lexer->lookahead)) {
        whitespace = true;
        skip(lexer);
    }
    lexer->mark_end(lexer);
    if (lexer->lookahead == '.' && valid_symbols[VALUE_DOT] &&
        !(whitespace && valid_symbols[DESCENDANT_OP])) return scan_value_dot(lexer, valid_symbols[INVALID_VALUE_DOT]);
    bool value_prefix = !(whitespace && valid_symbols[DESCENDANT_OP]);
    if (value_prefix && lexer->lookahead == '&' && valid_symbols[VALUE_AMPERSAND]) return scan_value_selector_prefix(scanner, lexer, VALUE_AMPERSAND, valid_symbols[INVALID_VALUE_DOT]);
    if (value_prefix && lexer->lookahead == '*' && valid_symbols[VALUE_ASTERISK]) return scan_value_selector_prefix(scanner, lexer, VALUE_ASTERISK, valid_symbols[INVALID_VALUE_DOT]);
    if (lexer->lookahead == '/' && valid_symbols[AT_RULE_SLASH]) {
        return scan_at_rule_slash(lexer, whitespace && valid_symbols[DESCENDANT_OP]);
    }
    return whitespace && valid_symbols[DESCENDANT_OP] && scan_descendant_operator(lexer);
}

static bool scan_value_dot(TSLexer *lexer, bool allow_invalid) {
    advance(lexer);
    lexer->mark_end(lexer);
    if (is_digit(lexer->lookahead)) return false;
    lexer->result_symbol = VALUE_DOT;
    if (!allow_invalid) return true;
    while (is_name_character(lexer->lookahead) || lexer->lookahead == '\\') {
        if (lexer->lookahead == '\\') {
            if (!scan_escape(lexer)) return true;
        } else {
            advance(lexer);
        }
    }
    return !scan_dot_following_gap(lexer) || lexer->lookahead != '{';
}

static bool scan_value_selector_prefix(Scanner *scanner, TSLexer *lexer, TSSymbol symbol, bool guard_rule) {
    TSLexerPosition position;
    lexer->get_position(lexer, &position);
    advance(lexer);
    // A name right after `*` is a legacy star-prefixed property such as `*zoom`, which the internal lexer tokenizes.
    if (symbol == VALUE_ASTERISK && (is_name_start(lexer->lookahead) || lexer->lookahead == '-')) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = symbol;
    if (!guard_rule) return true;
    if (scanner->capacity && scanner->active_cookie == scanner->cookie) {
        Memo *memo = memo_slot(scanner, position.bytes);
        if (memo->used && memo->origin == scanner->active_origin) return memo->result;
    }
    return probe_selector_boundary(scanner, lexer, position.bytes);
}

static bool probe_selector_boundary(Scanner *scanner, TSLexer *lexer, uint32_t byte) {
    unsigned depth = 0;
    scanner->prefix_count = 0;
    scanner->pending = SIZE_MAX;
    scanner->probe_origin = byte;
    record_probe_prefix(scanner, byte, 0);
    while (!lexer->eof(lexer)) {
        bool stop = false;
        if (scan_probe_component(lexer, &stop)) {
            if (stop) return remember_probe(scanner, true, UINT_MAX);
            continue;
        }
        TSLexerPosition position;
        switch (lexer->lookahead) {
            case '&': case '*':
                lexer->get_position(lexer, &position);
                record_probe_prefix(scanner, position.bytes, depth);
                break;
            case '(': case '[': depth++; break;
            case ')': case ']':
                if (!depth) return remember_probe(scanner, true, UINT_MAX);
                finish_probe_level(scanner, depth);
                depth--;
                break;
            case ';': case '}':
                if (!depth) return remember_probe(scanner, true, UINT_MAX);
                finish_probe_level(scanner, depth);
                break;
            case '{': return remember_probe(scanner, depth != 0, depth);
            default: break;
        }
        advance(lexer);
    }
    return remember_probe(scanner, true, UINT_MAX);
}

static bool scan_probe_component(TSLexer *lexer, bool *stop) {
    switch (lexer->lookahead) {
        case '\'': case '"': scan_quoted_component(lexer); return true;
        case '\\': *stop = !scan_escape(lexer); return true;
        case '/': advance(lexer); scan_comment_body(lexer); return true;
        default: return false;
    }
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

static bool remember_probe(Scanner *scanner, bool result, unsigned brace_depth) {
    if (!result) return false;
    while (scanner->pending != SIZE_MAX) {
        ProbePrefix *prefix = &scanner->prefixes[scanner->pending];
        prefix->result = prefix->depth < brace_depth;
        scanner->pending = prefix->previous;
    }
    scanner->active_cookie = scanner->cookie;
    scanner->active_origin = scanner->probe_origin;
    for (size_t i = 0; i < scanner->prefix_count; i++) {
        ProbePrefix prefix = scanner->prefixes[i];
        if (scanner->count * 2 >= scanner->capacity) grow_memo(scanner);
        Memo *memo = memo_slot(scanner, prefix.byte);
        if (!memo->used) scanner->count++;
        *memo = (Memo) {prefix.byte, scanner->active_origin, true, prefix.result};
    }
    return true;
}

static void finish_probe_level(Scanner *scanner, unsigned depth) {
    while (scanner->pending != SIZE_MAX && scanner->prefixes[scanner->pending].depth == depth) {
        ProbePrefix *prefix = &scanner->prefixes[scanner->pending];
        prefix->result = true;
        scanner->pending = prefix->previous;
    }
}

static void record_probe_prefix(Scanner *scanner, uint32_t byte, unsigned depth) {
    if (scanner->prefix_count == scanner->prefix_capacity) {
        scanner->prefix_capacity = scanner->prefix_capacity ? scanner->prefix_capacity * 2 : 64;
        scanner->prefixes = realloc(scanner->prefixes, scanner->prefix_capacity * sizeof(ProbePrefix));
    }
    scanner->prefixes[scanner->prefix_count] = (ProbePrefix) {byte, depth, scanner->pending, false};
    scanner->pending = scanner->prefix_count++;
}

static Memo *memo_slot(Scanner *scanner, uint32_t byte) {
    size_t index = (byte * UINT32_C(2654435761)) & (scanner->capacity - 1);
    while (scanner->memo[index].used && scanner->memo[index].byte != byte) index = (index + 1) & (scanner->capacity - 1);
    return &scanner->memo[index];
}

static void grow_memo(Scanner *scanner) {
    Memo *old = scanner->memo;
    size_t old_capacity = scanner->capacity;
    scanner->capacity = old_capacity ? old_capacity * 2 : 64;
    scanner->memo = calloc(scanner->capacity, sizeof(Memo));
    for (size_t i = 0; i < old_capacity; i++) {
        if (old[i].used) *memo_slot(scanner, old[i].byte) = old[i];
    }
    free(old);
}

static bool scan_dot_following_gap(TSLexer *lexer) {
    while (iswspace(lexer->lookahead) || lexer->lookahead == '/') {
        if (iswspace(lexer->lookahead)) {
            advance(lexer);
            continue;
        }
        advance(lexer);
        bool block = lexer->lookahead == '*';
        if (!scan_comment_body(lexer)) {
            if (block && lexer->eof(lexer)) {
                lexer->mark_end(lexer);
                lexer->result_symbol = INVALID_VALUE_DOT;
            }
            return false;
        }
    }
    return true;
}

static bool scan_incomplete_declaration_end(TSLexer *lexer, bool allow_descendant) {
    bool newline = false;
    bool whitespace = false;
    bool comment = false;
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
            comment = true;
        } else {
            break;
        }
    }
    bool descendant = allow_descendant && whitespace && (comment || lexer->lookahead == '#' || lexer->lookahead == '.' ||
        lexer->lookahead == '[' || lexer->lookahead == '-' || lexer->lookahead == '*' ||
        lexer->lookahead == '&' || lexer->lookahead == ':' || lexer->lookahead == '\\' || is_name_character(lexer->lookahead));
    lexer->result_symbol = DESCENDANT_OP;
    if (!newline) {
        return descendant;
    }
    bool star_property = lexer->lookahead == '*';
    if (star_property) {
        advance(lexer);
    }
    if (!(is_name_start(lexer->lookahead) || lexer->lookahead == '-' ||
        (!star_property && lexer->lookahead == '\\'))) {
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
        lexer->result_symbol = DESCENDANT_OP;
        return true;
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
