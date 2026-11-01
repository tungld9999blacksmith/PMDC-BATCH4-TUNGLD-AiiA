-- Silver: một dòng mới nhất cho mỗi sinh viên, kiểu dữ liệu chuẩn.
-- CCCD không đi tiếp dưới dạng gốc: chỉ giữ băm có salt.
with source_rows as (
    select
        student_id,
        full_name,
        cast(date_of_birth as date) as date_of_birth,
        lower(trim(email)) as email,
        to_hex(sha256(to_utf8(concat('{{ var("national_id_salt", "dev-only-salt") }}', national_id)))) as national_id_hash,
        faculty_code,
        program_code,
        cohort,
        status,
        from_iso8601_timestamp(updated_at) as updated_at,
        _ingested_at
    from {{ source('bronze', 'sis_students') }}
),

ranked as (
    select
        *,
        row_number() over (partition by student_id order by updated_at desc, _ingested_at desc) as rn
    from source_rows
)

select
    student_id,
    full_name,
    date_of_birth,
    email,
    national_id_hash,
    faculty_code,
    program_code,
    cohort,
    status,
    updated_at
from ranked
where rn = 1
