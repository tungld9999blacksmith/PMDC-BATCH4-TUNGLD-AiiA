"""Schema dùng chung — JSON camelCase như openapi.yaml, Python snake_case."""

import uuid
from datetime import datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.pagination import PageParams
from app.domain.enums import Sensitivity
from app.domain.models import OrgUnit, User

T = TypeVar("T")


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class Page(ApiModel, Generic[T]):
    page: int
    page_size: int
    total: int
    items: list[T]

    @classmethod
    def of(cls, items: list[T], total: int, params: PageParams) -> "Page[T]":
        return cls(page=params.page, page_size=params.page_size, total=total, items=items)


class UserRef(ApiModel):
    id: uuid.UUID
    full_name: str

    @classmethod
    def of(cls, user: User | None) -> "UserRef | None":
        return cls(id=user.id, full_name=user.full_name) if user else None


class OrgUnitRef(ApiModel):
    code: str
    name: str

    @classmethod
    def of(cls, unit: OrgUnit | None) -> "OrgUnitRef | None":
        return cls(code=unit.code, name=unit.name) if unit else None


class Freshness(ApiModel):
    sources: list[str] = []
    updated_at: datetime | None = None
    stale: bool = False
    dq_score: float | None = None


class MaskableValue(ApiModel):
    value: Any = None
    masked: bool = False
    sensitivity: Sensitivity = Sensitivity.INTERNAL
    source: str | None = None


class TabularColumn(ApiModel):
    name: str
    type: str
    masked: bool = False


class TabularResult(ApiModel):
    columns: list[TabularColumn] = []
    rows: list[list[Any]] = []


class Filter(ApiModel):
    dimension: str
    op: Literal["eq", "neq", "in", "between", "gte", "lte"]
    value: Any = None
    values: list[Any] | None = None


class OrderBy(ApiModel):
    field: str
    direction: Literal["asc", "desc"] = "asc"


class SemanticQuery(ApiModel):
    metrics: list[str] = Field(min_length=1)
    dimensions: list[str] = []
    filters: list[Filter] = []
    order_by: list[OrderBy] = []
    limit: int = Field(500, ge=1, le=5000)


class QueryColumn(ApiModel):
    name: str
    kind: Literal["DIMENSION", "METRIC"]
    unit: str | None = None


class QueryResult(ApiModel):
    columns: list[QueryColumn] = []
    rows: list[list[Any]] = []
    data_as_of: datetime | None = None
    stale: bool = False
    suppressed_cells: int = 0
