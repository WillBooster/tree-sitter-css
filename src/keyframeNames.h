#ifndef TREE_SITTER_CSS_KEYFRAME_NAMES_H_
#define TREE_SITTER_CSS_KEYFRAME_NAMES_H_

#include "lexer.h"
#include <string.h>

static bool scan_keyframes_identifier(TSLexer *lexer);
static bool scan_keyframes_identifier_prefix(TSLexer *lexer, bool *hyphen);
static bool scan_keyframes_string(TSLexer *lexer);
static bool scan_keyframes_string_escape(TSLexer *lexer, bool *content);
static int32_t keyframes_name_character(TSLexer *lexer);

static bool scan_keyframes_name(TSLexer *lexer) {
    while (is_regex_whitespace(lexer->lookahead)) skip(lexer);
    if (lexer->lookahead == '\'' || lexer->lookahead == '"') return scan_keyframes_string(lexer);
    return scan_keyframes_identifier(lexer);
}

static bool scan_keyframes_identifier(TSLexer *lexer) {
    char name[sizeof("revert-layer") + 1] = {0};
    unsigned length = 0;
    bool hyphen;
    if (!scan_keyframes_identifier_prefix(lexer, &hyphen)) return false;
    while (is_name_character(keyframes_name_character(lexer)) || lexer->lookahead == '\\') {
        int32_t character = keyframes_name_character(lexer);
        if (character == '\\') {
            if (!scan_decoded_escape(lexer, &character)) return false;
        } else {
            advance(lexer);
        }
        if (length < sizeof(name) - 1) name[length++] = keyword_character(character);
    }
    return hyphen || (strcmp(name, "none") && strcmp(name, "default") && strcmp(name, "initial") &&
        strcmp(name, "inherit") && strcmp(name, "unset") && strcmp(name, "revert") &&
        strcmp(name, "revert-layer") && strcmp(name, "revert-rule"));
}

static bool scan_keyframes_identifier_prefix(TSLexer *lexer, bool *hyphen) {
    *hyphen = lexer->lookahead == '-';
    if (*hyphen) advance(lexer);
    return lexer->lookahead == '\\' || is_name_start(keyframes_name_character(lexer)) || (*hyphen && lexer->lookahead == '-');
}

static bool scan_keyframes_string(TSLexer *lexer) {
    int32_t quote = lexer->lookahead;
    advance(lexer);
    bool content = false;
    while (!lexer->eof(lexer)) {
        if (lexer->lookahead == quote) {
            advance(lexer);
            return content;
        }
        if (lexer->lookahead == '\n' || lexer->lookahead == '\r' || lexer->lookahead == '\f') return false;
        if (lexer->lookahead == '\\') {
            if (!scan_keyframes_string_escape(lexer, &content)) return false;
        } else {
            advance(lexer);
            content = true;
        }
    }
    return false;
}

static bool scan_keyframes_string_escape(TSLexer *lexer, bool *content) {
    if (scan_decoded_escape(lexer, NULL)) {
        *content = true;
        return true;
    }
    int32_t newline = lexer->lookahead;
    if (newline != '\n' && newline != '\r' && newline != '\f') return false;
    advance(lexer);
    if (newline == '\r' && lexer->lookahead == '\n') advance(lexer);
    return true;
}

static int32_t keyframes_name_character(TSLexer *lexer) {
    return lexer->lookahead == 0 && !lexer->eof(lexer) ? 0xFFFD : lexer->lookahead;
}

#endif
