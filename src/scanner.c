#include "tree_sitter/parser.h"
#include "tree_sitter/array.h"

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
    LAYER_NAME_IDENTIFIER,
    LAYER_NAME_PREFIX,
    IMPORT_SUPPORTS_START,
    IMPORT_LAYER_START,
    INVALID_IMPORT_SUPPORTS,
    INVALID_IMPORT_LAYER,
    HASH_SLASH_TAIL,
    OPERATOR_GAP,
    COMBINATOR_GAP,
    BINARY_ASTERISK,
};

typedef Array(char) SupportsDelimiters;

static bool scan_rule_gap(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols);
static bool scan_import_condition_start(TSLexer *lexer, const bool *valid_symbols);
static bool scan_import_layer_body_end(TSLexer *lexer);
static void scan_invalid_import_end(TSLexer *lexer);
static bool scan_invalid_import_delimiter(TSLexer *lexer);
static bool scan_import_component_list(TSLexer *lexer, int32_t terminator);
static bool scan_import_components(TSLexer *lexer, SupportsDelimiters *delimiters, int32_t terminator);
static bool is_import_components_end(int32_t character, int32_t terminator);
static bool scan_import_component(TSLexer *lexer, SupportsDelimiters *delimiters, int32_t terminator, bool *component);
static bool scan_supports_body_end(TSLexer *lexer, bool supports_allowed);
static bool scan_layer_tail(TSLexer *lexer);
static bool is_import_tail_start(int32_t character);
static bool scan_supports_word(TSLexer *lexer);
static bool scan_import_word(TSLexer *lexer, char *name, unsigned capacity, unsigned *length);
static bool scan_supports_url(TSLexer *lexer);
static bool scan_supports_string(TSLexer *lexer);
static bool scan_supports_slash(TSLexer *lexer, bool *component, bool url_allowed);
static bool scan_double_slash(TSLexer *lexer, bool url_allowed);
static bool is_at_rule_url_character(int32_t character);
static bool is_regex_whitespace(int32_t character);
static bool scan_layer_name_identifier(TSLexer *lexer, const bool *valid_symbols);
static bool scan_layer_name_token(TSLexer *lexer);
static bool scan_layer_name_tail(TSLexer *lexer, char *prefix, unsigned length);
static bool scan_name_character(TSLexer *lexer, int32_t *character);
static bool scan_decoded_escape(TSLexer *lexer, int32_t *decoded);
static char keyword_character(int32_t character);
static void scan_escape_terminator(TSLexer *lexer);
static bool scan_component_gap(TSLexer *lexer, bool *whitespace);
static bool is_css_whitespace(int32_t character);
static bool scan_value_dot(TSLexer *lexer, bool allow_invalid);
static bool scan_value_selector_prefix(Scanner *scanner, TSLexer *lexer, TSSymbol symbol, bool guard_rule, bool binary_allowed);
static bool probe_selector_boundary(Scanner *scanner, TSLexer *lexer, uint32_t byte, bool witness);
static bool scan_probe_component(TSLexer *lexer, bool *stop);
static void scan_quoted_component(TSLexer *lexer);
static bool remember_probe(Scanner *scanner, bool result, unsigned brace_depth, bool witness);
static void finish_probe_level(Scanner *scanner, unsigned depth);
static void record_probe_prefix(Scanner *scanner, uint32_t byte, unsigned depth);
static Memo *memo_slot(Scanner *scanner, uint32_t byte);
static void grow_memo(Scanner *scanner);
static bool scan_dot_following_gap(TSLexer *lexer);
static bool scan_hash_slash_tail(TSLexer *lexer, const bool *valid_symbols);
static bool scan_incomplete_declaration_end(TSLexer *lexer, const bool *valid_symbols);
static bool finish_incomplete_declaration_end(TSLexer *lexer, const bool *valid_symbols, bool comment);
static bool scan_explicit_combinator(TSLexer *lexer);
static bool scan_gap_operator(TSLexer *lexer, int32_t first, bool allow_gap, bool comment, bool *consumed, bool *spaced);
static bool scan_property_start(TSLexer *lexer, int32_t first, bool first_consumed);
static bool scan_property_colon(TSLexer *lexer);
static bool scan_separator_comment(TSLexer *lexer);
static bool scan_comment_body(TSLexer *lexer);
static bool scan_at_rule_slash(TSLexer *lexer, bool allow_descendant, bool allow_combinator);
static bool scan_escape(TSLexer *lexer);
static bool scan_descendant_operator(TSLexer *lexer, bool allow_descendant, bool allow_gap);
static bool scan_operator_gap(TSLexer *lexer, bool allow_gap, bool *spaced);
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
    if (valid_symbols[IMPORT_SUPPORTS_START] || valid_symbols[IMPORT_LAYER_START]) {
        return scan_import_condition_start(lexer, valid_symbols);
    }
    if (valid_symbols[LAYER_NAME_IDENTIFIER] || valid_symbols[LAYER_NAME_PREFIX]) {
        return scan_layer_name_identifier(lexer, valid_symbols);
    }
    if (valid_symbols[VALUE_AMPERSAND] && lexer->lookahead == '&') return scan_value_selector_prefix(scanner, lexer, VALUE_AMPERSAND, valid_symbols[INVALID_VALUE_DOT], false);
    if (valid_symbols[VALUE_ASTERISK] && lexer->lookahead == '*') return scan_value_selector_prefix(scanner, lexer, VALUE_ASTERISK, valid_symbols[INVALID_VALUE_DOT], valid_symbols[BINARY_ASTERISK]);
    if (valid_symbols[VALUE_DOT] && lexer->lookahead == '.') return scan_value_dot(lexer, valid_symbols[INVALID_VALUE_DOT]);
    if (valid_symbols[HASH_SLASH_TAIL] && !valid_symbols[AT_RULE_SLASH] && lexer->lookahead == '/') {
        return scan_hash_slash_tail(lexer, valid_symbols);
    }
    if (valid_symbols[INCOMPLETE_DECLARATION_END] && !valid_symbols[AT_RULE_SLASH] &&
        (iswspace(lexer->lookahead) || lexer->lookahead == '/')) {
        return scan_incomplete_declaration_end(lexer, valid_symbols);
    }
    if (valid_symbols[AT_RULE_SLASH] || (iswspace(lexer->lookahead) &&
        (valid_symbols[DESCENDANT_OP] || valid_symbols[OPERATOR_GAP] || valid_symbols[VALUE_DOT] ||
            valid_symbols[VALUE_AMPERSAND] || valid_symbols[VALUE_ASTERISK]))) {
        return scan_rule_gap(scanner, lexer, valid_symbols);
    }
    return false;
}

