"""Planner theo luật từ khóa: chọn metric CERTIFIED, dimension và bộ lọc từ câu hỏi tiếng Việt."""

import re

from app.assistant.llm_adapter import DimensionInfo, MetricInfo, Plan
from app.assistant.text import fold, tokens
from app.schemas.assistant import Clarify, ClarifyOption
from app.schemas.common import Filter, OrderBy, SemanticQuery

STOPWORDS = {
    "cua", "cac", "nhung", "la", "va", "thi", "co", "khong", "bao", "nhieu", "nao", "the", "trong", "cho",
    "toi", "hay", "xin", "duoc", "ve", "tai", "den", "tu", "mot", "so", "nam", "theo", "hien", "nay", "gi",
}  # fmt: skip
# Cụm từ thường dùng → mã dimension (bổ sung cho tên dimension trong registry).
DIMENSION_HINTS = {
    "faculty": ["theo khoa", "tung khoa", "cac khoa", "moi khoa"],
    "term": ["hoc ky", "theo ky", "tung ky"],
    "academic_year": ["nam hoc", "theo nam", "tung nam"],
    "cohort": ["khoa hoc", "theo khoa k", "nien khoa"],
    "program": ["nganh", "chuong trinh"],
    "gender": ["gioi tinh"],
}
TIME_DIMENSIONS = ("term", "academic_year", "month", "year", "date")
ORG_DIMENSIONS = ("faculty", "org_unit", "department")


class RuleBasedPlanner:
    model_name = "rule-based-v1"

    def plan(
        self,
        question: str,
        metrics: list[MetricInfo],
        dimensions: list[DimensionInfo],
        org_units: dict[str, str],
        clarification: dict | None,
    ) -> Plan:
        folded = fold(question)
        words = tokens(question) - STOPWORDS
        chosen: MetricInfo | None = None
        if clarification and clarification.get("metric"):
            chosen = next((m for m in metrics if m.code == clarification["metric"]), None)
        if chosen is None:
            ranked = sorted(((self._score(m, words, folded), m) for m in metrics), key=lambda x: -x[0])
            if not ranked or ranked[0][0] == 0:
                return Plan(kind="NO_METRIC")
            best_score, chosen = ranked[0]
            close = [m for s, m in ranked[1:4] if s > 0 and s >= 0.8 * best_score]
            if close:
                options = [ClarifyOption(label=m.name, patch={"metric": m.code}) for m in [chosen, *close]]
                return Plan(kind="CLARIFY", clarify=Clarify(question="Bạn muốn hỏi về chỉ số nào?", options=options))

        allowed = set(chosen.allowed_dimensions) or {d.code for d in dimensions}
        dims = [d.code for d in dimensions if d.code in allowed and self._mentions_dimension(d, folded)]
        if clarification and isinstance(clarification.get("dimensions"), list):
            dims = [d for d in clarification["dimensions"] if d in allowed]

        filters: list[Filter] = []
        org_dim = next((d for d in ORG_DIMENSIONS if d in allowed), None)
        if org_dim:
            codes = [code for code, name in org_units.items() if re.search(rf"\b{re.escape(code.lower())}\b", folded) or (len(name) > 6 and fold(name) in folded)]
            if len(codes) == 1:
                filters.append(Filter(dimension=org_dim, op="eq", value=codes[0]))
            elif len(codes) > 1:
                filters.append(Filter(dimension=org_dim, op="in", values=codes))
        years = sorted({int(y) for y in re.findall(r"\b(20\d{2})\b", folded)})
        if years and "academic_year" in allowed:
            values = sorted({f"{y - 1}-{y}" for y in years} | {f"{y}-{y + 1}" for y in years})
            filters.append(Filter(dimension="academic_year", op="in", values=values))
        if clarification and isinstance(clarification.get("filters"), list):
            filters = [Filter.model_validate(f) for f in clarification["filters"]]

        order = [OrderBy(field=d, direction="asc") for d in dims if d in TIME_DIMENSIONS]
        if not order and dims:
            order = [OrderBy(field=chosen.code, direction="desc")]
        query = SemanticQuery(metrics=[chosen.code], dimensions=dims, filters=filters, order_by=order, limit=500)
        return Plan(kind="QUERY", query=query)

    @staticmethod
    def _score(metric: MetricInfo, words: set[str], folded: str) -> float:
        name_tokens = tokens(metric.name) - STOPWORDS
        code_tokens = set(metric.code.split("_")) - STOPWORDS
        def_tokens = tokens(metric.definition) - STOPWORDS
        score = 2.0 * len(words & name_tokens) + 1.0 * len(words & code_tokens) + 0.5 * len(words & def_tokens)
        if fold(metric.name) in folded:
            score += 3
        return score

    @staticmethod
    def _mentions_dimension(dim: DimensionInfo, folded: str) -> bool:
        name = fold(dim.name)
        if f"theo {name}" in folded or (len(name) > 4 and name in folded) or dim.code.replace("_", " ") in folded:
            return True
        return any(hint in folded for hint in DIMENSION_HINTS.get(dim.code, []))
