-- ============================================================================
-- Phase 2 / Milestone M12: Course-Branch Answer Script Bundles, Confidential
-- Decoding, Evaluator Marks Entry & Result Processing (CIE + SEE + SGPA)
-- ============================================================================

-- 1. Course-Branch Answer Script Bundles (No room names; supports UG, PG & USN series splits)
CREATE TABLE IF NOT EXISTS public.exam_script_bundles (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  effective_course_code text NOT NULL,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  program_code text NOT NULL,
  program_level text DEFAULT 'UG' NOT NULL,
  usn_series_prefix text,
  bundle_code text NOT NULL,
  bundle_sequence integer DEFAULT 1 NOT NULL CHECK (bundle_sequence >= 1),
  max_bundle_size integer DEFAULT 30 NOT NULL CHECK (max_bundle_size > 0),
  script_count integer DEFAULT 0 NOT NULL CHECK (script_count >= 0),
  see_max_marks numeric(6,2) DEFAULT 100 NOT NULL CHECK (see_max_marks > 0),
  see_scale_to numeric(6,2) DEFAULT 50 NOT NULL CHECK (see_scale_to > 0),
  evaluator_staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  evaluator_name text,
  status text DEFAULT 'CREATED' NOT NULL CHECK (status IN ('CREATED', 'DISPATCHED', 'EVALUATED', 'DECODED', 'LOCKED')),
  dispatched_at timestamp with time zone,
  evaluated_at timestamp with time zone,
  decoded_at timestamp with time zone,
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_script_bundles_cycle_code UNIQUE (exam_cycle_id, bundle_code)
);

CREATE INDEX IF NOT EXISTS idx_exam_script_bundles_inst_cycle
  ON public.exam_script_bundles (institution_id, exam_cycle_id, effective_course_code, program_code);

