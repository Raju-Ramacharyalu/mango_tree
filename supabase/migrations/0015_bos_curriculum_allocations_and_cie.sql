-- ============================================================================
-- Phase 4A / Migration 0015: BOS Curriculum Master (Syllabi, COs, CO-PO,
-- CIE Rubrics), Classroom Section Allocations, Faculty 360 Leave/Onboarding,
-- and Verified CIE Pipeline with Automatic M12 Results Sync
-- ============================================================================

-- 1. Platform-Wide Bloom's Taxonomy Reference Catalog
CREATE TABLE IF NOT EXISTS public.platform_blooms_taxonomy (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  level_number integer NOT NULL CHECK (level_number BETWEEN 1 AND 6),
  name text NOT NULL,
  action_verbs text NOT NULL
);

INSERT INTO public.platform_blooms_taxonomy (code, level_number, name, action_verbs)
VALUES
  ('L1', 1, 'L1 - Remember',   'Define, List, Recall, Identify, Name, State, Recognize'),
  ('L2', 2, 'L2 - Understand', 'Explain, Describe, Summarize, Classify, Discuss, Interpret, Compare'),
  ('L3', 3, 'L3 - Apply',      'Apply, Solve, Compute, Demonstrate, Implement, Calculate, Illustrate'),
  ('L4', 4, 'L4 - Analyze',    'Analyze, Differentiate, Examine, Investigate, Contrast, Categorize, Deduce'),
  ('L5', 5, 'L5 - Evaluate',   'Evaluate, Justify, Critique, Assess, Validate, Defend, Recommend'),
  ('L6', 6, 'L6 - Create',     'Design, Formulate, Construct, Develop, Propose, Synthesize, Architect')
ON CONFLICT (code) DO NOTHING;

-- 2. BOS Course Syllabi (Theory / Lab / Integrated / Project)
CREATE TABLE IF NOT EXISTS public.course_syllabi (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  term text NOT NULL CHECK (term IN ('ODD', 'EVEN', 'SUMMER')),
  syllabus_type text DEFAULT 'THEORY' NOT NULL CHECK (
    syllabus_type IN ('THEORY', 'LAB', 'INTEGRATED', 'PROJECT')
  ),
  modules_json jsonb DEFAULT '[]'::jsonb NOT NULL,
  lab_part_a text DEFAULT '' NOT NULL,
  lab_part_b text DEFAULT '' NOT NULL,
  project_phases_json jsonb DEFAULT '[]'::jsonb NOT NULL,
  textbooks text DEFAULT '' NOT NULL,
  reference_books text DEFAULT '' NOT NULL,
  approval_status text DEFAULT 'DRAFT' NOT NULL CHECK (
    approval_status IN ('DRAFT', 'HOD_REVIEW', 'BOS_APPROVED', 'PUBLISHED')
  ),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_course_syllabi_term UNIQUE (institution_id, course_id, academic_year, term)
);

-- 3. Course Outcomes (COs) & Normalized 12-PO / 3-PSO Mapping Matrix
CREATE TABLE IF NOT EXISTS public.course_outcomes (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  term text NOT NULL CHECK (term IN ('ODD', 'EVEN', 'SUMMER')),
  co_code text NOT NULL,
  description text NOT NULL,
  target_bloom_level text DEFAULT '' NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_course_outcomes_code UNIQUE (institution_id, course_id, academic_year, term, co_code)
);

CREATE TABLE IF NOT EXISTS public.course_co_po_mappings (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  course_outcome_id uuid NOT NULL REFERENCES public.course_outcomes(id) ON DELETE CASCADE,
  outcome_code text NOT NULL,
  correlation_level integer NOT NULL CHECK (correlation_level BETWEEN 1 AND 3),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_co_po_mapping UNIQUE (course_outcome_id, outcome_code)
);

