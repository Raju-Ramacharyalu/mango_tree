CREATE OR REPLACE FUNCTION public.bulk_import_students_chunk(
  p_institution_id uuid,
  p_job_id uuid,
  p_source_id uuid,
  p_import_mode text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_active_ay text;
  v_imported integer := 0;
  v_skipped integer := 0;
  v_errors integer := 0;
BEGIN
  IF v_actor_id IS NULL OR NOT (
    public.is_platform_admin() OR public.is_institution_admin(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution admin or platform admin privileges required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.migration_jobs
    WHERE id = p_job_id AND institution_id = p_institution_id
  ) THEN
    RAISE EXCEPTION 'Migration job % does not belong to institution %.', p_job_id, p_institution_id;
  END IF;

  PERFORM set_config('statement_timeout', '60000', true);

  SELECT COALESCE(NULLIF(trim(setting_value #>> '{}'), ''), '2026-27')
  INTO v_active_ay
  FROM public.institution_settings
  WHERE institution_id = p_institution_id
    AND setting_key = 'active_academic_year'
  LIMIT 1;
  IF v_active_ay IS NULL THEN
    v_active_ay := '2026-27';
  END IF;

  DROP TABLE IF EXISTS pg_temp._chunk_rows;
  CREATE TEMP TABLE _chunk_rows (
    row_num integer NOT NULL,
    source_key text NOT NULL,
    preview_status text NOT NULL,
    existing_target_id uuid,
    raw_payload jsonb NOT NULL,
    norm_payload jsonb NOT NULL,
    messages jsonb NOT NULL,
    reg_no text,
    is_temp boolean,
    full_name text,
    branch_code text,
    current_sem integer,
    section_name text,
    scheme_batch integer,
    admission_year integer,
    phone text,
    email text,
    dob date,
    student_category text,
    specialization text,
    action_bucket text NOT NULL DEFAULT 'IMPORT'
  ) ON COMMIT DROP;

  INSERT INTO _chunk_rows (
    row_num, source_key, preview_status, existing_target_id,
    raw_payload, norm_payload, messages,
    reg_no, is_temp, full_name, branch_code, current_sem, section_name,
    scheme_batch, admission_year, phone, email, dob, student_category, specialization
  )
  SELECT
    (elem ->> 'row_number')::integer,
    COALESCE(elem ->> 'source_key', ''),
    COALESCE(elem ->> 'status', 'VALID'),
    NULLIF(elem ->> 'existing_target_id', '')::uuid,
    COALESCE(elem -> 'raw_payload', '{}'::jsonb),
    COALESCE(elem -> 'normalized_payload', '{}'::jsonb),
    COALESCE(elem -> 'messages', '[]'::jsonb),
    NULLIF(upper(trim(COALESCE(elem -> 'normalized_payload' ->> 'registration_number', ''))), ''),
    COALESCE((elem -> 'normalized_payload' ->> 'is_temporary_registration')::boolean, false),
    NULLIF(trim(COALESCE(elem -> 'normalized_payload' ->> 'full_name', '')), ''),
    NULLIF(upper(trim(COALESCE(elem -> 'normalized_payload' ->> 'branch_code', ''))), ''),
    NULLIF(elem -> 'normalized_payload' ->> 'current_sem', '')::integer,
    NULLIF(upper(trim(COALESCE(elem -> 'normalized_payload' ->> 'section', ''))), ''),
    COALESCE(NULLIF(elem -> 'normalized_payload' ->> 'scheme_batch', '')::integer, 25),
    CASE
      WHEN COALESCE(NULLIF(elem -> 'normalized_payload' ->> 'scheme_batch', '')::integer, 25) >= 1900
        THEN COALESCE(NULLIF(elem -> 'normalized_payload' ->> 'scheme_batch', '')::integer, 25)
      ELSE 2000 + COALESCE(NULLIF(elem -> 'normalized_payload' ->> 'scheme_batch', '')::integer, 25)
    END,
    NULLIF(trim(COALESCE(elem -> 'normalized_payload' ->> 'phone', '')), ''),
    NULLIF(lower(trim(COALESCE(elem -> 'normalized_payload' ->> 'email', ''))), ''),
    NULLIF(trim(COALESCE(elem -> 'normalized_payload' ->> 'dob', '')), '')::date,
    COALESCE(NULLIF(upper(trim(COALESCE(elem -> 'normalized_payload' ->> 'student_category', ''))), ''), 'REGULAR'),
    COALESCE(NULLIF(upper(trim(COALESCE(elem -> 'normalized_payload' ->> 'specialization', ''))), ''), 'GENERAL')
  FROM jsonb_array_elements(p_rows) AS elem;

  UPDATE _chunk_rows
  SET action_bucket = 'ERROR'
  WHERE preview_status = 'ERROR' OR reg_no IS NULL OR full_name IS NULL;

  UPDATE _chunk_rows
  SET action_bucket = 'SKIP'
  WHERE action_bucket = 'IMPORT'
    AND preview_status = 'DUPLICATE'
    AND (existing_target_id IS NULL OR p_import_mode = 'SAFE');

  IF p_import_mode = 'SAFE' THEN
    UPDATE _chunk_rows c
    SET action_bucket = 'SKIP',
        existing_target_id = s.id
    FROM public.students s
    WHERE c.action_bucket = 'IMPORT'
      AND s.institution_id = p_institution_id
      AND s.deleted_at IS NULL
      AND upper(s.registration_number) = c.reg_no;
  END IF;

  UPDATE _chunk_rows c
  SET email = NULL
  WHERE c.action_bucket = 'IMPORT'
    AND c.email IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.institution_id = p_institution_id
        AND s.deleted_at IS NULL
        AND lower(s.email) = c.email
        AND upper(s.registration_number) <> c.reg_no
    );

  WITH err_stage AS (
    INSERT INTO public.migration_staging_rows (
      institution_id, job_id, row_number, source_key,
      raw_payload, normalized_payload, validation_status, validation_messages
    )
    SELECT
      p_institution_id, p_job_id, row_num, source_key,
      raw_payload, norm_payload, 'ERROR', messages
    FROM _chunk_rows
    WHERE action_bucket = 'ERROR'
    ON CONFLICT (job_id, row_number) DO UPDATE
      SET validation_status = 'ERROR', validation_messages = EXCLUDED.validation_messages
    RETURNING id, row_number
  )
  INSERT INTO public.migration_errors (
    institution_id, job_id, staging_row_id, row_number,
    error_code, error_message, raw_payload, resolution_status
  )
  SELECT
    p_institution_id,
    p_job_id,
    es.id,
    c.row_num,
    'VALIDATION_ERROR',
    COALESCE((SELECT string_agg(m, ' ') FROM jsonb_array_elements_text(c.messages) m), 'Validation error'),
    c.raw_payload,
    'OPEN'
  FROM _chunk_rows c
  JOIN err_stage es ON es.row_number = c.row_num
  WHERE c.action_bucket = 'ERROR';

  SELECT count(*) INTO v_errors FROM _chunk_rows WHERE action_bucket = 'ERROR';

  INSERT INTO public.migration_staging_rows (
    institution_id, job_id, row_number, source_key,
    raw_payload, normalized_payload, validation_status, validation_messages, target_record_id
  )
  SELECT
    p_institution_id, p_job_id, row_num, source_key,
    raw_payload, norm_payload, 'SKIPPED', messages, existing_target_id
  FROM _chunk_rows
  WHERE action_bucket = 'SKIP'
  ON CONFLICT (job_id, row_number) DO UPDATE
    SET validation_status = 'SKIPPED', target_record_id = EXCLUDED.target_record_id;

  SELECT count(*) INTO v_skipped FROM _chunk_rows WHERE action_bucket = 'SKIP';

  IF p_import_mode = 'OVERWRITE' THEN
    UPDATE public.students st
    SET
      is_temporary_registration = c.is_temp,
      full_name = c.full_name,
      email = c.email,
      phone = c.phone,
      dob = c.dob,
      updated_by = v_actor_id
    FROM _chunk_rows c
    WHERE c.action_bucket = 'IMPORT'
      AND st.institution_id = p_institution_id
      AND st.deleted_at IS NULL
      AND upper(st.registration_number) = c.reg_no;
  END IF;

  INSERT INTO public.students (
    institution_id, registration_number, is_temporary_registration,
    full_name, email, phone, dob, created_by, updated_by
  )
  SELECT DISTINCT ON (c.reg_no)
    p_institution_id, c.reg_no, c.is_temp,
    c.full_name, c.email, c.phone, c.dob, v_actor_id, v_actor_id
  FROM _chunk_rows c
  WHERE c.action_bucket = 'IMPORT'
    AND NOT EXISTS (
      SELECT 1 FROM public.students st
      WHERE st.institution_id = p_institution_id
        AND st.deleted_at IS NULL
        AND upper(st.registration_number) = c.reg_no
    )
  ORDER BY c.reg_no, c.row_num;

  INSERT INTO public.academic_batches (
    institution_id, program_id, code, name, admission_year, scheme_batch, created_by, updated_by
  )
  SELECT DISTINCT
    p_institution_id,
    p.id,
    p.code || '-' || c.admission_year::text,
    p.code || ' ' || c.admission_year::text || ' Batch',
    c.admission_year,
    c.scheme_batch,
    v_actor_id,
    v_actor_id
  FROM _chunk_rows c
  JOIN public.programs p
    ON p.institution_id = p_institution_id AND p.deleted_at IS NULL AND upper(p.code) = c.branch_code
  WHERE c.action_bucket = 'IMPORT'
  ON CONFLICT (institution_id, program_id, code) DO NOTHING;

  INSERT INTO public.program_specializations (
    institution_id, program_id, code, name, is_default, created_by, updated_by
  )
  SELECT DISTINCT
    p_institution_id,
    p.id,
    c.specialization,
    CASE WHEN c.specialization = 'GENERAL' THEN 'General Track' ELSE c.specialization END,
    c.specialization = 'GENERAL',
    v_actor_id,
    v_actor_id
  FROM _chunk_rows c
  JOIN public.programs p
    ON p.institution_id = p_institution_id AND p.deleted_at IS NULL AND upper(p.code) = c.branch_code
  WHERE c.action_bucket = 'IMPORT'
  ON CONFLICT (program_id, code) DO NOTHING;

  INSERT INTO public.academic_sections (
    institution_id, program_id, academic_batch_id, academic_period_id,
    academic_year, section_name, created_by, updated_by
  )
  SELECT DISTINCT ON (p.id, ap.id, c.section_name)
    p_institution_id,
    p.id,
    ab.id,
    ap.id,
    v_active_ay,
    c.section_name,
    v_actor_id,
    v_actor_id
  FROM _chunk_rows c
  JOIN public.programs p
    ON p.institution_id = p_institution_id AND p.deleted_at IS NULL AND upper(p.code) = c.branch_code
  JOIN LATERAL (
    SELECT ap1.id
    FROM public.academic_periods ap1
    JOIN public.academic_period_types apt ON apt.id = ap1.period_type_id
    WHERE ap1.institution_id = p_institution_id
      AND COALESCE(ap1.legacy_semester_id, ap1.sequence_number) = c.current_sem
    ORDER BY (ap1.legacy_semester_id = c.current_sem) DESC NULLS LAST,
             (apt.code = 'SEMESTER') DESC,
             ap1.sequence_number
    LIMIT 1
  ) ap ON c.current_sem IS NOT NULL
  LEFT JOIN public.academic_batches ab
    ON ab.institution_id = p_institution_id AND ab.program_id = p.id AND ab.code = p.code || '-' || c.admission_year::text
  WHERE c.action_bucket = 'IMPORT'
    AND c.section_name IS NOT NULL
    AND c.current_sem IS NOT NULL
  ORDER BY p.id, ap.id, c.section_name, ab.id
  ON CONFLICT (institution_id, academic_year, program_id, academic_period_id, section_name) DO NOTHING;

  IF p_import_mode = 'OVERWRITE' THEN
    UPDATE public.student_enrollments se
    SET
      program_specialization_id = ps.id,
      academic_batch_id = ab.id,
      current_period_id = ap.id,
      academic_section_id = asec.id,
      student_category = c.student_category,
      updated_by = v_actor_id
    FROM _chunk_rows c
    JOIN public.students st
      ON st.institution_id = p_institution_id AND st.deleted_at IS NULL AND upper(st.registration_number) = c.reg_no
    JOIN public.programs p
      ON p.institution_id = p_institution_id AND p.deleted_at IS NULL AND upper(p.code) = c.branch_code
    LEFT JOIN public.program_specializations ps
      ON ps.program_id = p.id AND ps.code = c.specialization
    LEFT JOIN public.academic_batches ab
      ON ab.institution_id = p_institution_id AND ab.program_id = p.id AND ab.code = p.code || '-' || c.admission_year::text
    LEFT JOIN LATERAL (
      SELECT ap1.id
      FROM public.academic_periods ap1
      JOIN public.academic_period_types apt ON apt.id = ap1.period_type_id
      WHERE ap1.institution_id = p_institution_id
        AND COALESCE(ap1.legacy_semester_id, ap1.sequence_number) = c.current_sem
      ORDER BY (ap1.legacy_semester_id = c.current_sem) DESC NULLS LAST,
               (apt.code = 'SEMESTER') DESC,
               ap1.sequence_number
      LIMIT 1
    ) ap ON c.current_sem IS NOT NULL
    LEFT JOIN public.academic_sections asec
      ON asec.institution_id = p_institution_id
      AND asec.academic_year = v_active_ay
      AND asec.program_id = p.id
      AND asec.academic_period_id = ap.id
      AND asec.section_name = c.section_name
    WHERE c.action_bucket = 'IMPORT'
      AND se.student_id = st.id
      AND se.program_id = p.id
      AND se.is_current = true;
  END IF;

  INSERT INTO public.student_enrollments (
    institution_id, student_id, program_id, program_specialization_id,
    academic_batch_id, current_period_id, academic_section_id,
    student_category, is_current, created_by, updated_by
  )
  SELECT DISTINCT ON (st.id, p.id)
    p_institution_id,
    st.id,
    p.id,
    ps.id,
    ab.id,
    ap.id,
    asec.id,
    c.student_category,
    true,
    v_actor_id,
    v_actor_id
  FROM _chunk_rows c
  JOIN public.students st
    ON st.institution_id = p_institution_id AND st.deleted_at IS NULL AND upper(st.registration_number) = c.reg_no
  JOIN public.programs p
    ON p.institution_id = p_institution_id AND p.deleted_at IS NULL AND upper(p.code) = c.branch_code
  LEFT JOIN public.program_specializations ps
    ON ps.program_id = p.id AND ps.code = c.specialization
  LEFT JOIN public.academic_batches ab
    ON ab.institution_id = p_institution_id AND ab.program_id = p.id AND ab.code = p.code || '-' || c.admission_year::text
  LEFT JOIN LATERAL (
    SELECT ap1.id
    FROM public.academic_periods ap1
    JOIN public.academic_period_types apt ON apt.id = ap1.period_type_id
    WHERE ap1.institution_id = p_institution_id
      AND COALESCE(ap1.legacy_semester_id, ap1.sequence_number) = c.current_sem
    ORDER BY (ap1.legacy_semester_id = c.current_sem) DESC NULLS LAST,
             (apt.code = 'SEMESTER') DESC,
             ap1.sequence_number
    LIMIT 1
  ) ap ON c.current_sem IS NOT NULL
  LEFT JOIN public.academic_sections asec
    ON asec.institution_id = p_institution_id
    AND asec.academic_year = v_active_ay
    AND asec.program_id = p.id
    AND asec.academic_period_id = ap.id
    AND asec.section_name = c.section_name
  WHERE c.action_bucket = 'IMPORT'
    AND NOT EXISTS (
      SELECT 1 FROM public.student_enrollments se
      WHERE se.student_id = st.id
        AND se.program_id = p.id
        AND se.is_current = true
    )
  ORDER BY st.id, p.id, c.row_num;

  INSERT INTO public.migration_staging_rows (
    institution_id, job_id, row_number, source_key,
    raw_payload, normalized_payload, validation_status, validation_messages, target_record_id
  )
  SELECT
    p_institution_id, p_job_id, c.row_num, c.source_key,
    c.raw_payload, c.norm_payload, 'IMPORTED', '[]'::jsonb, st.id
  FROM _chunk_rows c
  JOIN public.students st
    ON st.institution_id = p_institution_id AND st.deleted_at IS NULL AND upper(st.registration_number) = c.reg_no
  WHERE c.action_bucket = 'IMPORT'
  ON CONFLICT (job_id, row_number) DO UPDATE
    SET validation_status = 'IMPORTED', target_record_id = EXCLUDED.target_record_id;

  INSERT INTO public.migration_mappings (
    institution_id, source_id, entity_type, source_key, target_table, target_id, last_job_id
  )
  SELECT DISTINCT ON (c.source_key)
    p_institution_id, p_source_id, 'STUDENTS', c.source_key, 'students', st.id, p_job_id
  FROM _chunk_rows c
  JOIN public.students st
    ON st.institution_id = p_institution_id AND st.deleted_at IS NULL AND upper(st.registration_number) = c.reg_no
  WHERE c.action_bucket = 'IMPORT'
  ORDER BY c.source_key, c.row_num
  ON CONFLICT (institution_id, source_id, entity_type, source_key) DO UPDATE
    SET target_id = EXCLUDED.target_id, last_job_id = EXCLUDED.last_job_id;

  SELECT count(*) INTO v_imported FROM _chunk_rows WHERE action_bucket = 'IMPORT';

  RETURN jsonb_build_object(
    'imported', v_imported,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_import_students_chunk(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_import_students_chunk(uuid, uuid, uuid, text, jsonb) TO authenticated;
