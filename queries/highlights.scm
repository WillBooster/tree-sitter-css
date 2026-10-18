(comment) @comment

(tag_name) @tag
(nesting_selector) @tag
(universal_selector) @tag

"~" @operator
">" @operator
"<" @operator
">=" @operator
"<=" @operator
"+" @operator
"-" @operator
"*" @operator
"/" @operator
"=" @operator
"^=" @operator
"|=" @operator
"~=" @operator
"$=" @operator
"*=" @operator

"and" @operator
"or" @operator
"not" @operator
"only" @operator

(attribute_selector (plain_value) @string)
(pseudo_element_selector (tag_name) @attribute)
(pseudo_class_selector (class_name) @attribute)

(class_name) @property
(id_name) @property
(namespace_name) @property
(property_name) @property
(feature_name) @property

(attribute_name) @attribute
(attribute_selector (attribute_flag) @keyword)

(function_name) @function

((property_name) @variable
 (#match? @variable "^--"))
((plain_value) @variable
 (#match? @variable "^--"))

"@media" @keyword
"@import" @keyword
"@charset" @keyword
"@namespace" @keyword
"@supports" @keyword
"@keyframes" @keyword
(at_keyword) @keyword
(to) @keyword
(from) @keyword
(important) @keyword

(string_value) @string
(color_value) @string.special

(integer_value) @number
(float_value) @number
(unit) @type

"#" @punctuation.delimiter
"," @punctuation.delimiter
":" @punctuation.delimiter

[(at_rule_url) (url_value)] @string.special
(at_rule_delimiter) @punctuation.delimiter

((at_rule_value) @variable
 (#match? @variable "^--"))

((at_rule_value) @number
 (#match? @number "^[+-]?([0-9]+(\\.[0-9]+)?|\\.[0-9]+)([eE][+-]?[0-9]+)?([a-zA-Z]+|%)?$"))

(at_rule_parenthesized
 (at_rule_value) @property
 . (at_rule_delimiter) @_colon
 . (_) @_feature_value
 (#eq? @_colon ":")
 (#not-match? @_feature_value "^//")
 (#match? @property "^-?[_a-zA-Z][_a-zA-Z0-9-]*$"))

(
 (at_rule_value) @_bang @keyword
 . (at_rule_value) @_important @keyword
 (#eq? @_bang "!")
 (#match? @_important "^[iI][mM][pP][oO][rR][tT][aA][nN][tT]$"))
