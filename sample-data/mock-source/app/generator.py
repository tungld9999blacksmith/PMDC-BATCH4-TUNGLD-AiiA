"""Sinh dữ liệu tổng hợp cho 5 bảng của hệ thống nguồn giả lập.

Toàn bộ dữ liệu là tổng hợp, sinh từ seed cố định nên có thể tái lập.
Một phần cán bộ cũng có bản ghi sinh viên (cùng CCCD, tên viết không dấu)
để kiểm thử đối soát danh tính.
"""

from __future__ import annotations

import random
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

LAST_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ"]
MIDDLE_NAMES = ["Văn", "Thị", "Minh", "Ngọc", "Quốc", "Thu", "Hồng", "Đức", "Gia"]
GIVEN_NAMES = ["An", "Bình", "Chi", "Dũng", "Hà", "Khánh", "Linh", "Nam", "Oanh", "Phúc", "Quang", "Thảo", "Tuấn", "Vy", "Yến", "Hải"]
FACULTIES = {"CNTT": ["KHMT", "HTTT", "KTPM"], "KT": ["QTKD", "TCNH"], "NN": ["NNA", "NNT"]}
COHORTS = ["K64", "K65", "K66", "K67", "K68"]
STUDENT_STATUS = [("STUDYING", 0.82), ("RESERVED", 0.04), ("GRADUATED", 0.10), ("DROPPED", 0.04)]
TERMS = ["2025-2026-HK1", "2025-2026-HK2"]
COURSES = [("CS101", 3), ("CS205", 3), ("CS310", 4), ("EC120", 3), ("EC240", 3), ("LN110", 2), ("MA101", 3), ("PH100", 3)]
ORG_UNITS = ["CNTT", "KT", "NN", "PDT", "TCCB", "KHCN", "TTDL"]
POSITIONS = ["Chuyên viên", "Trưởng phòng", "Phó phòng", "Kỹ sư dữ liệu", "Nhân viên hành chính"]
BASE_TS = datetime(2026, 10, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class SourceData:
    sis_students: list[dict]
    sis_enrollments: list[dict]
    hrm_staff: list[dict]
    fin_tuition: list[dict]
    lms_activity: list[dict]


def ascii_fold(text: str) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def _full_name(rng: random.Random) -> str:
    return f"{rng.choice(LAST_NAMES)} {rng.choice(MIDDLE_NAMES)} {rng.choice(GIVEN_NAMES)}"


def _email(name: str, n: int, domain: str) -> str:
    parts = ascii_fold(name).lower().split()
    return f"{parts[-1]}.{parts[0][0]}{n}@{domain}"


def _national_id(rng: random.Random) -> str:
    return "".join(rng.choice("0123456789") for _ in range(12))


def _phone(rng: random.Random) -> str:
    return f"09{rng.randint(10_000_000, 99_999_999)}"


def _dob(rng: random.Random, start_year: int, end_year: int) -> str:
    return date(rng.randint(start_year, end_year), rng.randint(1, 12), rng.randint(1, 28)).isoformat()


def _ts(rng: random.Random) -> str:
    return (BASE_TS - timedelta(days=rng.randint(0, 60), minutes=rng.randint(0, 1439))).isoformat()


def _letter(score: float) -> str:
    for threshold, letter in ((8.5, "A"), (7.0, "B"), (5.5, "C"), (4.0, "D")):
        if score >= threshold:
            return letter
    return "F"


def generate(seed: int = 42, students: int = 2000, staff: int = 300) -> SourceData:
    rng = random.Random(seed)
    sis_students: list[dict] = []
    sis_enrollments: list[dict] = []
    fin_tuition: list[dict] = []
    lms_activity: list[dict] = []
    hrm_staff: list[dict] = []
    enrollment_id = tuition_id = activity_id = 0

    statuses = [s for s, _ in STUDENT_STATUS]
    weights = [w for _, w in STUDENT_STATUS]

    for i in range(1, students + 1):
        sid = f"SV{i:06d}"
        name = _full_name(rng)
        faculty = rng.choice(list(FACULTIES))
        sis_students.append(
            dict(
                student_id=sid,
                full_name=name,
                date_of_birth=_dob(rng, 1999, 2008),
                email=_email(name, i, "st.uni.edu.vn"),
                phone=_phone(rng),
                national_id=_national_id(rng),
                faculty_code=faculty,
                program_code=rng.choice(FACULTIES[faculty]),
                cohort=rng.choice(COHORTS),
                status=rng.choices(statuses, weights=weights)[0],
                updated_at=_ts(rng),
            )
        )
        for term in TERMS:
            for code, credits in rng.sample(COURSES, 3):
                enrollment_id += 1
                score = round(rng.uniform(3.0, 10.0), 1)
                sis_enrollments.append(
                    dict(
                        enrollment_id=enrollment_id,
                        student_id=sid,
                        term_code=term,
                        course_code=code,
                        credits=credits,
                        score_10=score,
                        letter_grade=_letter(score),
                        updated_at=_ts(rng),
                    )
                )
            tuition_id += 1
            due = rng.choice([9_750_000, 11_200_000, 12_400_000])
            scholarship = rng.choice([0, 0, 0, 2_000_000])
            paid = due if rng.random() < 0.8 else rng.choice([0, due // 2])
            if paid + scholarship >= due:
                payment_status = "PAID"
            elif paid + scholarship > 0:
                payment_status = "PARTIAL"
            else:
                payment_status = "UNPAID"
            fin_tuition.append(
                dict(
                    tuition_id=tuition_id,
                    student_id=sid,
                    term_code=term,
                    amount_due=due,
                    amount_paid=paid,
                    scholarship_amount=scholarship,
                    payment_status=payment_status,
                    updated_at=_ts(rng),
                )
            )
        for _ in range(5):
            activity_id += 1
            lms_activity.append(
                dict(
                    activity_id=activity_id,
                    student_id=sid,
                    activity_date=(BASE_TS.date() - timedelta(days=rng.randint(0, 30))).isoformat(),
                    course_code=rng.choice(COURSES)[0],
                    logins=rng.randint(0, 6),
                    submissions=rng.randint(0, 3),
                    active_minutes=rng.randint(0, 240),
                    updated_at=_ts(rng),
                )
            )

    for j in range(1, staff + 1):
        staff_id = f"CB{j:05d}"
        name = _full_name(rng)
        national_id = _national_id(rng)
        dob = _dob(rng, 1965, 1995)
        if rng.random() < 0.7:
            row = dict(
                staff_id=staff_id,
                staff_type="LECTURER",
                full_name=name,
                date_of_birth=dob,
                email=_email(name, j, "uni.edu.vn"),
                national_id=national_id,
                org_unit_code=rng.choice(["CNTT", "KT", "NN"]),
                position=None,
                academic_title=rng.choice([None, None, "PGS"]),
                degree=rng.choice(["ThS", "TS"]),
                updated_at=_ts(rng),
            )
        else:
            row = dict(
                staff_id=staff_id,
                staff_type="STAFF",
                full_name=name,
                date_of_birth=dob,
                email=_email(name, j, "uni.edu.vn"),
                national_id=national_id,
                org_unit_code=rng.choice(ORG_UNITS),
                position=rng.choice(POSITIONS),
                academic_title=None,
                degree=rng.choice(["CN", "ThS"]),
                updated_at=_ts(rng),
            )
        hrm_staff.append(row)

        if j % 10 == 0:
            # Cán bộ đang học cao học: cùng CCCD, tên không dấu, email khác biến thể
            sis_students.append(
                dict(
                    student_id=f"SV9{j:05d}",
                    full_name=ascii_fold(name).lower(),
                    date_of_birth=dob,
                    email=f"{ascii_fold(name).split()[-1].lower()}.x{j}@st.uni.edu.vn",
                    phone=_phone(rng),
                    national_id=national_id,
                    faculty_code=rng.choice(list(FACULTIES)),
                    program_code="CAO_HOC",
                    cohort="K66",
                    status="STUDYING",
                    updated_at=_ts(rng),
                )
            )

    return SourceData(
        sis_students=sis_students,
        sis_enrollments=sis_enrollments,
        hrm_staff=hrm_staff,
        fin_tuition=fin_tuition,
        lms_activity=lms_activity,
    )
