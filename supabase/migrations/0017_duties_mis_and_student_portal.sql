-- ============================================================================
-- Phase 5 / Migration 0017: Exam Duty Nominations, Date/Session Invigilation,
-- FIFO Evaluation Queue, and Tenant-Scoped Authenticated Student Portal RPC
-- ============================================================================

-- 1. HOD / Dept Exam Duty Nominations (Invigilation & Course Evaluation)
CREATE TABLE IF NOT EXISTS public.exam_duty_nominations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  faculty_code text NOT NULL,
  faculty_name text NOT NULL,
  designation text DEFAULT 'Assistant Professor' NOT NULL,
  department_name text DEFAULT 'General' NOT NULL,
  duty_type text NOT NULL CHECK (duty_type IN ('INVIGILATION', 'EVALUATION', 'BOTH')),
  course_id uuid REFERENCES public.course_catalog(id) ON DELETE SET NULL,
  course_code text,
  available_from date,
  available_to date,
  nomination_status text DEFAULT 'NOMINATED' NOT NULL CHECK (
    nomination_status IN ('NOMINATED', 'APPROVED', 'WITHDRAWN')
  ),
  nominated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_duty_nom_cycle_staff_type_course
  ON public.exam_duty_nominations (
    institution_id, exam_cycle_id, staff_profile_id, duty_type, COALESCE(course_code, '')
  );

CREATE INDEX IF NOT EXISTS idx_exam_duty_nom_inst_cycle_fifo
  ON public.exam_duty_nominations (institution_id, exam_cycle_id, duty_type, nominated_at ASC);

