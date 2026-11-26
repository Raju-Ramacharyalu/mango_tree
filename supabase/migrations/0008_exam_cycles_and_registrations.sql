-- ============================================================================
-- Phase 2 / Milestone M9: Multi-Tenant Exam Cycles, Fee Rules & Registrations
-- ============================================================================

-- 1. Exam Cycles
CREATE TABLE IF NOT EXISTS public.exam_cycles (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  academic_year text NOT NULL,
  cycle_type text NOT NULL CHECK (cycle_type IN ('REGULAR', 'ARREAR', 'SUPPLEMENTARY', 'SUMMER', 'ODE', 'MAKEUP')),
  status text DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT', 'REGISTRATION_OPEN', 'LOCKED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED')),
  is_default_active boolean DEFAULT false NOT NULL,
  registration_starts_at timestamp with time zone,
  registration_ends_at timestamp with time zone,
  late_fee_starts_at timestamp with time zone,
  exam_starts_on date,
  exam_ends_on date,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_cycles_inst_code
  ON public.exam_cycles (institution_id, upper(code))
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_cycles_inst_default_active
  ON public.exam_cycles (institution_id)
  WHERE is_default_active = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exam_cycles_inst_status
  ON public.exam_cycles (institution_id, status, created_at DESC);

-- 2. Configurable Exam Fee Rules (Cycle-specific or Institution-wide defaults)
CREATE TABLE IF NOT EXISTS public.exam_fee_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  cycle_type text NOT NULL CHECK (cycle_type IN ('REGULAR', 'ARREAR', 'SUPPLEMENTARY', 'SUMMER', 'ODE', 'MAKEUP')),
  program_level text CHECK (program_level IN ('DIPLOMA', 'UG', 'PG', 'INTEGRATED', 'DOCTORAL', 'CERTIFICATE', 'OTHER')),
  rule_name text NOT NULL,
  currency text DEFAULT 'INR' NOT NULL,
  application_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (application_fee >= 0),
  grade_card_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (grade_card_fee >= 0),
  first_attempt_subject_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (first_attempt_subject_fee >= 0),
  subsequent_attempt_subject_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (subsequent_attempt_subject_fee >= 0),
  online_course_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (online_course_fee >= 0),
  late_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (late_fee >= 0),
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exam_fee_rules_inst_cycle
  ON public.exam_fee_rules (institution_id, exam_cycle_id, cycle_type);

-- 3. Student Exam Registrations (Header)
CREATE TABLE IF NOT EXISTS public.exam_registrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.student_enrollments(id) ON DELETE SET NULL,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  academic_period_id uuid REFERENCES public.academic_periods(id),
  registration_type text NOT NULL CHECK (registration_type IN ('REGULAR', 'ARREAR', 'SUPPLEMENTARY', 'SUMMER', 'ODE', 'MAKEUP')),
  status text DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  application_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (application_fee >= 0),
  grade_card_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (grade_card_fee >= 0),
  subject_fee_total numeric(10,2) DEFAULT 0 NOT NULL CHECK (subject_fee_total >= 0),
  late_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (late_fee >= 0),
  total_fee numeric(10,2) GENERATED ALWAYS AS (application_fee + grade_card_fee + subject_fee_total + late_fee) STORED,
  payment_status text DEFAULT 'PENDING' NOT NULL CHECK (payment_status IN ('PENDING', 'PAID', 'WAIVED', 'REFUNDED')),
  payment_reference text,
  paid_at timestamp with time zone,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamp with time zone,
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_registrations_cycle_student UNIQUE (exam_cycle_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_registrations_inst_cycle
  ON public.exam_registrations (institution_id, exam_cycle_id, status);

CREATE INDEX IF NOT EXISTS idx_exam_registrations_student
  ON public.exam_registrations (student_id);

-- 4. Student Exam Registration Courses (Subject-level rows)
CREATE TABLE IF NOT EXISTS public.exam_registration_courses (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.exam_registrations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  academic_period_id uuid REFERENCES public.academic_periods(id),
  attempt_number integer DEFAULT 1 NOT NULL CHECK (attempt_number >= 1),
  registration_category text DEFAULT 'REGULAR' NOT NULL CHECK (registration_category IN ('REGULAR', 'ARREAR', 'IMPROVEMENT', 'SUMMER', 'ODE')),
  is_online_exempt boolean DEFAULT false NOT NULL,
  subject_fee numeric(10,2) DEFAULT 0 NOT NULL CHECK (subject_fee >= 0),
  eligibility_status text DEFAULT 'ELIGIBLE' NOT NULL CHECK (eligibility_status IN ('ELIGIBLE', 'DETAINED', 'EXEMPT', 'WITHHELD')),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_reg_courses_reg_course UNIQUE (registration_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_reg_courses_cycle_course
  ON public.exam_registration_courses (institution_id, exam_cycle_id, course_id);

CREATE INDEX IF NOT EXISTS idx_exam_reg_courses_student
  ON public.exam_registration_courses (student_id, exam_cycle_id);

-- 5. Auto-flag ONLINE courses as CIE/SEE & seating exempt
CREATE OR REPLACE FUNCTION public.sync_exam_reg_course_online_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_online boolean := false;
BEGIN
  SELECT COALESCE(cat.is_online, false)
  INTO v_is_online
  FROM public.course_catalog cc
  LEFT JOIN public.course_categories cat ON cat.id = cc.course_category_id
  WHERE cc.id = NEW.course_id;

  IF v_is_online THEN
    NEW.is_online_exempt := true;
    IF NEW.eligibility_status = 'ELIGIBLE' THEN
      NEW.eligibility_status := 'EXEMPT';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exam_reg_courses_online_flag ON public.exam_registration_courses;
CREATE TRIGGER trg_exam_reg_courses_online_flag
  BEFORE INSERT OR UPDATE OF course_id ON public.exam_registration_courses
  FOR EACH ROW EXECUTE FUNCTION public.sync_exam_reg_course_online_flag();

-- 6. Standard updated_at & audit triggers
CREATE TRIGGER trg_exam_cycles_updated_at
  BEFORE UPDATE ON public.exam_cycles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_cycles_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_cycles
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_exam_fee_rules_updated_at
  BEFORE UPDATE ON public.exam_fee_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_fee_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_fee_rules
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_exam_registrations_updated_at
  BEFORE UPDATE ON public.exam_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_registrations_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_registrations
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_exam_reg_courses_updated_at
  BEFORE UPDATE ON public.exam_registration_courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_reg_courses_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_registration_courses
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

-- 7. Row Level Security
ALTER TABLE public.exam_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_fee_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_registration_courses ENABLE ROW LEVEL SECURITY;

-- exam_cycles policies
CREATE POLICY exam_cycles_select ON public.exam_cycles
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_cycles_insert ON public.exam_cycles
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_cycles_update ON public.exam_cycles
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id))
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_cycles_delete ON public.exam_cycles
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_fee_rules policies
CREATE POLICY exam_fee_rules_select ON public.exam_fee_rules
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_fee_rules_insert ON public.exam_fee_rules
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_fee_rules_update ON public.exam_fee_rules
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id))
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY exam_fee_rules_delete ON public.exam_fee_rules
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_registrations policies
CREATE POLICY exam_registrations_select ON public.exam_registrations
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_registrations_insert ON public.exam_registrations
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_registrations_update ON public.exam_registrations
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_registrations_delete ON public.exam_registrations
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_registration_courses policies
CREATE POLICY exam_reg_courses_select ON public.exam_registration_courses
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_reg_courses_insert ON public.exam_registration_courses
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_reg_courses_update ON public.exam_registration_courses
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_reg_courses_delete ON public.exam_registration_courses
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));
