from app.generator import generate


def test_generation_is_reproducible() -> None:
    assert generate(seed=7, students=30, staff=20) == generate(seed=7, students=30, staff=20)


def test_row_counts_and_keys_are_unique() -> None:
    data = generate(seed=1, students=100, staff=50)
    student_ids = [r["student_id"] for r in data.sis_students]
    assert len(student_ids) == len(set(student_ids))
    assert len(data.hrm_staff) == 50
    assert len(data.fin_tuition) == 100 * 2  # 2 học kỳ
    assert len(data.lms_activity) == 100 * 5


def test_some_staff_are_also_students_with_same_national_id() -> None:
    data = generate(seed=1, students=100, staff=50)
    staff_ids = {r["national_id"] for r in data.hrm_staff}
    overlap = [r for r in data.sis_students if r["national_id"] in staff_ids]
    assert overlap, "cần có bản ghi trùng CCCD để kiểm thử đối soát danh tính"
    assert all(r["student_id"].startswith("SV9") for r in overlap)


def test_every_row_has_updated_at() -> None:
    data = generate(seed=3, students=10, staff=5)
    for table in (data.sis_students, data.sis_enrollments, data.hrm_staff, data.fin_tuition, data.lms_activity):
        assert all(row["updated_at"] for row in table)
