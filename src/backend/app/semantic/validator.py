"""Kiểm tra biểu thức SQL do người dùng nhập (công thức metric, phép biến đổi mapping).

Biểu thức được ghép vào SQL Trino nên chỉ chấp nhận tập token đã liệt kê: tên cột của dataset,
hàm trong danh sách cho phép, số, chuỗi '...', toán tử. Mọi thứ khác (dấu ;, chú thích, định danh
trong ngoặc kép, tên bảng, từ khóa SELECT/FROM...) đều bị từ chối.
"""

import re

AGGREGATES = {"sum", "count", "avg", "min", "max", "approx_distinct", "count_if", "stddev", "variance"}
SCALAR_FUNCTIONS = {
    "nullif", "coalesce", "round", "abs", "floor", "ceil", "greatest", "least", "cast", "try_cast",
    "lower", "upper", "trim", "length", "substr", "replace", "concat", "to_date", "date", "year", "month",
    "day", "date_trunc", "date_parse", "if",
}  # fmt: skip
KEYWORDS = {
    "case", "when", "then", "else", "end", "and", "or", "not", "is", "null", "in", "between", "distinct",
    "true", "false", "as", "like", "double", "integer", "bigint", "varchar", "decimal", "timestamp",
}  # fmt: skip

_TOKEN = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<number>\d+(\.\d+)?)
  | (?P<string>'(?:[^']|'')*')
  | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<op><>|<=|>=|!=|\|\||[-+*/%(),=<>.])
    """,
    re.VERBOSE,
)


def validate_expression(
    expression: str, columns: set[str], *, allow_aggregates: bool, max_length: int = 2000
) -> list[str]:
    errors: list[str] = []
    if not expression.strip():
        return ["Biểu thức rỗng"]
    if len(expression) > max_length:
        return [f"Biểu thức dài quá {max_length} ký tự"]
    allowed_functions = SCALAR_FUNCTIONS | (AGGREGATES if allow_aggregates else set())
    lowered_columns = {c.lower() for c in columns}

    pos, depth, has_aggregate = 0, 0, False
    tokens: list[tuple[str, str]] = []
    while pos < len(expression):
        match = _TOKEN.match(expression, pos)
        if not match:
            errors.append(f"Ký tự không được phép tại vị trí {pos + 1}: {expression[pos]!r}")
            return errors
        pos = match.end()
        kind = match.lastgroup
        if kind == "ws":
            continue
        tokens.append((kind, match.group()))

    for i, (kind, value) in enumerate(tokens):
        if kind == "op":
            if value == "(":
                depth += 1
            elif value == ")":
                depth -= 1
                if depth < 0:
                    errors.append("Thừa dấu ')'")
                    return errors
            elif value == ".":
                errors.append("Không dùng tên bảng/schema trong biểu thức, chỉ dùng tên cột")
        elif kind == "ident":
            name = value.lower()
            is_call = i + 1 < len(tokens) and tokens[i + 1] == ("op", "(")
            if is_call:
                if name not in allowed_functions:
                    errors.append(f"Hàm không được phép: {value}")
                has_aggregate |= name in AGGREGATES
            elif name not in KEYWORDS and name not in lowered_columns:
                errors.append(f"Cột không tồn tại trong dataset: {value}")
    if depth != 0:
        errors.append("Thiếu dấu ')'")
    if allow_aggregates and not has_aggregate and not errors:
        errors.append("Công thức metric phải có hàm tổng hợp (sum, count, avg...)")
    return errors