static bool scan_import_condition_start(TSLexer *lexer, const bool *valid_symbols) {
    while (is_css_whitespace(lexer->lookahead)) skip(lexer);
    char name[9] = {0};
    unsigned length = 0;
    if (!scan_import_word(lexer, name, sizeof(name), &length)) return false;
    bool layer = length == 5 && valid_symbols[IMPORT_LAYER_START] && !strcmp(name, "layer");
    bool supports = length == 8 && valid_symbols[IMPORT_SUPPORTS_START] && !strcmp(name, "supports");
    if ((!layer && !supports) || lexer->lookahead != '(') return false;
    advance(lexer);
    lexer->mark_end(lexer);
    lexer->result_symbol = layer ? IMPORT_LAYER_START : IMPORT_SUPPORTS_START;
    if (layer ? scan_import_layer_body_end(lexer) : scan_import_component_list(lexer, ')')) return true;
    scan_invalid_import_end(lexer);
    lexer->result_symbol = layer ? INVALID_IMPORT_LAYER : INVALID_IMPORT_SUPPORTS;
    return true;
}

static void scan_invalid_import_end(TSLexer *lexer) {
    if (lexer->lookahead == '\'' || lexer->lookahead == '"') scan_supports_string(lexer);
    lexer->mark_end(lexer);
    for (;;) {
        bool whitespace = false;
        if (!scan_component_gap(lexer, &whitespace)) {
            lexer->mark_end(lexer);
            if (lexer->eof(lexer)) return;
            continue;
        }
        lexer->mark_end(lexer);
        if (!scan_invalid_import_delimiter(lexer)) return;
        lexer->mark_end(lexer);
    }
}

