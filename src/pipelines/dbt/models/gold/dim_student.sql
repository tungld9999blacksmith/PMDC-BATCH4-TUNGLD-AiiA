-- Gold: chiều sinh viên. person_key tạm dùng băm CCCD; sẽ thay bằng person_id khi có đối soát danh tính (BR06).
select
    student_id,
    national_id_hash as person_key,
    faculty_code,
    program_code,
    cohort,
    status,
    updated_at
from {{ ref('silver_sis_students') }}