-- 2. COE Date & Session Invigilation Duties (DCS, Relievers & Room Invigilators)
CREATE TABLE IF NOT EXISTS public.exam_invigilation_duties (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  exam_date date NOT NULL,
  session_code text DEFAULT 'FN' NOT NULL CHECK (session_code IN ('FN', 'AN', 'CUSTOM')),
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  faculty_code text NOT NULL,
  faculty_name text NOT NULL,
  designation text DEFAULT 'Assistant Professor' NOT NULL,
  department_name text DEFAULT 'General' NOT NULL,
  duty_role text DEFAULT 'INVIGILATOR' NOT NULL CHECK (
    duty_role IN ('DCS', 'RELIEVER', 'INVIGILATOR')
  ),
  room_id uuid REFERENCES public.exam_rooms(id) ON DELETE SET NULL,
  room_number text,
  status text DEFAULT 'ASSIGNED' NOT NULL CHECK (
    status IN ('ASSIGNED', 'CONFIRMED', 'COMPLETED', 'EXCUSED')
  ),
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_invigilation_no_double_book
    UNIQUE (exam_cycle_id, exam_date, session_code, staff_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_invig_inst_cycle_date
  ON public.exam_invigilation_duties (institution_id, exam_cycle_id, exam_date, session_code);

-- 3. COE FIFO Evaluation Duties by Course
CREATE TABLE IF NOT EXISTS public.exam_evaluation_duties (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  course_code text NOT NULL,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  faculty_code text NOT NULL,
  faculty_name text NOT NULL,
  designation text DEFAULT 'Assistant Professor' NOT NULL,
  department_name text DEFAULT 'General' NOT NULL,
  fifo_rank integer DEFAULT 1 NOT NULL CHECK (fifo_rank >= 1),
  assigned_bundles_count integer DEFAULT 0 NOT NULL CHECK (assigned_bundles_count >= 0),
  assigned_scripts_count integer DEFAULT 0 NOT NULL CHECK (assigned_scripts_count >= 0),
  status text DEFAULT 'INVITED' NOT NULL CHECK (
    status IN ('INVITED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED')
  ),
  invited_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  completed_at timestamp with time zone,
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_eval_duty_cycle_course_staff
    UNIQUE (exam_cycle_id, course_id, staff_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_eval_inst_cycle_course
  ON public.exam_evaluation_duties (institution_id, exam_cycle_id, course_code, fifo_rank);

-- 4. RPC: Tenant-Scoped Authenticated Student Portal Snapshot
--    Students strictly see ONLY their own record (matched by user_id or email).
--    Staff / Lead Team / Admins may pass p_preview_usn to inspect any student view.
CREATE OR REPLACE FUNCTION public.get_student_portal_snapshot(
  p_institution_id uuid,
  p_exam_cycle_id uuid DEFAULT NULL,
  p_preview_usn text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_user_email text;
  v_can_preview boolean := false;
  v_student record;
  v_cycle record;
  v_reg record;
  v_ht record;
  v_sem_res record;
  v_courses jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  v_can_preview := (
    public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR public.is_lead_team(p_institution_id)
    OR public.has_institution_role(p_institution_id, ARRAY['EXAM_STAFF', 'DEPT_COORDINATOR', 'FACULTY'])
  );

  SELECT email INTO v_user_email
  FROM public.user_profiles
  WHERE id = v_uid;

  IF p_preview_usn IS NOT NULL AND trim(p_preview_usn) <> '' THEN
    IF NOT v_can_preview THEN
      RAISE EXCEPTION 'Unauthorized: Students may only view their own portal record.';
    END IF;

    SELECT
      s.id, s.registration_number, s.admission_number, s.full_name, s.email, s.phone,
      s.photo_url, s.photo_pin,
      p.code AS program_code, p.name AS program_name,
      COALESCE(ap.legacy_semester_id, ap.sequence_number, 1) AS current_sem,
      asec.section_name,
      COALESCE(se.student_category, 'REGULAR') AS student_category
    INTO v_student
    FROM public.students s
    LEFT JOIN public.student_enrollments se ON se.student_id = s.id AND se.is_current = true
    LEFT JOIN public.programs p ON p.id = se.program_id
    LEFT JOIN public.academic_periods ap ON ap.id = se.current_period_id
    LEFT JOIN public.academic_sections asec ON asec.id = se.academic_section_id
    WHERE s.institution_id = p_institution_id
      AND s.deleted_at IS NULL
      AND (
        upper(trim(s.registration_number)) = upper(trim(p_preview_usn))
        OR upper(trim(COALESCE(s.admission_number, ''))) = upper(trim(p_preview_usn))
      )
    LIMIT 1;
  ELSE
    SELECT
      s.id, s.registration_number, s.admission_number, s.full_name, s.email, s.phone,
      s.photo_url, s.photo_pin,
      p.code AS program_code, p.name AS program_name,
      COALESCE(ap.legacy_semester_id, ap.sequence_number, 1) AS current_sem,
      asec.section_name,
      COALESCE(se.student_category, 'REGULAR') AS student_category
    INTO v_student
    FROM public.students s
    LEFT JOIN public.student_enrollments se ON se.student_id = s.id AND se.is_current = true
    LEFT JOIN public.programs p ON p.id = se.program_id
    LEFT JOIN public.academic_periods ap ON ap.id = se.current_period_id
    LEFT JOIN public.academic_sections asec ON asec.id = se.academic_section_id
    WHERE s.institution_id = p_institution_id
      AND s.deleted_at IS NULL
      AND (
        s.user_id = v_uid
        OR (v_user_email IS NOT NULL AND lower(trim(COALESCE(s.email, ''))) = lower(trim(v_user_email)))
      )
    ORDER BY (s.user_id = v_uid) DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'can_preview', v_can_preview,
      'reason', CASE
        WHEN p_preview_usn IS NOT NULL AND trim(p_preview_usn) <> '' THEN 'No student matched that USN / Admission Number.'
        ELSE 'Your login account is not yet linked to a student USN. Staff can enter a USN above to preview.'
      END
    );
  END IF;

  -- Resolve target or default active exam cycle
  IF p_exam_cycle_id IS NOT NULL THEN
    SELECT id, code, name, cycle_type, academic_year, status
    INTO v_cycle
    FROM public.exam_cycles
    WHERE id = p_exam_cycle_id
      AND institution_id = p_institution_id
      AND deleted_at IS NULL;
  ELSE
    SELECT id, code, name, cycle_type, academic_year, status
    INTO v_cycle
    FROM public.exam_cycles
    WHERE institution_id = p_institution_id
      AND deleted_at IS NULL
    ORDER BY is_default_active DESC, created_at DESC
    LIMIT 1;
  END IF;

  IF v_cycle.id IS NOT NULL THEN
    SELECT id, registration_type, status, payment_status, payment_reference, total_fee
    INTO v_reg
    FROM public.exam_registrations
    WHERE institution_id = p_institution_id
      AND exam_cycle_id = v_cycle.id
      AND student_id = v_student.id
    LIMIT 1;

    SELECT id, ticket_number, verification_code, status, withheld_reason, eligible_course_count, issued_at
    INTO v_ht
    FROM public.hall_tickets
    WHERE institution_id = p_institution_id
      AND exam_cycle_id = v_cycle.id
      AND student_id = v_student.id
    LIMIT 1;

    IF v_reg.id IS NOT NULL THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'course_id', cc.id,
            'course_code', cc.course_code,
            'course_title', cc.title,
            'credits', cc.default_credits,
            'registration_category', erc.registration_category,
            'eligibility_status', erc.eligibility_status,
            'exam_date', ets.exam_date,
            'session_code', ets.session_code,
            'start_time', ets.start_time,
            'end_time', ets.end_time,
            'is_omr_exam', COALESCE(ets.is_omr_exam, false),
            'room_number', er.room_number,
            'block_name', er.block_name,
            'floor_label', er.floor_label,
            'seat_label', esa.seat_label,
            'attendance_status', esa.attendance_status
          )
          ORDER BY ets.exam_date ASC NULLS LAST, ets.start_time ASC NULLS LAST, cc.course_code ASC
        ),
        '[]'::jsonb
      )
      INTO v_courses
      FROM public.exam_registration_courses erc
      JOIN public.course_catalog cc ON cc.id = erc.course_id
      LEFT JOIN public.exam_timetable_slots ets
        ON ets.exam_cycle_id = v_cycle.id AND ets.course_id = erc.course_id
      LEFT JOIN public.exam_seat_allotments esa
        ON esa.exam_cycle_id = v_cycle.id
        AND esa.student_id = v_student.id
        AND esa.course_id = erc.course_id
      LEFT JOIN public.exam_rooms er ON er.id = esa.room_id
      WHERE erc.registration_id = v_reg.id;
    END IF;

    -- Published Semester & Course Results ONLY
    SELECT total_courses, passed_courses, failed_courses, credits_registered, credits_earned, sgpa, overall_status, published_at
    INTO v_sem_res
    FROM public.exam_semester_results
    WHERE institution_id = p_institution_id
      AND exam_cycle_id = v_cycle.id
      AND student_id = v_student.id
      AND is_published = true
    LIMIT 1;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'course_code', ecr.effective_course_code,
          'course_title', cc.title,
          'credits', ecr.credits,
          'cie_marks', ecr.cie_marks,
          'see_marks', ecr.see_marks,
          'total_marks', ecr.total_marks,
          'grade_code', ecr.grade_code,
          'grade_point', ecr.grade_point,
          'result_status', ecr.result_status
        )
        ORDER BY ecr.effective_course_code ASC
      ),
      '[]'::jsonb
    )
    INTO v_results
    FROM public.exam_course_results ecr
    JOIN public.course_catalog cc ON cc.id = ecr.course_id
    WHERE ecr.institution_id = p_institution_id
      AND ecr.exam_cycle_id = v_cycle.id
      AND ecr.student_id = v_student.id
      AND ecr.is_published = true;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'can_preview', v_can_preview,
    'student', to_jsonb(v_student),
    'cycle', CASE WHEN v_cycle.id IS NOT NULL THEN to_jsonb(v_cycle) ELSE NULL END,
    'registration', CASE WHEN v_reg.id IS NOT NULL THEN to_jsonb(v_reg) ELSE NULL END,
    'hall_ticket', CASE WHEN v_ht.id IS NOT NULL THEN to_jsonb(v_ht) ELSE NULL END,
    'registered_courses', v_courses,
    'semester_result', CASE WHEN v_sem_res.sgpa IS NOT NULL THEN to_jsonb(v_sem_res) ELSE NULL END,
    'course_results', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_portal_snapshot(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_portal_snapshot(uuid, uuid, text) TO authenticated;

-- 5. Triggers (updated_at + audit_logs)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'exam_duty_nominations',
    'exam_invigilation_duties',
    'exam_evaluation_duties'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t, t
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_table_audit()',
      t, t
    );
  END LOOP;