-- 2. Confidential Script Coding / Decoding Table (Dummy Code <-> USN; COE/Admin Restricted)
CREATE TABLE IF NOT EXISTS public.exam_bundle_scripts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  bundle_id uuid NOT NULL REFERENCES public.exam_script_bundles(id) ON DELETE CASCADE,
  seat_allotment_id uuid REFERENCES public.exam_seat_allotments(id) ON DELETE SET NULL,
  registration_id uuid NOT NULL REFERENCES public.exam_registrations(id) ON DELETE CASCADE,
  registration_course_id uuid NOT NULL REFERENCES public.exam_registration_courses(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  script_sequence integer NOT NULL CHECK (script_sequence >= 1),
  dummy_code text NOT NULL,
  booklet_number text,
  see_marks_raw numeric(6,2) CHECK (see_marks_raw IS NULL OR see_marks_raw >= 0),
  see_marks_scaled numeric(6,2) CHECK (see_marks_scaled IS NULL OR see_marks_scaled >= 0),
  is_absent boolean DEFAULT false NOT NULL,
  is_malpractice boolean DEFAULT false NOT NULL,
  evaluation_status text DEFAULT 'PENDING' NOT NULL CHECK (evaluation_status IN ('PENDING', 'ENTERED', 'VERIFIED', 'DECODED')),
  evaluator_remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_bundle_scripts_cycle_dummy UNIQUE (exam_cycle_id, dummy_code),
  CONSTRAINT uq_exam_bundle_scripts_cycle_reg_course UNIQUE (exam_cycle_id, registration_course_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_bundle_scripts_bundle_seq
  ON public.exam_bundle_scripts (bundle_id, script_sequence);

CREATE INDEX IF NOT EXISTS idx_exam_bundle_scripts_cycle_student
  ON public.exam_bundle_scripts (institution_id, exam_cycle_id, student_id);

-- 3. Course-Level Results Ledger (CIE + Decoded SEE + Total + Grade)
CREATE TABLE IF NOT EXISTS public.exam_course_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.exam_registrations(id) ON DELETE CASCADE,
  registration_course_id uuid NOT NULL REFERENCES public.exam_registration_courses(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  effective_course_code text NOT NULL,
  credits numeric(4,2) DEFAULT 3.0 NOT NULL CHECK (credits >= 0),
  is_online_exempt boolean DEFAULT false NOT NULL,
  cie_marks numeric(6,2) CHECK (cie_marks IS NULL OR cie_marks >= 0),
  cie_max_marks numeric(6,2) DEFAULT 50 NOT NULL CHECK (cie_max_marks >= 0),
  see_marks numeric(6,2) CHECK (see_marks IS NULL OR see_marks >= 0),
  see_max_marks numeric(6,2) DEFAULT 50 NOT NULL CHECK (see_max_marks >= 0),
  total_marks numeric(6,2) CHECK (total_marks IS NULL OR total_marks >= 0),
  max_total_marks numeric(6,2) DEFAULT 100 NOT NULL CHECK (max_total_marks > 0),
  percentage numeric(5,2),
  grade_code text,
  grade_point numeric(4,2),
  result_status text DEFAULT 'PENDING' NOT NULL CHECK (result_status IN ('PENDING', 'PASS', 'FAIL', 'ABSENT', 'MALPRACTICE', 'EXEMPT', 'WITHHELD')),
  source_bundle_id uuid REFERENCES public.exam_script_bundles(id) ON DELETE SET NULL,
  is_published boolean DEFAULT false NOT NULL,
  published_at timestamp with time zone,
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_course_results_cycle_reg_course UNIQUE (exam_cycle_id, registration_course_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_course_results_inst_cycle
  ON public.exam_course_results (institution_id, exam_cycle_id, program_id, effective_course_code);

CREATE INDEX IF NOT EXISTS idx_exam_course_results_student
  ON public.exam_course_results (exam_cycle_id, student_id);

-- 4. Student Semester / Cycle Consolidated Results (SGPA & Publication Ledger)
CREATE TABLE IF NOT EXISTS public.exam_semester_results (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.exam_registrations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  academic_period_id uuid REFERENCES public.academic_periods(id),
  total_courses integer DEFAULT 0 NOT NULL,
  passed_courses integer DEFAULT 0 NOT NULL,
  failed_courses integer DEFAULT 0 NOT NULL,
  credits_registered numeric(6,2) DEFAULT 0 NOT NULL,
  credits_earned numeric(6,2) DEFAULT 0 NOT NULL,
  total_grade_points numeric(8,2) DEFAULT 0 NOT NULL,
  sgpa numeric(4,2) DEFAULT 0 NOT NULL,
  overall_status text DEFAULT 'PENDING' NOT NULL CHECK (overall_status IN ('PENDING', 'PASS', 'FAIL', 'WITHHELD')),
  is_published boolean DEFAULT false NOT NULL,
  published_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_semester_results_cycle_student UNIQUE (exam_cycle_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_semester_results_inst_cycle
  ON public.exam_semester_results (institution_id, exam_cycle_id, program_id, is_published);

-- 5. Triggers (updated_at + audit logging on bundles and semester results)
CREATE TRIGGER trg_exam_script_bundles_updated_at
  BEFORE UPDATE ON public.exam_script_bundles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_script_bundles_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_script_bundles
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_exam_bundle_scripts_updated_at
  BEFORE UPDATE ON public.exam_bundle_scripts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_course_results_updated_at
  BEFORE UPDATE ON public.exam_course_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_semester_results_updated_at
  BEFORE UPDATE ON public.exam_semester_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_semester_results_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_semester_results
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

-- 6. Row Level Security
ALTER TABLE public.exam_script_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_bundle_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_course_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_semester_results ENABLE ROW LEVEL SECURITY;

-- exam_script_bundles policies
CREATE POLICY exam_script_bundles_select ON public.exam_script_bundles
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_script_bundles_insert ON public.exam_script_bundles
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_script_bundles_update ON public.exam_script_bundles
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id))
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_script_bundles_delete ON public.exam_script_bundles
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_bundle_scripts policies (Confidential Dummy Code <-> USN mapping restricted to COE / Institution Admin)
CREATE POLICY exam_bundle_scripts_select ON public.exam_bundle_scripts
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_bundle_scripts_insert ON public.exam_bundle_scripts
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_bundle_scripts_update ON public.exam_bundle_scripts
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id))
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_bundle_scripts_delete ON public.exam_bundle_scripts
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_course_results policies (Academic/Dept admins can enter CIE; Institution Admin/COE can delete/publish)
CREATE POLICY exam_course_results_select ON public.exam_course_results
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_course_results_insert ON public.exam_course_results
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_course_results_update ON public.exam_course_results
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_course_results_delete ON public.exam_course_results
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_semester_results policies
CREATE POLICY exam_semester_results_select ON public.exam_semester_results
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_semester_results_insert ON public.exam_semester_results
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_semester_results_update ON public.exam_semester_results
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id))
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_semester_results_delete ON public.exam_semester_results
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));
