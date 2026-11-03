"""Giao diện giữa trợ lý và mô hình ngôn ngữ.

Trợ lý không cho mô hình sinh SQL: mô hình chỉ đề xuất SemanticQuery trên danh mục metric
CERTIFIED (Planner) và diễn giải kết quả tổng hợp (AnswerWriter). Bản cài đặt mặc định là luật
từ khóa chạy cục bộ (không gọi dịch vụ ngoài); có thể thay bằng adapter gọi LLM cùng giao diện.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol

from app.schemas.assistant import ChartSpec, Clarify
from app.schemas.common import QueryResult, SemanticQuery


@dataclass
class MetricInfo:
    code: str
    name: str
    definition: str
    unit: str | None
    allowed_dimensions: list[str]


@dataclass
class DimensionInfo:
    code: str
    name: str


@dataclass
class Plan:
    kind: Literal["QUERY", "CLARIFY", "NO_METRIC"]
    query: SemanticQuery | None = None
    clarify: Clarify | None = None
    notes: list[str] = field(default_factory=list)


class Planner(Protocol):
    model_name: str

    def plan(
        self,
        question: str,
        metrics: list[MetricInfo],
        dimensions: list[DimensionInfo],
        org_units: dict[str, str],
        clarification: dict | None,
    ) -> Plan: ...


class AnswerWriter(Protocol):
    def write(self, metrics: list[MetricInfo], query: SemanticQuery, result: QueryResult, data_as_of: datetime | None) -> tuple[str, ChartSpec | None]: ...


def get_planner() -> Planner:
    from app.assistant.planner import RuleBasedPlanner

    return RuleBasedPlanner()


def get_writer() -> AnswerWriter:
    from app.assistant.answer_writer import TemplateAnswerWriter

    return TemplateAnswerWriter()
