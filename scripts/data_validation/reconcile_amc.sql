-- Run in the NEW Supabase project SQL Editor after completing M7 imports
WITH amc AS (
  SELECT id FROM public.institutions WHERE code = 'AMCEC' LIMIT 1
)
SELECT 'academic_units' AS target_table, count(*) AS row_count FROM public.academic_units, amc WHERE institution_id = amc.id AND deleted_at IS NULL
UNION ALL
SELECT 'programs', count(*) FROM public.programs, amc WHERE institution_id = amc.id AND deleted_at IS NULL
UNION ALL
SELECT 'program_specializations', count(*) FROM public.program_specializations, amc WHERE institution_id = amc.id
UNION ALL
SELECT 'course_catalog', count(*) FROM public.course_catalog, amc WHERE institution_id = amc.id AND deleted_at IS NULL
UNION ALL
SELECT 'curricula', count(*) FROM public.curricula, amc WHERE institution_id = amc.id AND deleted_at IS NULL
UNION ALL
SELECT 'curriculum_courses', count(*) FROM public.curriculum_courses, amc WHERE institution_id = amc.id
UNION ALL
SELECT 'staff_profiles', count(*) FROM public.staff_profiles, amc WHERE institution_id = amc.id AND deleted_at IS NULL
UNION ALL
SELECT 'students', count(*) FROM public.students, amc WHERE institution_id = amc.id AND deleted_at IS NULL
UNION ALL
SELECT 'student_enrollments (current)', count(*) FROM public.student_enrollments, amc WHERE institution_id = amc.id AND is_current = true
UNION ALL
SELECT 'academic_batches', count(*) FROM public.academic_batches, amc WHERE institution_id = amc.id AND deleted_at IS NULL
UNION ALL
SELECT 'academic_sections', count(*) FROM public.academic_sections, amc WHERE institution_id = amc.id
UNION ALL
SELECT 'migration_mappings', count(*) FROM public.migration_mappings, amc WHERE institution_id = amc.id
UNION ALL
SELECT 'open_migration_errors', count(*) FROM public.migration_errors, amc WHERE institution_id = amc.id AND resolution_status = 'OPEN';

-- Verify zero students are missing an active enrollment and inspect status split
WITH amc AS (
  SELECT id FROM public.institutions WHERE code = 'AMCEC' LIMIT 1
)
SELECT
  COALESCE(se.enrollment_status, 'MISSING_ENROLLMENT') AS status,
  count(*) AS student_count
FROM public.students s
JOIN amc ON s.institution_id = amc.id
LEFT JOIN public.student_enrollments se ON se.student_id = s.id AND se.is_current = true
WHERE s.deleted_at IS NULL
GROUP BY 1
ORDER BY 2 DESC;
