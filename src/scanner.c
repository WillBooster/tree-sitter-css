#include "tree_sitter/parser.h"
#include "tree_sitter/array.h"

#include <wctype.h>
#include <string.h>

enum TokenType {
    DESCENDANT_OP,
    ERROR_RECOVERY,
    CLASS_NAME_ESCAPE_WITH_SUFFIX,
    AT_RULE_SLASH,
    INCOMPLETE_DECLARATION_END,
    LAYER_NAME_IDENTIFIER,
    LAYER_NAME_PREFIX,
    IMPORT_SUPPORTS_START,
    IMPORT_LAYER_START,
    INVALID_IMPORT_SUPPORTS,
    INVALID_IMPORT_LAYER,
};

typedef Array(char) SupportsDelimiters;

static bool scan_import_condition_start(TSLexer *lexer, const bool *valid_symbols);
static bool scan_import_layer_body_end(TSLexer *lexer);
static void scan_invalid_import_end(TSLexer *lexer);
static bool scan_invalid_import_delimiter(TSLexer *lexer);
static bool scan_import_component_list(TSLexer *lexer, int32_t terminator);
static bool scan_import_components(TSLexer *lexer, SupportsDelimiters *delimiters, int32_t terminator);
static bool scan_import_component(TSLexer *lexer, SupportsDelimiters *delimiters, int32_t terminator, bool *component);
static bool scan_supports_body_end(TSLexer *lexer);
static bool scan_supports_word(TSLexer *lexer);
static bool scan_import_word(TSLexer *lexer, char *name, unsigned capacity, unsigned *length);
static bool scan_supports_url(TSLexer *lexer);
static bool scan_supports_string(TSLexer *lexer);
static bool scan_supports_slash(TSLexer *lexer, bool *component, bool url_allowed);
static bool is_at_rule_url_character(int32_t character);
static bool scan_layer_name_identifier(TSLexer *lexer, const bool *valid_symbols);
static bool scan_layer_name_token(TSLexer *lexer);
static bool scan_layer_name_tail(TSLexer *lexer, char *prefix, unsigned length);
static bool scan_name_character(TSLexer *lexer, int32_t *character);
static bool scan_decoded_escape(TSLexer *lexer, int32_t *decoded);
static char keyword_character(int32_t character);
static void scan_escape_terminator(TSLexer *lexer);
static bool scan_component_gap(TSLexer *lexer, bool *whitespace);
static bool is_layer_name_start(int32_t character);
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
    if (valid_symbols[IMPORT_SUPPORTS_START] || valid_symbols[IMPORT_LAYER_START]) {
        return scan_import_condition_start(lexer, valid_symbols);
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
            case ')': return scan_supports_body_end(lexer);
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
            if (character == terminator) return terminator == ';' || (component && scan_supports_body_end(lexer));
            if (character == ')' || character == ']' || character == '}' || character == ';') return false;
            if (terminator == ';' && (character == '\'' || character == '"' || character == '{')) return false;
        }
        if (!scan_import_component(lexer, delimiters, terminator, &component)) return false;
    }
    return terminator == ';' && !delimiters->size;
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

static bool scan_supports_body_end(TSLexer *lexer) {
    advance(lexer);
    bool whitespace = false;
    if (!scan_component_gap(lexer, &whitespace)) return false;
    bool start = lexer->eof(lexer) || is_name_start(lexer->lookahead) || lexer->lookahead == '-' ||
        lexer->lookahead == '\\' || lexer->lookahead == '(' || lexer->lookahead == ';';
    return start && scan_import_component_list(lexer, ';');
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
        // Mirrors grammar.js: the at_rule_url token outranks the lower-precedence js_comment extra.
        if (url_allowed && !lexer->eof(lexer) && is_at_rule_url_character(lexer->lookahead)) {
            *component = true;
            return true;
        }
        while (!lexer->eof(lexer) && lexer->lookahead != '\n' && lexer->lookahead != '\r') advance(lexer);
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

static bool is_at_rule_url_character(int32_t character) {
    switch (character) {
        case '(': case ')': case '{': case '}': case '[': case ']': case ';': case ',': case '"': case '\'': case '\\':
            return false;
        default:
            return !is_css_whitespace(character);
    }
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
    if (!(lexer->lookahead == '\\' || is_layer_name_start(lexer->lookahead))) {
        return false;
    }
    return scan_layer_name_tail(lexer, hyphen ? "-" : "", hyphen ? 1 : 0);
}

static bool scan_layer_name_tail(TSLexer *lexer, char *prefix, unsigned length) {
    char name[13] = {0};
    memcpy(name, prefix, length);
    while (is_layer_name_start(lexer->lookahead) || is_digit(lexer->lookahead) || lexer->lookahead == '-' || lexer->lookahead == '\\') {
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

static bool is_layer_name_start(int32_t character) {
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
