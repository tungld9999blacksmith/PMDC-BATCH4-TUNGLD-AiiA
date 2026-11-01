"""Diễn giải kết quả tổng hợp thành câu trả lời tiếng Việt (BR16: kèm metric, bộ lọc, thời điểm dữ liệu)."""

from datetime import datetime
from typing import Any

from app.assistant.llm_adapter import MetricInfo
from app.assistant.planner import TIME_DIMENSIONS
from app.schemas.assistant import ChartSpec
from app.schemas.common import QueryResult, SemanticQuery

MAX_LINES = 10


def _number(value: float, unit: str | None) -> str:
    if unit == "%" and abs(value) <= 1:
        value *= 100
    text = f"{value:,.2f}".rstrip("0").rstrip(".") if isinstance(value, float) else f"{value:,}"
    # Định dạng số kiểu Việt Nam: dấu chấm phân nhóm, dấu phẩy thập phân.
    text = text.replace(",", "§").replace(".", ",").replace("§", ".")
    return f"{text}{unit}" if unit == "%" else (f"{text} {unit}" if unit else text)


def _format(value: Any, unit: str | None) -> str:
    if isinstance(value, dict) and value.get("suppressed"):
        return "< 5"
    if isinstance(value, (int, float)):
        return _number(value, unit)
    return "—" if value is None else str(value)


class TemplateAnswerWriter:
    def write(
        self, metrics: list[MetricInfo], query: SemanticQuery, result: QueryResult, data_as_of: datetime | None
    ) -> tuple[str, ChartSpec | None]:
        by_code = {m.code: m for m in metrics}
        names = ", ".join(f"«{by_code[c].name}»" for c in query.metrics if c in by_code)
        parts = [f"Kết quả cho {names}"]
        if query.dimensions:
            parts.append(f" theo {', '.join(query.dimensions)}")
        if query.filters:
            desc = "; ".join(f"{f.dimension} {f.op} {f.values if f.values is not None else f.value}" for f in query.filters)
            parts.append(f", bộ lọc: {desc}")
        if data_as_of:
            parts.append(f" (dữ liệu tính đến {data_as_of:%d/%m/%Y %H:%M})")
        lines = ["".join(parts) + ":"]
        if not result.rows:
            lines.append("Không có dữ liệu phù hợp trong phạm vi quyền của bạn.")
        n_dims = sum(1 for c in result.columns if c.kind == "DIMENSION")
        for row in result.rows[:MAX_LINES]:
            labels = ", ".join(str(v) for v in row[:n_dims])
            cells = []
            for column, value in zip(result.columns[n_dims:], row[n_dims:], strict=False):
                text = _format(value, column.unit)
                # Nhiều metric thì ghi kèm tên để phân biệt.
                cells.append(f"{by_code[column.name].name}: {text}" if len(query.metrics) > 1 and column.name in by_code else text)
            values = ", ".join(cells)
            lines.append(f"- {labels}: {values}" if labels else f"- {values}")
        if len(result.rows) > MAX_LINES:
            lines.append(f"… và {len(result.rows) - MAX_LINES} dòng khác (xem bảng kết quả).")
        if result.suppressed_cells:
            lines.append(f"{result.suppressed_cells} ô có nhóm dưới 5 người được ẩn để bảo vệ quyền riêng tư.")
        lines.append("Nội dung do AI tạo — xem truy vấn đã chạy để kiểm chứng.")

        chart = None
        if query.dimensions:
            time_dim = next((d for d in query.dimensions if d in TIME_DIMENSIONS), None)
            chart = ChartSpec(type="LINE" if time_dim else "BAR", x=time_dim or query.dimensions[0], y=list(query.metrics))
        return "\n".join(lines), chart
