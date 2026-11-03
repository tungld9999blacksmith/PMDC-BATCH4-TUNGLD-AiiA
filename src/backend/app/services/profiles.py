"""Hồ sơ 360° (US11–US16) đọc từ lớp Gold qua Trino.

- Phạm vi: hồ sơ thuộc đơn vị ngoài phạm vi vai trò trả 404 (AC11).
- Facet: FINANCE/HR cần quyền PROFILE_FACET còn hạn; facet bị khóa trả 403 kèm `requestable`.
- Che: RESTRICTED luôn che; CONFIDENTIAL chỉ hiện trong facet được phép (BR07, BR08).
- Audit: mỗi lần xem hồ sơ/facet ghi PROFILE_VIEW (BR10).
- Mức nhạy cảm lấy từ catalog (dataset GOLD cùng tên bảng); cột chưa phân loại xem như CONFIDENTIAL.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import audit, audit_denied
from app.core.errors import ProblemError, not_found
from app.core.pagination import PageParams
from app.core.security import Principal
from app.domain.enums import DataLayer, ResourceType, Sensitivity, SubjectType
from app.domain.models import Dataset, OrgUnit
from app.query.gateway import LakehouseGateway, TableMissing, quote_ident, require, table_ref
from app.schemas.assistant import (
    AttributeProvenance,
    FacetData,
    NamedTable,
    Profile360,
    ProfileFacetRef,
    ProfileKpi,
    ProfileSummary,
    ProvenanceCandidate,
    Series,
    SeriesPoint,
    TimelineEvent,
    TimelinePage,
)
from app.schemas.common import Freshness, MaskableValue, OrgUnitRef, TabularColumn
from app.services.access import (
    FACET_LABELS,
    PROFILE_ROLES,
    column_visible,
    data_scope,
    facet_allowed,
    find_grant,
    in_scope,
    mask_value,
)
from app.services.catalog import freshness

GOLD = "gold"
ROLE_FACETS: dict[SubjectType, list[str]] = {
    SubjectType.STUDENT: ["OVERVIEW", "ACADEMIC", "FINANCE", "CONDUCT", "ACTIVITY", "OUTCOME"],
    SubjectType.LECTURER: ["OVERVIEW", "TEACHING", "RESEARCH", "EVALUATION", "RECOGNITION"],
    SubjectType.STAFF: ["OVERVIEW", "HR", "DEVELOPMENT", "RECOGNITION"],
}
ROLE_TABLE = {
    SubjectType.STUDENT: ("dim_student", "student_id"),
    SubjectType.LECTURER: ("dim_lecturer", "lecturer_id"),
    SubjectType.STAFF: ("dim_staff", "staff_id"),
}
# Facet → (bảng Gold, khóa nối: "person" hoặc "role") cho phần bảng chi tiết.
FACET_TABLES: dict[str, list[tuple[str, str, str]]] = {
    "ACADEMIC": [("fact_enrollment", "role", "Đăng ký học phần"), ("fact_term_result", "role", "Kết quả học kỳ")],
    "FINANCE": [("fact_tuition", "role", "Học phí")],
    "CONDUCT": [("fact_award_discipline", "person", "Khen thưởng – kỷ luật")],
    "ACTIVITY": [("fact_lms_activity_daily", "person", "Hoạt động LMS"), ("fact_library_loan", "person", "Mượn sách")],
    "TEACHING": [("fact_teaching_load", "role", "Khối lượng giảng dạy")],
    "RESEARCH": [("fact_research_output", "person", "Công trình nghiên cứu")],
    "EVALUATION": [("fact_teaching_evaluation", "role", "Đánh giá giảng dạy")],
    "RECOGNITION": [("fact_award_discipline", "person", "Thi đua – khen thưởng")],
    "DEVELOPMENT": [("fact_hr_event", "person", "Đào tạo, bồi dưỡng")],
}
# Facet → (bảng, cột trục x, cột giá trị, mã chuỗi) cho biểu đồ.
FACET_SERIES: dict[str, list[tuple[str, str, str, str]]] = {
    "ACADEMIC": [("fact_term_result", "term_code", "gpa_term", "gpa_by_term")],
    "CONDUCT": [("fact_term_result", "term_code", "conduct_score", "conduct_by_term")],
}
HEADER_FIELDS = ("full_name", "date_of_birth", "email", "national_id_hash")
ROLE_FIELDS = {
    SubjectType.STUDENT: ("program_code", "cohort", "status"),
    SubjectType.LECTURER: ("academic_title", "degree"),
    SubjectType.STAFF: ("position", "grade"),
}
FIELD_FACET = {"program_code": "ACADEMIC", "cohort": "ACADEMIC", "status": "OUTCOME", "position": "HR", "grade": "HR"}
SURVIVORSHIP_DEFAULT = "Ưu tiên nguồn hệ thống quản lý chính của vai trò (SIS cho sinh viên, HRM cho cán bộ)"

_VN = "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
_ASCII = "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd"


def _fold_sql(expr: str) -> str:
    """Biểu thức Trino bỏ dấu tiếng Việt (tìm kiếm không phân biệt dấu)."""
    return f"translate(lower({expr}), '{_VN}', '{_ASCII}')"


def _fold(text: str) -> str:
    return text.lower().translate(str.maketrans(_VN, _ASCII))


class _Sensitivities:
    def __init__(self, db: Session) -> None:
        rows = db.scalars(select(Dataset).where(Dataset.layer == DataLayer.GOLD, Dataset.schema_name == GOLD)).all()
        self.by_table = {d.table_name: {c.name: c.sensitivity for c in d.columns} for d in rows}
        self.datasets = {d.table_name: d for d in rows}

    def get(self, table: str, column: str) -> Sensitivity:
        return self.by_table.get(table, {}).get(column, Sensitivity.CONFIDENTIAL)

    def freshness(self, tables: list[str]) -> Freshness:
        known = [self.datasets[t] for t in tables if t in self.datasets]
        if not known:
            return Freshness()
        parts = [freshness(d) for d in known]
        times = [p.updated_at for p in parts if p.updated_at]
        scores = [p.dq_score for p in parts if p.dq_score is not None]
        return Freshness(
            sources=sorted({s for p in parts for s in p.sources}),
            updated_at=min(times) if times else None,
            stale=any(p.stale for p in parts),
            dq_score=min(scores) if scores else None,
        )


def _json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _maskable(value: Any, sensitivity: Sensitivity, allowed: bool, source: str | None = None) -> MaskableValue:
    visible = allowed and column_visible(sensitivity, has_data_grant=True)
    return MaskableValue(
        value=_json(value) if visible else mask_value(value),
        masked=not visible and value is not None,
        sensitivity=sensitivity,
        source=source,
    )


def _query(gateway: LakehouseGateway, principal: Principal, sql: str, params: list[Any]) -> list[dict[str, Any]]:
    try:
        out = gateway.execute(sql, params, principal.email)
    except TableMissing:
        return []
    return [dict(zip(out.columns, row, strict=False)) for row in out.rows]


def _org_units(db: Session) -> dict[str, OrgUnit]:
    return {u.code: u for u in db.scalars(select(OrgUnit)).all()}


def _scope(db: Session, principal: Principal) -> set[str] | None:
    return data_scope(db, principal, PROFILE_ROLES)


def search(
    db: Session,
    gateway: LakehouseGateway | None,
    principal: Principal,
    *,
    q: str | None,
    type_: SubjectType | None,
    org_unit: str | None,
    cohort: str | None,
    status: str | None,
    params: PageParams,
) -> tuple[list[ProfileSummary], int]:
    gateway = require(gateway)
    scope = _scope(db, principal)
    if scope is not None and not scope:
        return [], 0
    p, s, lec, st = table_ref(GOLD, "dim_person"), table_ref(GOLD, "dim_student"), table_ref(GOLD, "dim_lecturer"), table_ref(GOLD, "dim_staff")
    where, args = [], []
    if q:
        needle = f"%{_fold(q.strip())}%"
        where.append(f"({_fold_sql('p.full_name')} LIKE ? OR s.student_id = ? OR lec.lecturer_id = ? OR st.staff_id = ?)")
        args += [needle, q.strip(), q.strip(), q.strip()]
    if type_ == SubjectType.STUDENT:
        where.append("s.student_id IS NOT NULL")
    elif type_ == SubjectType.LECTURER:
        where.append("lec.lecturer_id IS NOT NULL")
    elif type_ == SubjectType.STAFF:
        where.append("st.staff_id IS NOT NULL")
    if org_unit:
        where.append("coalesce(s.faculty_code, p.primary_org_unit_code) = ?")
        args.append(org_unit)
    if cohort:
        where.append("s.cohort = ?")
        args.append(cohort)
    if status:
        where.append("s.status = ?")
        args.append(status)
    if scope is not None:
        where.append(f"coalesce(s.faculty_code, p.primary_org_unit_code) IN ({', '.join('?' for _ in scope)})")
        args += sorted(scope)
    base = (
        f"FROM {p} p LEFT JOIN {s} s ON s.person_id = p.person_id "
        f"LEFT JOIN {lec} lec ON lec.person_id = p.person_id LEFT JOIN {st} st ON st.person_id = p.person_id"
    )
    if where:
        base += " WHERE " + " AND ".join(where)
    count_rows = _query(gateway, principal, f"SELECT count(DISTINCT p.person_id) AS n {base}", args)
    total = int(count_rows[0]["n"]) if count_rows else 0
    rows = _query(
        gateway,
        principal,
        "SELECT DISTINCT p.person_id, p.full_name, p.email, p.date_of_birth, p.primary_org_unit_code, "
        "s.student_id, s.faculty_code, s.status, lec.lecturer_id, st.staff_id "
        f"{base} ORDER BY p.full_name OFFSET {params.offset} LIMIT {params.page_size}",
        args,
    )
    units = _org_units(db)
    out = []
    for r in rows:
        roles = [t for t, key in ((SubjectType.STUDENT, "student_id"), (SubjectType.LECTURER, "lecturer_id"), (SubjectType.STAFF, "staff_id")) if r.get(key)]
        unit_code = r.get("faculty_code") or r.get("primary_org_unit_code")
        filled = sum(1 for k in ("full_name", "email", "date_of_birth", "primary_org_unit_code") if r.get(k))
        out.append(
            ProfileSummary(
                person_id=r["person_id"],
                full_name=r["full_name"],
                code=r.get("student_id") or r.get("lecturer_id") or r.get("staff_id"),
                roles=roles,
                org_unit=OrgUnitRef.of(units.get(unit_code)) if unit_code in units else (OrgUnitRef(code=unit_code, name=unit_code) if unit_code else None),
                status=r.get("status"),
                completeness=round(filled / 4, 2),
            )
        )
    audit(db, principal, "PROFILE_SEARCH", "PROFILE", None, {"q": q, "type": type_, "results": len(out)})
    db.commit()
    return out, total


def _load_person(db: Session, gateway: LakehouseGateway, principal: Principal, person_id: uuid.UUID) -> dict[str, Any]:
    rows = _query(gateway, principal, f"SELECT * FROM {table_ref(GOLD, 'dim_person')} WHERE person_id = ?", [str(person_id)])
    if not rows:
        raise not_found()
    person = rows[0]
    roles: dict[SubjectType, dict[str, Any]] = {}
    for subject, (table, _key) in ROLE_TABLE.items():
        found = _query(gateway, principal, f"SELECT * FROM {table_ref(GOLD, table)} WHERE person_id = ?", [str(person_id)])
        if found:
            roles[subject] = found[0]
    person["_roles"] = roles
    unit = (roles.get(SubjectType.STUDENT) or {}).get("faculty_code") or person.get("primary_org_unit_code")
    person["_org_unit"] = unit
    if not in_scope(_scope(db, principal), unit):
        # AC11: ngoài phạm vi trả 404 như không tồn tại; vẫn ghi audit DENY.
        audit_denied(db, principal, "PROFILE_VIEW", "PROFILE", person_id, reason="out-of-scope")
        raise not_found()
    return person


def _active_role(person: dict[str, Any], requested: SubjectType | None) -> SubjectType:
    roles = list(person["_roles"])
    if not roles:
        raise not_found()
    if requested is not None:
        if requested not in roles:
            raise not_found()
        return requested
    return roles[0]


def _facet_allowed_for(db: Session, principal: Principal, facet: str, unit: str | None) -> bool:
    if not facet_allowed(db, principal, facet):
        return False
    grant = find_grant(db, principal, ResourceType.PROFILE_FACET, facet)
    codes = (grant.scope or {}).get("orgUnitCodes") if grant else None
    return not codes or unit in codes


def get_profile(db: Session, gateway: LakehouseGateway | None, principal: Principal, person_id: uuid.UUID, role: SubjectType | None) -> Profile360:
    gateway = require(gateway)
    person = _load_person(db, gateway, principal, person_id)
    active = _active_role(person, role)
    sens = _Sensitivities(db)
    role_row = person["_roles"][active]
    header = {
        _camel(f): _maskable(person.get(f), sens.get("dim_person", f), True, "SIS" if active == SubjectType.STUDENT else "HRM")
        for f in HEADER_FIELDS
        if f in person
    }
    role_table = ROLE_TABLE[active][0]
    unit = person["_org_unit"]
    allowed = {f: _facet_allowed_for(db, principal, f, unit) for f in ROLE_FACETS[active]}
    for field in ROLE_FIELDS[active]:
        if field in role_row:
            facet_ok = allowed.get(FIELD_FACET.get(field, "OVERVIEW"), True)
            header[_camel(field)] = _maskable(role_row[field], sens.get(role_table, field), facet_ok)
    units = _org_units(db)
    header["orgUnit"] = MaskableValue(value=units[unit].name if unit in units else unit, sensitivity=Sensitivity.INTERNAL)
    header["code"] = MaskableValue(value=role_row.get(ROLE_TABLE[active][1]), sensitivity=Sensitivity.INTERNAL)

    kpis = _kpis(gateway, principal, active, role_row, sens, allowed)
    facets = [
        ProfileFacetRef(
            code=f,
            label=FACET_LABELS[f],
            allowed=allowed[f],
            freshness=sens.freshness([t for t, _, _ in FACET_TABLES.get(f, [])] or ["dim_person", role_table]),
        )
        for f in ROLE_FACETS[active]
    ]
    audit(db, principal, "PROFILE_VIEW", "PROFILE", person_id, {"title": person.get("full_name"), "role": active.value})
    db.commit()
    return Profile360(
        person_id=person_id,
        active_role=active,
        available_roles=list(person["_roles"]),
        header=header,
        kpis=kpis,
        facets=facets,
    )


def _camel(name: str) -> str:
    head, *rest = name.removesuffix("_hash").split("_")
    return head + "".join(p.title() for p in rest)


def _kpis(gateway, principal, active, role_row, sens, allowed) -> list[ProfileKpi]:  # noqa: ANN001
    if active != SubjectType.STUDENT:
        return []
    rows = _query(
        gateway,
        principal,
        f"SELECT gpa_cumulative, academic_warning_level, conduct_score FROM {table_ref(GOLD, 'fact_term_result')} "
        "WHERE student_id = ? ORDER BY term_code DESC LIMIT 1",
        [role_row["student_id"]],
    )
    latest = rows[0] if rows else {}
    spec = [
        ("gpa_cumulative", "GPA tích lũy", "ACADEMIC"),
        ("academic_warning_level", "Mức cảnh báo học vụ", "ACADEMIC"),
        ("conduct_score", "Điểm rèn luyện", "CONDUCT"),
    ]
    return [
        ProfileKpi(code=code, label=label, value=_maskable(latest.get(code), sens.get("fact_term_result", code), allowed.get(facet, False)))
        for code, label, facet in spec
    ]


def get_facet(db: Session, gateway: LakehouseGateway | None, principal: Principal, person_id: uuid.UUID, facet: str) -> FacetData:
    gateway = require(gateway)
    person = _load_person(db, gateway, principal, person_id)
    roles = [r for r in person["_roles"] if facet in ROLE_FACETS[r]]
    if not roles:
        raise not_found("Hồ sơ không có tab này")
    active = roles[0]
    if not _facet_allowed_for(db, principal, facet, person["_org_unit"]):
        audit_denied(db, principal, "PROFILE_FACET_VIEW", "PROFILE", person_id, facet=facet)
        raise ProblemError(
            403,
            "Facet bị khóa",
            f"Bạn chưa có quyền xem tab {FACET_LABELS[facet]}.",
            type_="facet-locked",
            requestable={"resourceType": ResourceType.PROFILE_FACET.value, "resourceId": facet},
        )
    sens = _Sensitivities(db)
    role_row = person["_roles"][active]
    keys = {"person": ("person_id", str(person_id)), "role": (ROLE_TABLE[active][1], role_row.get(ROLE_TABLE[active][1]))}

    fields: dict[str, MaskableValue] = {}
    if facet == "OVERVIEW":
        for f in HEADER_FIELDS:
            if f in person:
                fields[_camel(f)] = _maskable(person[f], sens.get("dim_person", f), True)
    for field in ROLE_FIELDS[active]:
        if FIELD_FACET.get(field) == facet and field in role_row:
            fields[_camel(field)] = _maskable(role_row[field], sens.get(ROLE_TABLE[active][0], field), True)

    tables = []
    for table, key_kind, title in FACET_TABLES.get(facet, []):
        key_col, key_val = keys[key_kind]
        rows = _query(gateway, principal, f"SELECT * FROM {table_ref(GOLD, table)} WHERE {quote_ident(key_col)} = ? LIMIT 200", [key_val])
        if not rows:
            tables.append(NamedTable(code=table.removeprefix("fact_"), title=title))
            continue
        columns = [c for c in rows[0] if not c.startswith("_") and c not in ("person_id",)]
        visible = {c: column_visible(sens.get(table, c), has_data_grant=True) for c in columns}
        tables.append(
            NamedTable(
                code=table.removeprefix("fact_"),
                title=title,
                columns=[TabularColumn(name=c, type="string", masked=not visible[c]) for c in columns],
                rows=[[_json(r[c]) if visible[c] else mask_value(r[c]) for c in columns] for r in rows],
            )
        )
    series = []
    for table, x_col, y_col, code in FACET_SERIES.get(facet, []):
        key_col, key_val = keys["role"]
        rows = _query(
            gateway, principal,
            f"SELECT {quote_ident(x_col)} AS x, {quote_ident(y_col)} AS y FROM {table_ref(GOLD, table)} "
            f"WHERE {quote_ident(key_col)} = ? ORDER BY 1",
            [key_val],
        )  # fmt: skip
        if column_visible(sens.get(table, y_col), has_data_grant=True):
            series.append(Series(code=code, points=[SeriesPoint(x=str(r["x"]), y=_json(r["y"])) for r in rows]))
    audit(db, principal, "PROFILE_FACET_VIEW", "PROFILE", person_id, {"facet": facet, "title": person.get("full_name")})
    db.commit()
    return FacetData(
        facet=facet,
        freshness=sens.freshness([t for t, _, _ in FACET_TABLES.get(facet, [])] or ["dim_person"]),
        fields=fields,
        tables=tables,
        series=series,
    )


def timeline(
    db: Session,
    gateway: LakehouseGateway | None,
    principal: Principal,
    person_id: uuid.UUID,
    event_types: list[str],
    sources: list[str],
    before: datetime | None,
    page_size: int,
) -> TimelinePage:
    gateway = require(gateway)
    person = _load_person(db, gateway, principal, person_id)
    facets = {f for r in person["_roles"] for f in ROLE_FACETS[r] if _facet_allowed_for(db, principal, f, person["_org_unit"])}
    if not facets:
        return TimelinePage(items=[], next_before=None)
    where = ["person_id = ?", f"facet IN ({', '.join('?' for _ in facets)})"]
    args: list[Any] = [str(person_id), *sorted(facets)]
    if event_types:
        where.append(f"event_type IN ({', '.join('?' for _ in event_types)})")
        args += event_types
    if sources:
        where.append(f"source_code IN ({', '.join('?' for _ in sources)})")
        args += sources
    if before:
        where.append("event_time < ?")
        args.append(before)
    rows = _query(
        gateway,
        principal,
        f"SELECT * FROM {table_ref(GOLD, 'fact_profile_event')} WHERE {' AND '.join(where)} "
        f"ORDER BY event_time DESC LIMIT {page_size + 1}",
        args,
    )
    items = [
        TimelineEvent(
            event_id=str(r["event_id"]),
            time=r["event_time"],
            type=r["event_type"],
            facet=r["facet"],
            source=r.get("source_code") or "",
            title=r.get("title") or r.get("description") or r["event_type"],
        )
        for r in rows[:page_size]
    ]
    audit(db, principal, "PROFILE_TIMELINE_VIEW", "PROFILE", person_id, {"events": len(items)})
    db.commit()
    return TimelinePage(items=items, next_before=items[-1].time if len(rows) > page_size else None)


def provenance(db: Session, gateway: LakehouseGateway | None, principal: Principal, person_id: uuid.UUID, attribute: str) -> AttributeProvenance:
    gateway = require(gateway)
    person = _load_person(db, gateway, principal, person_id)
    column = next((c for c in person if not c.startswith("_") and attribute in (c, _camel(c))), None)
    if column is None:
        raise not_found("Thuộc tính không tồn tại")
    sens = _Sensitivities(db).get("dim_person", column)
    rows = _query(
        gateway,
        principal,
        f"SELECT * FROM {table_ref(GOLD, 'person_attribute_provenance')} WHERE person_id = ? AND attribute = ?",
        [str(person_id), column],
    )
    prov = rows[0] if rows else {}
    candidates: list[ProvenanceCandidate] = []
    # Giá trị từng nguồn chỉ trả khi người xem đủ quyền với mức nhạy cảm của thuộc tính.
    if column_visible(sens, has_data_grant=True) and isinstance(prov.get("candidates"), list):
        candidates = [ProvenanceCandidate.model_validate(c) for c in prov["candidates"] if isinstance(c, dict)]
    audit(db, principal, "PROFILE_PROVENANCE_VIEW", "PROFILE", person_id, {"attribute": column})
    db.commit()
    return AttributeProvenance(
        attribute=attribute,
        value=_maskable(person.get(column), sens, True, prov.get("value_source")),
        winning_source=prov.get("value_source"),
        source_updated_at=prov.get("source_updated_at"),
        survivorship_rule=prov.get("survivorship_rule") or SURVIVORSHIP_DEFAULT,
        candidates=candidates,
    )