static bool scan_invalid_import_delimiter(TSLexer *lexer) {
    if (lexer->lookahead == '[') {
        advance(lexer);
        return lexer->lookahead == '[' || lexer->lookahead == ']' ||
            lexer->lookahead == ')' || lexer->lookahead == ';';
    }
    if (lexer->lookahead != ')' && lexer->lookahead != ';' && lexer->lookahead != ']') return false;
    advance(lexer);
    return true;
}

static bool scan_import_layer_body_end(TSLexer *lexer) {
    for (;;) {
        bool whitespace = false;
        if (!scan_component_gap(lexer, &whitespace)) return false;
        if (lexer->eof(lexer)) return false;
        switch (lexer->lookahead) {
            case ')': return scan_supports_body_end(lexer, true);
            case '\'': case '"': return false;
            case ';': case '{': case '}': return true;
            default: {
                int32_t character;
                if (!scan_name_character(lexer, &character)) return false;
            }
        }
    }
}

static bool scan_import_component_list(TSLexer *lexer, int32_t terminator) {
    SupportsDelimiters delimiters = array_new();
    bool valid = scan_import_components(lexer, &delimiters, terminator);
    array_delete(&delimiters);
    return valid;
}

static bool scan_import_components(TSLexer *lexer, SupportsDelimiters *delimiters, int32_t terminator) {
    bool component = false;
    while (!lexer->eof(lexer)) {
        int32_t character = lexer->lookahead;
        if (!delimiters->size) {
            if (is_import_components_end(character, terminator)) {
                return terminator == ';' || (component && scan_supports_body_end(lexer, false));
            }
            if (character == ')' || character == ']' || character == '}' || character == ';') return false;
            if (terminator == ';' && (character == '\'' || character == '"')) return false;
        }
        if (!scan_import_component(lexer, delimiters, terminator, &component)) return false;
    }
    return terminator == ';' && !delimiters->size;
}

static bool is_import_components_end(int32_t character, int32_t terminator) {
    // A rule, at-rule or block end after an import missing its `;` ends the tail, as it does without a condition.
    bool statement_boundary = character == '{' || character == '@' || character == '}';
    return character == terminator || (terminator == ';' && statement_boundary);
}

static bool scan_import_component(TSLexer *lexer, SupportsDelimiters *delimiters, int32_t terminator, bool *component) {
    int32_t character = lexer->lookahead;
    if (is_css_whitespace(character)) { advance(lexer); return true; }
    // Outside parentheses the media tail has no at_rule_url, so `//` there always starts a js_comment.
    if (character == '/') return scan_supports_slash(lexer, component, delimiters->size || terminator != ';');
    *component = true;
    if (character == '\'' || character == '"') return scan_supports_string(lexer);
    if (is_name_character(character) || character >= 0x80 || character == '\\' || character == '#' || character == '@') {
        return scan_supports_word(lexer);
    }
    switch (character) {
        case ')': case ']': case '}':
            if (!delimiters->size || array_pop(delimiters) != character) return false;
            break;
        case '(': array_push(delimiters, ')'); break;
        case '[': array_push(delimiters, ']'); break;
        case '{': array_push(delimiters, '}'); break;
    }
    advance(lexer);
    return true;
}

static bool scan_supports_body_end(TSLexer *lexer, bool supports_allowed) {
    advance(lexer);
    bool whitespace = false;
    if (!scan_component_gap(lexer, &whitespace)) return false;
    if (!lexer->eof(lexer) && !is_import_tail_start(lexer->lookahead)) return false;
    return supports_allowed ? scan_layer_tail(lexer) : scan_import_component_list(lexer, ';');
}