-- 4. CIE Evaluation Rubrics per Course & Term
CREATE TABLE IF NOT EXISTS public.course_evaluation_rubrics (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  term text NOT NULL CHECK (term IN ('ODD', 'EVEN', 'SUMMER')),
  component_name text NOT NULL,
  component_type text NOT NULL CHECK (
    component_type IN (
      'THEORY_TEST', 'CCA_ACTIVITY', 'LAB_RECORD',
      'LAB_INTERNAL', 'PROJECT_PHASE', 'SEMINAR_PRESENTATION'
    )
  ),
  max_marks integer DEFAULT 0 NOT NULL CHECK (max_marks >= 0),
  scaled_to integer DEFAULT 0 NOT NULL CHECK (scaled_to >= 0),
  calculation_logic text DEFAULT 'SUM' NOT NULL CHECK (
    calculation_logic IN ('AVERAGE_BEST_2', 'AVERAGE_ALL', 'SUM', 'SCALE_DOWN')
  ),
  sort_order integer DEFAULT 0 NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_rubrics_lookup
  ON public.course_evaluation_rubrics (institution_id, course_id, academic_year, term);

-- 5. Classroom Section Allocations (HOD / First-Year Dean)
CREATE TABLE IF NOT EXISTS public.course_section_allocations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid REFERENCES public.exam_cycles(id) ON DELETE SET NULL,
  academic_year text NOT NULL,
  term text NOT NULL CHECK (term IN ('ODD', 'EVEN', 'SUMMER')),
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  academic_period_id uuid REFERENCES public.academic_periods(id) ON DELETE SET NULL,
  semester_number integer NOT NULL CHECK (semester_number >= 1),
  section_name text NOT NULL,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  course_code text NOT NULL,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  faculty_code text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_course_section_alloc
    UNIQUE (institution_id, academic_year, term, program_id, semester_number, section_name, course_id)
);

CREATE INDEX IF NOT EXISTS idx_course_section_alloc_inst
  ON public.course_section_allocations (institution_id, academic_year, term, program_id);

CREATE INDEX IF NOT EXISTS idx_course_section_alloc_staff
  ON public.course_section_allocations (institution_id, staff_profile_id);

-- 6. Faculty Planned Leave Logs (Faculty 360 HR Operations)
CREATE TABLE IF NOT EXISTS public.faculty_leave_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  leave_type text DEFAULT 'CASUAL' NOT NULL CHECK (
    leave_type IN ('CASUAL', 'MEDICAL', 'FDP', 'MATERNITY', 'ON_DUTY', 'OTHER')
  ),
  reason text,
  status text DEFAULT 'RECORDED' NOT NULL CHECK (status IN ('RECORDED', 'APPROVED', 'CANCELLED')),
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT chk_faculty_leave_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_faculty_leave_logs_inst
  ON public.faculty_leave_logs (institution_id, staff_profile_id, start_date DESC);

-- 7. Verified CIE Submissions & Student CIE Marks
CREATE TABLE IF NOT EXISTS public.cie_submissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid REFERENCES public.exam_cycles(id) ON DELETE SET NULL,
  allocation_id uuid REFERENCES public.course_section_allocations(id) ON DELETE SET NULL,
  academic_year text NOT NULL,
  term text NOT NULL CHECK (term IN ('ODD', 'EVEN', 'SUMMER')),
  program_id uuid NOT NULL REFERENCES public.programs(id) ON DELETE CASCADE,
  academic_unit_id uuid REFERENCES public.academic_units(id) ON DELETE SET NULL,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  course_code text NOT NULL,
  semester_number integer NOT NULL CHECK (semester_number >= 1),
  section_name text NOT NULL,
  staff_profile_id uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  faculty_code text NOT NULL,
  max_cie_marks numeric(5,2) DEFAULT 50 NOT NULL CHECK (max_cie_marks > 0),
  status text DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED')),
  submitted_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by uuid REFERENCES auth.users(id),
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_cie_submission_section
    UNIQUE (institution_id, academic_year, term, program_id, semester_number, section_name, course_id)
);