END;
$$;

-- 6. Strict 3-Tier Row Level Security
ALTER TABLE public.exam_duty_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_invigilation_duties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_evaluation_duties ENABLE ROW LEVEL SECURITY;

-- Read access for authenticated institution members (Management, Lead Team, Staff viewing own duties)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'exam_duty_nominations',
    'exam_invigilation_duties',
    'exam_evaluation_duties'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT TO authenticated USING (is_platform_staff() OR is_institution_member(institution_id))',
      t, t
    );
  END LOOP;
END;
$$;

-- Nominations: Lead Team (HOD / Dean / COE / Principal / Admin) + Dept Coordinators
DROP POLICY IF EXISTS exam_duty_nominations_write ON public.exam_duty_nominations;
CREATE POLICY exam_duty_nominations_write ON public.exam_duty_nominations
  FOR ALL TO authenticated
  USING (
    is_platform_admin()
    OR is_lead_team(institution_id)
    OR has_institution_role(institution_id, ARRAY['DEPT_COORDINATOR', 'EXAM_STAFF'])
  )
  WITH CHECK (
    is_platform_admin()
    OR is_lead_team(institution_id)
    OR has_institution_role(institution_id, ARRAY['DEPT_COORDINATOR', 'EXAM_STAFF'])
  );

-- Invigilation & Evaluation Duty Orders: Strictly COE / Principal / Institution Admin / Exam Staff
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_invigilation_duties', 'exam_evaluation_duties']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (is_platform_admin() OR is_institution_admin(institution_id) OR has_institution_role(institution_id, ARRAY[''EXAM_CONTROLLER'', ''PRINCIPAL_DIRECTOR'', ''EXAM_STAFF''])) WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id) OR has_institution_role(institution_id, ARRAY[''EXAM_CONTROLLER'', ''PRINCIPAL_DIRECTOR'', ''EXAM_STAFF'']))',
      t, t
    );
  END LOOP;
END;
$$;

-- Immediate 3-Part Verification
SELECT
  '0017_tables' AS check_type,
  count(*)::text AS found_count,
  '3' AS expected_count,
  string_agg(table_name, ', ' ORDER BY table_name) AS details
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('exam_duty_nominations', 'exam_invigilation_duties', 'exam_evaluation_duties')

UNION ALL

SELECT
  '0017_rpcs' AS check_type,
  count(*)::text AS found_count,
  '1' AS expected_count,
  string_agg(routine_name, ', ') AS details
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_student_portal_snapshot'

UNION ALL

SELECT
  '0017_rls_enabled' AS check_type,
  count(*)::text AS found_count,
  '3' AS expected_count,
  string_agg(c.relname, ', ' ORDER BY c.relname) AS details
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relrowsecurity = true
  AND c.relname IN ('exam_duty_nominations', 'exam_invigilation_duties', 'exam_evaluation_duties');