// Besides media queries, a tail may start the rule, at-rule or block end that follows an import missing its `;`. `[`
// and quotes are excluded so that malformed attribute selectors and quoted conditions recover as invalid fragments.
static bool is_import_tail_start(int32_t character) {
    switch (character) {
        case '-': case '\\': case '(': case ';': case '.': case '#': case ':': case '*': case '@': case '}':
            return true;
        default:
            return is_name_start(character);
    }
}

// Scans a supports() after a layer with the body rules of a direct supports() lookahead, so a malformed body recovers
// at the same position with or without a preceding layer.
static bool scan_layer_tail(TSLexer *lexer) {
    char name[9] = {0};
    unsigned length = 0;
    if (!scan_import_word(lexer, name, sizeof(name), &length)) return false;
    if (lexer->lookahead == '(' && length == 8 && !strcmp(name, "supports")) {
        advance(lexer);
        return scan_import_component_list(lexer, ')');
    }
    if (lexer->lookahead == '(' && length == 3 && !strcmp(name, "url") && !scan_supports_url(lexer)) return false;
    return scan_import_component_list(lexer, ';');
}

static bool scan_supports_word(TSLexer *lexer) {
    char name[4] = {0};
    unsigned length = 0;
    bool prefixed = lexer->lookahead == '#' || lexer->lookahead == '@';
    if (prefixed) advance(lexer);
    if (!scan_import_word(lexer, name, sizeof(name), &length)) return false;
    if (!prefixed && length == 3 && !strcmp(name, "url") && lexer->lookahead == '(') {
        return scan_supports_url(lexer);
    }
    return true;
}

static bool scan_import_word(TSLexer *lexer, char *name, unsigned capacity, unsigned *length) {
    while (is_name_character(lexer->lookahead) || lexer->lookahead >= 0x80 || lexer->lookahead == '\\') {
        int32_t character;
        if (!scan_name_character(lexer, &character)) return false;
        if (*length < capacity - 1) name[*length] = keyword_character(character);
        (*length)++;
    }
    return true;
}

static bool scan_supports_url(TSLexer *lexer) {
    advance(lexer);
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == '\\') {
            if (!scan_escape(lexer)) return false;
        } else if (lexer->lookahead == '\'' || lexer->lookahead == '"') {
            if (!scan_supports_string(lexer)) return false;
        } else if (lexer->lookahead == ')') {
            advance(lexer);
            return true;
        } else {
            advance(lexer);
        }
    }
    return false;
}

static bool scan_supports_string(TSLexer *lexer) {
    int32_t quote = lexer->lookahead;
    advance(lexer);
    while (!lexer->eof(lexer)) {
        int32_t character = lexer->lookahead;
        if (character == '\n' || character == '\r' || character == '\f') return false;
        advance(lexer);
        if (character == quote) return true;
        if (character == '\\' && !lexer->eof(lexer)) {
            bool carriage_return = lexer->lookahead == '\r';
            advance(lexer);
            if (carriage_return && lexer->lookahead == '\n') advance(lexer);
        }
    }
    return false;
}