CREATE INDEX IF NOT EXISTS idx_cie_submissions_inst_status
  ON public.cie_submissions (institution_id, status, semester_number);

CREATE TABLE IF NOT EXISTS public.cie_marks (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES public.cie_submissions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  usn text NOT NULL,
  theory_marks numeric(5,2) DEFAULT 0 NOT NULL CHECK (theory_marks >= 0),
  practical_marks numeric(5,2) DEFAULT 0 NOT NULL CHECK (practical_marks >= 0),
  total_marks numeric(5,2) DEFAULT 0 NOT NULL CHECK (total_marks >= 0),
  is_absent boolean DEFAULT false NOT NULL,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_cie_marks_student UNIQUE (submission_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_cie_marks_submission
  ON public.cie_marks (submission_id, usn);

-- 8. RPC: Onboard Faculty into staff_profiles (HOD / Dean / Admin)
CREATE OR REPLACE FUNCTION public.onboard_department_faculty(
  p_institution_id uuid,
  p_employee_code text,
  p_full_name text,
  p_designation text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_academic_unit_id uuid DEFAULT NULL,
  p_department_label text DEFAULT NULL,
  p_branch_label text DEFAULT NULL,
  p_is_evaluator boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_clean_code text := upper(trim(COALESCE(p_employee_code, '')));
  v_clean_name text := trim(COALESCE(p_full_name, ''));
  v_staff_id uuid;
BEGIN
  IF v_actor_id IS NULL OR NOT (
    public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR public.can_manage_academics(p_institution_id)
    OR public.has_institution_role(
      p_institution_id,
      ARRAY['HOD', 'DEAN_ACADEMICS', 'DEAN_FIRST_YEAR', 'PRINCIPAL_DIRECTOR', 'DEPT_ADMIN']
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Lead Team or Institution Admin privileges required to onboard faculty.';
  END IF;

  IF v_clean_code = '' OR v_clean_name = '' THEN
    RAISE EXCEPTION 'Faculty Employee Code and Full Name are required.';
  END IF;

  INSERT INTO public.staff_profiles (
    institution_id, academic_unit_id, employee_code, full_name, email, phone,
    designation, department_label, branch_label, is_evaluator, is_active,
    created_by, updated_by
  )
  VALUES (
    p_institution_id,
    p_academic_unit_id,
    v_clean_code,
    v_clean_name,
    NULLIF(lower(trim(COALESCE(p_email, ''))), ''),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    COALESCE(NULLIF(trim(p_designation), ''), 'Assistant Professor'),
    NULLIF(trim(COALESCE(p_department_label, '')), ''),
    NULLIF(upper(trim(COALESCE(p_branch_label, ''))), ''),
    COALESCE(p_is_evaluator, false),
    true,
    v_actor_id,
    v_actor_id
  )
  RETURNING id INTO v_staff_id;

  RETURN v_staff_id;
END;
$$;

REVOKE ALL ON FUNCTION public.onboard_department_faculty(uuid, text, text, text, text, text, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboard_department_faculty(uuid, text, text, text, text, text, uuid, text, text, boolean) TO authenticated;

-- 9. RPC: Approve & Lock CIE Submission + Auto-Sync Verified CIE Marks into M12 exam_course_results
CREATE OR REPLACE FUNCTION public.approve_and_sync_cie_submission(
  p_institution_id uuid,
  p_submission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sub record;
  v_marks_count integer := 0;
  v_synced_count integer := 0;
BEGIN
  IF v_actor_id IS NULL OR NOT (
    public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR public.is_lead_team(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Lead Team (HOD / Dean / Principal / COE) privileges required to approve CIE marks.';
  END IF;

  SELECT *
  INTO v_sub
  FROM public.cie_submissions
  WHERE id = p_submission_id
    AND institution_id = p_institution_id;

  IF v_sub.id IS NULL THEN
    RAISE EXCEPTION 'CIE submission % not found in institution.', p_submission_id;
  END IF;

  UPDATE public.cie_submissions
  SET
    status = 'APPROVED',
    approved_at = timezone('utc'::text, now()),
    approved_by = v_actor_id,
    updated_by = v_actor_id
  WHERE id = p_submission_id
    AND institution_id = p_institution_id;

  SELECT count(*) INTO v_marks_count
  FROM public.cie_marks
  WHERE submission_id = p_submission_id;

  -- Sync approved CIE scores directly into M12 exam_course_results when an exam_cycle_id is linked
  IF v_sub.exam_cycle_id IS NOT NULL THEN
    UPDATE public.exam_course_results ecr
    SET
      cie_marks = CASE WHEN cm.is_absent THEN 0 ELSE cm.total_marks END,
      updated_by = v_actor_id
    FROM public.cie_marks cm
    WHERE cm.submission_id = p_submission_id
      AND ecr.institution_id = p_institution_id
      AND ecr.exam_cycle_id = v_sub.exam_cycle_id
      AND ecr.student_id = cm.student_id
      AND ecr.course_id = v_sub.course_id;

    GET DIAGNOSTICS v_synced_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'submission_id', p_submission_id,
    'status', 'APPROVED',
    'total_students', v_marks_count,
    'synced_to_m12', v_synced_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_and_sync_cie_submission(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_and_sync_cie_submission(uuid, uuid) TO authenticated;

-- 10. Triggers (updated_at + audit_logs)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'course_syllabi',
    'course_outcomes',
    'course_evaluation_rubrics',
    'course_section_allocations',
    'faculty_leave_logs',
    'cie_submissions',
    'cie_marks'
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

-- 11. Row Level Security
ALTER TABLE public.platform_blooms_taxonomy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_blooms_select ON public.platform_blooms_taxonomy;
CREATE POLICY platform_blooms_select ON public.platform_blooms_taxonomy
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.course_syllabi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_co_po_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_evaluation_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_section_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_leave_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cie_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cie_marks ENABLE ROW LEVEL SECURITY;

-- Institutional read access for all tenant members; scoped write access for Lead Team / Academic roles
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'course_syllabi',
    'course_outcomes',
    'course_co_po_mappings',
    'course_evaluation_rubrics',
    'course_section_allocations',
    'faculty_leave_logs',
    'cie_submissions',
    'cie_marks'
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

-- BOS & Allocations Write Policies (Lead Team + Academic Admin)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'course_syllabi',
    'course_outcomes',
    'course_co_po_mappings',
    'course_evaluation_rubrics',
    'course_section_allocations',
    'faculty_leave_logs'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (is_platform_admin() OR can_manage_academics(institution_id) OR is_lead_team(institution_id)) WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id) OR is_lead_team(institution_id))',
      t, t
    );
  END LOOP;
END;
$$;

-- CIE Submissions & Marks Write Policies (Lead Team + Faculty + Dept Coordinators)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cie_submissions', 'cie_marks']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (is_platform_admin() OR is_lead_team(institution_id) OR has_institution_role(institution_id, ARRAY[''FACULTY'', ''DEPT_COORDINATOR'', ''EXAM_STAFF''])) WITH CHECK (is_platform_admin() OR is_lead_team(institution_id) OR has_institution_role(institution_id, ARRAY[''FACULTY'', ''DEPT_COORDINATOR'', ''EXAM_STAFF'']))',
      t, t
    );
  END LOOP;
END;
$$;

-- Immediate Verification
SELECT 'tables' AS kind, count(*)::text AS total, string_agg(table_name, ', ' ORDER BY table_name) AS found
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'platform_blooms_taxonomy',
    'course_syllabi',
    'course_outcomes',
    'course_co_po_mappings',
    'course_evaluation_rubrics',
    'course_section_allocations',
    'faculty_leave_logs',
    'cie_submissions',
    'cie_marks'
  )
UNION ALL
SELECT 'rpcs' AS kind, count(*)::text AS total, string_agg(routine_name, ', ' ORDER BY routine_name) AS found
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('onboard_department_faculty', 'approve_and_sync_cie_submission');