static bool scan_supports_slash(TSLexer *lexer, bool *component, bool url_allowed) {
    advance(lexer);
    if (lexer->lookahead == '/') {
        advance(lexer);
        if (scan_double_slash(lexer, url_allowed)) *component = true;
        return true;
    }
    if (lexer->lookahead != '*') { *component = true; return true; }
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

static bool scan_double_slash(TSLexer *lexer, bool url_allowed) {
    // Mirrors grammar.js: the at_rule_url token outranks the lower-precedence js_comment extra.
    bool url = url_allowed && !lexer->eof(lexer) && is_at_rule_url_character(lexer->lookahead);
    while (!lexer->eof(lexer)) {
        bool line_end = lexer->lookahead == '\n' || lexer->lookahead == '\r';
        bool inside = url ? is_at_rule_url_character(lexer->lookahead) : !line_end;
        if (!inside) break;
        advance(lexer);
    }
    return url;
}

static bool is_at_rule_url_character(int32_t character) {
    switch (character) {
        case '(': case ')': case '{': case '}': case '[': case ']': case ';': case ',': case '"': case '\'': case '\\':
            return false;
        default:
            return !is_regex_whitespace(character);
    }
}

// The generated lexer matches the `\s` that grammar.js excludes from at_rule_url as ASCII whitespace only, which
// includes the vertical tab that CSS does not treat as whitespace.
static bool is_regex_whitespace(int32_t character) {
    return (character >= '\t' && character <= '\r') || character == ' ';
}

static bool scan_layer_name_identifier(TSLexer *lexer, const bool *valid_symbols) {
    while (is_css_whitespace(lexer->lookahead)) skip(lexer);
    if (!scan_layer_name_token(lexer)) {
        return false;
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = LAYER_NAME_IDENTIFIER;
    bool whitespace = false;
    if (scan_component_gap(lexer, &whitespace) && lexer->lookahead == '.' && !whitespace) {
        advance(lexer);
        if (scan_component_gap(lexer, &whitespace) && !whitespace && scan_layer_name_token(lexer)) {
            lexer->result_symbol = LAYER_NAME_PREFIX;
        }
    }
    return valid_symbols[lexer->result_symbol];
}

static bool scan_layer_name_token(TSLexer *lexer) {
    bool hyphen = lexer->lookahead == '-';
    if (lexer->lookahead == '-') {
        advance(lexer);
        if (lexer->lookahead == '-') {
            advance(lexer);
            return scan_layer_name_tail(lexer, "--", 2);
        }
    }
    if (!(lexer->lookahead == '\\' || is_name_start(lexer->lookahead))) {
        return false;
    }
    return scan_layer_name_tail(lexer, hyphen ? "-" : "", hyphen ? 1 : 0);
}

static bool scan_layer_name_tail(TSLexer *lexer, char *prefix, unsigned length) {
    char name[13] = {0};
    memcpy(name, prefix, length);
    while (is_name_start(lexer->lookahead) || is_digit(lexer->lookahead) || lexer->lookahead == '-' || lexer->lookahead == '\\') {
        int32_t character;
        if (!scan_name_character(lexer, &character)) return false;
        if (length < sizeof(name) - 1) {
            name[length] = keyword_character(character);
        }
        length++;
    }
    if (length >= sizeof(name)) return true;
    return strcmp(name, "initial") && strcmp(name, "inherit") && strcmp(name, "unset") &&
        strcmp(name, "revert") && strcmp(name, "revert-layer") && strcmp(name, "revert-rule");
}

static bool scan_name_character(TSLexer *lexer, int32_t *character) {
    *character = lexer->lookahead;
    if (*character == '\\') return scan_decoded_escape(lexer, character);
    advance(lexer);
    return true;
}

static char keyword_character(int32_t character) {
    if (character >= 'A' && character <= 'Z') return (char)(character + 'a' - 'A');
    return character < 0x80 ? (char)character : '?';
}

static bool scan_component_gap(TSLexer *lexer, bool *whitespace) {
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
    if (value_prefix && lexer->lookahead == '&' && valid_symbols[VALUE_AMPERSAND]) return scan_value_selector_prefix(scanner, lexer, VALUE_AMPERSAND, valid_symbols[INVALID_VALUE_DOT], false);
    if (value_prefix && lexer->lookahead == '*' && valid_symbols[VALUE_ASTERISK]) return scan_value_selector_prefix(scanner, lexer, VALUE_ASTERISK, valid_symbols[INVALID_VALUE_DOT], valid_symbols[BINARY_ASTERISK]);
    if (lexer->lookahead == '/' && valid_symbols[AT_RULE_SLASH]) {
        return scan_at_rule_slash(lexer, whitespace && valid_symbols[DESCENDANT_OP], valid_symbols[COMBINATOR_GAP]);
    }
    return whitespace && (valid_symbols[DESCENDANT_OP] || valid_symbols[OPERATOR_GAP]) &&
        scan_descendant_operator(lexer, valid_symbols[DESCENDANT_OP], valid_symbols[OPERATOR_GAP]);
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

static bool scan_value_selector_prefix(Scanner *scanner, TSLexer *lexer, TSSymbol symbol, bool guard_rule, bool binary_allowed) {
    TSLexerPosition position;
    lexer->get_position(lexer, &position);
    advance(lexer);
    // Outside values, a name right after `*` is a legacy star-prefixed property such as `*zoom`, which the internal
    // lexer tokenizes.
    if (symbol == VALUE_ASTERISK && !guard_rule && (is_name_start(lexer->lookahead) || lexer->lookahead == '-')) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = symbol;
    if (!guard_rule) return true;
    Memo *memo = NULL;
    if (scanner->capacity && scanner->active_cookie == scanner->cookie) {
        memo = memo_slot(scanner, position.bytes);
    }
    bool result = memo && memo->used && memo->origin == scanner->active_origin
        ? memo->result : probe_selector_boundary(scanner, lexer, position.bytes, binary_allowed);
    lexer->result_symbol = result ? symbol : BINARY_ASTERISK;
    return result || binary_allowed;
}

static bool probe_selector_boundary(Scanner *scanner, TSLexer *lexer, uint32_t byte, bool witness) {
    unsigned depth = 0;
    scanner->prefix_count = 0;
    scanner->pending = SIZE_MAX;
    scanner->probe_origin = byte;
    record_probe_prefix(scanner, byte, 0);
    while (!lexer->eof(lexer)) {
        bool stop = false;
        if (scan_probe_component(lexer, &stop)) {
            if (stop) return remember_probe(scanner, true, UINT_MAX, witness);
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
                if (!depth) return remember_probe(scanner, true, UINT_MAX, witness);
                finish_probe_level(scanner, depth);
                depth--;
                break;
            case ';': case '}':
                if (!depth) return remember_probe(scanner, true, UINT_MAX, witness);
                finish_probe_level(scanner, depth);
                break;
            case '{': return remember_probe(scanner, depth != 0, depth, witness);
            default: break;
        }
        advance(lexer);
    }
    return remember_probe(scanner, true, UINT_MAX, witness);
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

static bool remember_probe(Scanner *scanner, bool result, unsigned brace_depth, bool witness) {
    if (!result && !witness) return false;
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
    return result;
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

// A run of two or more slashes attached to a hash is delimiter components rather than a line comment, as it is inside
// a plain value, but a slash followed by `*` opens a block comment, so the run ends before it. A lone slash leaves the
// position to the incomplete-declaration scan it would otherwise reach.
static bool scan_hash_slash_tail(TSLexer *lexer, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    advance(lexer);
    if (lexer->lookahead != '/') {
        return valid_symbols[INCOMPLETE_DECLARATION_END] && scan_comment_body(lexer) &&
            finish_incomplete_declaration_end(lexer, valid_symbols, true);
    }
    lexer->mark_end(lexer);
    while (lexer->lookahead == '/') {
        advance(lexer);
        if (lexer->lookahead == '*') break;
        lexer->mark_end(lexer);
    }
    lexer->result_symbol = HASH_SLASH_TAIL;
    return true;
}

static bool scan_incomplete_declaration_end(TSLexer *lexer, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    return finish_incomplete_declaration_end(lexer, valid_symbols, false);
}

static bool finish_incomplete_declaration_end(TSLexer *lexer, const bool *valid_symbols, bool comment) {
    bool allow_descendant = valid_symbols[DESCENDANT_OP];
    bool allow_gap = valid_symbols[OPERATOR_GAP];
    bool newline = false;
    bool whitespace = false;
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
    int32_t first = lexer->lookahead;
    // A descendant gap here would let the combinator start a relative selector nested in a descendant selector.
    if (comment && whitespace && valid_symbols[COMBINATOR_GAP] && scan_explicit_combinator(lexer)) {
        lexer->result_symbol = COMBINATOR_GAP;
        return true;
    }
    bool descendant = allow_descendant && whitespace && (comment || first == '#' || first == '.' ||
        first == '[' || first == '-' || first == '*' ||
        first == '&' || first == ':' || first == '\\' || is_name_character(first));
    lexer->result_symbol = DESCENDANT_OP;
    bool consumed = false;
    bool spaced = false;
    if (whitespace && scan_gap_operator(lexer, first, allow_gap, comment, &consumed, &spaced)) {
        return true;
    }
    if (newline && !spaced && scan_property_start(lexer, first, consumed)) {
        lexer->result_symbol = INCOMPLETE_DECLARATION_END;
        return true;
    }
    return descendant;
}

// Called only after whitespace: a gap glued to the preceding component, as in `a/**/+b`, keeps `+` an adjacent-sibling
// combinator instead of a descendant gap before a relative selector.
// `first` is the character after the gap; a rejected combinator scan may already have advanced past it.
static bool scan_gap_operator(TSLexer *lexer, int32_t first, bool allow_gap, bool comment, bool *consumed, bool *spaced) {
    // A spaced gap containing a comment otherwise ends as a descendant combinator, which pseudo arithmetic such as
    // `1 /* c */ + 2` cannot take before its operator.
    if (allow_gap && comment && (first == '+' || first == '/')) {
        lexer->result_symbol = OPERATOR_GAP;
        return true;
    }
    *consumed = first == '*' || first == '-';
    return *consumed && scan_operator_gap(lexer, allow_gap, spaced);
}

static bool scan_property_start(TSLexer *lexer, int32_t first, bool first_consumed) {
    bool star_property = first == '*';
    if (star_property && !first_consumed) {
        advance(lexer);
    }
    // A consumed hyphen is the first name character.
    bool name_start = (first_consumed && first == '-') || is_name_start(lexer->lookahead) ||
        lexer->lookahead == '-' || (!star_property && lexer->lookahead == '\\');
    return name_start && scan_property_colon(lexer);
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

static bool scan_at_rule_slash(TSLexer *lexer, bool allow_descendant, bool allow_combinator) {
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
        lexer->result_symbol = allow_combinator && scan_explicit_combinator(lexer) ? COMBINATOR_GAP : DESCENDANT_OP;
        return true;
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = AT_RULE_SLASH;
    return true;
}

// Called where the gap token is zero-width, so it may advance past the combinator to reject the `~=` attribute operator.
static bool scan_explicit_combinator(TSLexer *lexer) {
    int32_t combinator = lexer->lookahead;
    if (combinator != '>' && combinator != '~' && combinator != '+') return false;
    advance(lexer);
    return lexer->lookahead != '=';
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

static bool scan_descendant_operator(TSLexer *lexer, bool allow_descendant, bool allow_gap) {
    lexer->result_symbol = DESCENDANT_OP;
    if (lexer->lookahead == '*' || lexer->lookahead == '-') {
        bool spaced = false;
        return scan_operator_gap(lexer, allow_gap, &spaced) || allow_descendant;
    }
    if (!allow_descendant) return false;
    if (lexer->lookahead == '#' || lexer->lookahead == '.' || lexer->lookahead == '[' ||
        lexer->lookahead == '&' || lexer->lookahead == '\\' || is_name_character(lexer->lookahead)) {
        return true;
    }
    return lexer->lookahead == ':';
}

// A gap before a spaced `*` or `-` gets its own token, which selectors accept as a descendant combinator and pseudo
// arithmetic accepts before its operator. Only these gaps fork the binary interpretation: forking it at every
// descendant gap made each failing fork fall back to error-mode lexing, which skips the whole remaining name run.
static bool scan_operator_gap(TSLexer *lexer, bool allow_gap, bool *spaced) {
    advance(lexer);
    *spaced = is_css_whitespace(lexer->lookahead);
    if (!allow_gap || !*spaced) {
        return false;
    }
    lexer->result_symbol = OPERATOR_GAP;
    return true;
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
