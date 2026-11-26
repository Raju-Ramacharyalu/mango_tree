-- ============================================================================
-- Phase 3B / Migration 0014: Front Office (BRS Cash Book, Academic Course
-- Registrations, Summer/ODE Overrides & Student Photo Booth Columns/RPCs)
-- ============================================================================

-- 1. Extend students table for Photo Booth PINs & USN-migration photo fallback
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS admission_number text,
  ADD COLUMN IF NOT EXISTS photo_pin text,
  ADD COLUMN IF NOT EXISTS photo_upload_count integer DEFAULT 0 NOT NULL CHECK (photo_upload_count >= 0),
  ADD COLUMN IF NOT EXISTS last_photo_upload timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_students_inst_admission_number
  ON public.students (institution_id, upper(trim(admission_number)))
  WHERE deleted_at IS NULL AND admission_number IS NOT NULL;

-- 2. Extend exam_registrations & exam_registration_courses for UTR linking,
--    Summer Rule 1–3 categories, and audited Lead-Team 15-credit overrides
ALTER TABLE public.exam_registrations
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS credit_override_approved boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS credit_override_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS credit_override_reason text;

ALTER TABLE public.exam_registration_courses
  ADD COLUMN IF NOT EXISTS rule_category text;

-- 3. Multi-Tenant Cash Book & UTR Receipt Ledger (replaces legacy cash_receipts)
CREATE TABLE IF NOT EXISTS public.fee_receipts (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid REFERENCES public.exam_cycles(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  usn text NOT NULL,
  student_name text NOT NULL,
  program_code text NOT NULL,
  payment_date date DEFAULT CURRENT_DATE NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  payment_type text NOT NULL,
  payment_mode text NOT NULL CHECK (
    payment_mode IN ('UPI (QR / App)', 'Bank Transfer (NEFT / RTGS)', 'SBI Direct', 'CASH', 'DD')
  ),
  utr_number text NOT NULL,
  college_account text NOT NULL,
  verification_status text DEFAULT 'RECORDED' NOT NULL CHECK (
    verification_status IN ('RECORDED', 'VERIFIED', 'RECONCILED', 'REJECTED')
  ),
  linked_registration_id uuid REFERENCES public.exam_registrations(id) ON DELETE SET NULL,
  remarks text,
  entered_by uuid REFERENCES auth.users(id),
  entered_by_name text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT chk_fee_receipts_utr_format CHECK (
    (payment_mode = 'UPI (QR / App)' AND utr_number ~ '^[0-9]{12}$')
    OR (payment_mode = 'Bank Transfer (NEFT / RTGS)' AND utr_number ~ '^[A-Za-z0-9]{22}$')
    OR (payment_mode = 'SBI Direct' AND utr_number ~ '^[A-Za-z0-9]+$')
    OR (payment_mode IN ('CASH', 'DD') AND length(trim(utr_number)) >= 3)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_receipts_inst_utr
  ON public.fee_receipts (institution_id, upper(trim(utr_number)));

CREATE INDEX IF NOT EXISTS idx_fee_receipts_inst_date
  ON public.fee_receipts (institution_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_fee_receipts_inst_usn
  ON public.fee_receipts (institution_id, upper(trim(usn)));

-- 4. Phase 1 Start-of-Semester Academic Course Registrations
CREATE TABLE IF NOT EXISTS public.academic_course_registrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year text NOT NULL,
  term text NOT NULL CHECK (term IN ('ODD', 'EVEN', 'SUMMER')),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  academic_period_id uuid REFERENCES public.academic_periods(id),
  semester_number integer NOT NULL CHECK (semester_number >= 1),
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  course_code text NOT NULL,
  course_type text DEFAULT 'CORE' NOT NULL,
  credits numeric(4,2) DEFAULT 0 NOT NULL CHECK (credits >= 0),
  registration_source text DEFAULT 'MANUAL' NOT NULL CHECK (
    registration_source IN ('MANUAL', 'BULK_CORE', 'CSV_ELECTIVE')
  ),
  status text DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('ACTIVE', 'DROPPED', 'LOCKED')),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_acad_course_reg_term_student_course
    UNIQUE (institution_id, academic_year, term, student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_acad_course_reg_inst_term
  ON public.academic_course_registrations (institution_id, academic_year, term, program_id, semester_number);

-- 5. RPC: Link a Verified Fee Receipt UTR directly to an Exam Registration
CREATE OR REPLACE FUNCTION public.link_fee_receipt_to_registration(
  p_institution_id uuid,
  p_receipt_id uuid,
  p_registration_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_utr text;
  v_amount numeric(10,2);
BEGIN
  IF v_actor_id IS NULL OR NOT (
    public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR public.has_institution_role(
      p_institution_id,
      ARRAY['FINANCE_CLERK', 'FINANCE_CONTROLLER', 'DEPT_COORDINATOR', 'EXAM_STAFF', 'ACADEMIC_ADMIN', 'DEPT_ADMIN']
    )
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Finance or Exam operations role required to reconcile receipts.';
  END IF;

  SELECT upper(trim(utr_number)), amount
  INTO v_utr, v_amount
  FROM public.fee_receipts
  WHERE id = p_receipt_id
    AND institution_id = p_institution_id;

  IF v_utr IS NULL THEN
    RAISE EXCEPTION 'Fee receipt % not found in institution.', p_receipt_id;
  END IF;

  UPDATE public.exam_registrations
  SET
    payment_status = 'PAID',
    payment_reference = v_utr,
    updated_by = v_actor_id
  WHERE id = p_registration_id
    AND institution_id = p_institution_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam registration % not found in institution.', p_registration_id;
  END IF;

  UPDATE public.fee_receipts
  SET
    linked_registration_id = p_registration_id,
    verification_status = 'RECONCILED',
    updated_by = v_actor_id
  WHERE id = p_receipt_id
    AND institution_id = p_institution_id;

  RETURN jsonb_build_object(
    'receipt_id', p_receipt_id,
    'registration_id', p_registration_id,
    'utr_number', v_utr,
    'amount', v_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_fee_receipt_to_registration(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_fee_receipt_to_registration(uuid, uuid, uuid) TO authenticated;

-- 6. RPC: Generate Random 4-Digit Photo Booth PINs for Students Missing One
CREATE OR REPLACE FUNCTION public.generate_missing_student_pins(p_institution_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_actor_id IS NULL OR NOT (
    public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR public.can_manage_academics(p_institution_id)
    OR public.has_institution_role(p_institution_id, ARRAY['DEPT_COORDINATOR', 'EXAM_STAFF'])
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Academic or Exam staff privileges required.';
  END IF;

  UPDATE public.students
  SET
    photo_pin = lpad((1000 + floor(random() * 9000))::integer::text, 4, '0'),
    updated_by = v_actor_id
  WHERE institution_id = p_institution_id
    AND deleted_at IS NULL
    AND (photo_pin IS NULL OR trim(photo_pin) = '');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_missing_student_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_missing_student_pins(uuid) TO authenticated;

-- 7. RPC: Verify Student USN / Admission Number + 4-Digit Photo PIN
CREATE OR REPLACE FUNCTION public.verify_student_photo_pin(
  p_institution_id uuid,
  p_identifier text,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_id text := upper(trim(COALESCE(p_identifier, '')));
  v_clean_pin text := trim(COALESCE(p_pin, ''));
  v_row record;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  SELECT id, registration_number, admission_number, full_name, photo_url, photo_upload_count, last_photo_upload, photo_pin
  INTO v_row
  FROM public.students
  WHERE institution_id = p_institution_id
    AND deleted_at IS NULL
    AND (
      upper(trim(registration_number)) = v_clean_id
      OR upper(trim(COALESCE(admission_number, ''))) = v_clean_id
    )
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'Student USN / Admission No. not found.');
  END IF;

  IF v_row.photo_pin IS NULL OR trim(v_row.photo_pin) <> v_clean_pin THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'Incorrect 4-digit PIN.');
  END IF;

  RETURN jsonb_build_object(
    'matched', true,
    'student_id', v_row.id,
    'registration_number', v_row.registration_number,
    'admission_number', v_row.admission_number,
    'full_name', v_row.full_name,
    'photo_url', v_row.photo_url,
    'photo_upload_count', v_row.photo_upload_count,
    'last_photo_upload', v_row.last_photo_upload
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_student_photo_pin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_student_photo_pin(uuid, text, text) TO authenticated;

-- 8. Triggers (Idempotent)
DROP TRIGGER IF EXISTS trg_fee_receipts_updated_at ON public.fee_receipts;
CREATE TRIGGER trg_fee_receipts_updated_at
  BEFORE UPDATE ON public.fee_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_fee_receipts_audit ON public.fee_receipts;
CREATE TRIGGER trg_fee_receipts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fee_receipts
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

DROP TRIGGER IF EXISTS trg_acad_course_reg_updated_at ON public.academic_course_registrations;
CREATE TRIGGER trg_acad_course_reg_updated_at
  BEFORE UPDATE ON public.academic_course_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_acad_course_reg_audit ON public.academic_course_registrations;
CREATE TRIGGER trg_acad_course_reg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.academic_course_registrations
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

-- 9. Row Level Security
ALTER TABLE public.fee_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_course_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fee_receipts_select ON public.fee_receipts;
CREATE POLICY fee_receipts_select ON public.fee_receipts
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

DROP POLICY IF EXISTS fee_receipts_insert ON public.fee_receipts;
CREATE POLICY fee_receipts_insert ON public.fee_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(
      institution_id,
      ARRAY['FINANCE_CLERK', 'FINANCE_CONTROLLER', 'DEPT_COORDINATOR', 'EXAM_STAFF', 'ACADEMIC_ADMIN', 'DEPT_ADMIN']
    )
  );

DROP POLICY IF EXISTS fee_receipts_update ON public.fee_receipts;
CREATE POLICY fee_receipts_update ON public.fee_receipts
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(
      institution_id,
      ARRAY['FINANCE_CLERK', 'FINANCE_CONTROLLER', 'DEPT_COORDINATOR', 'EXAM_STAFF', 'ACADEMIC_ADMIN', 'DEPT_ADMIN']
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(
      institution_id,
      ARRAY['FINANCE_CLERK', 'FINANCE_CONTROLLER', 'DEPT_COORDINATOR', 'EXAM_STAFF', 'ACADEMIC_ADMIN', 'DEPT_ADMIN']
    )
  );

DROP POLICY IF EXISTS fee_receipts_delete ON public.fee_receipts;
CREATE POLICY fee_receipts_delete ON public.fee_receipts
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

DROP POLICY IF EXISTS acad_course_reg_select ON public.academic_course_registrations;
CREATE POLICY acad_course_reg_select ON public.academic_course_registrations
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

DROP POLICY IF EXISTS acad_course_reg_insert ON public.academic_course_registrations;
CREATE POLICY acad_course_reg_insert ON public.academic_course_registrations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR can_manage_academics(institution_id)
    OR has_institution_role(institution_id, ARRAY['DEPT_COORDINATOR', 'HOD', 'DEAN_ACADEMICS', 'DEAN_FIRST_YEAR', 'EXAM_STAFF'])
  );

DROP POLICY IF EXISTS acad_course_reg_update ON public.academic_course_registrations;
CREATE POLICY acad_course_reg_update ON public.academic_course_registrations
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin()
    OR can_manage_academics(institution_id)
    OR has_institution_role(institution_id, ARRAY['DEPT_COORDINATOR', 'HOD', 'DEAN_ACADEMICS', 'DEAN_FIRST_YEAR', 'EXAM_STAFF'])
  )
  WITH CHECK (
    is_platform_admin()
    OR can_manage_academics(institution_id)
    OR has_institution_role(institution_id, ARRAY['DEPT_COORDINATOR', 'HOD', 'DEAN_ACADEMICS', 'DEAN_FIRST_YEAR', 'EXAM_STAFF'])
  );

DROP POLICY IF EXISTS acad_course_reg_delete ON public.academic_course_registrations;
CREATE POLICY acad_course_reg_delete ON public.academic_course_registrations
  FOR DELETE TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR can_manage_academics(institution_id)
  );

-- Immediate Verification
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('fee_receipts', 'academic_course_registrations')
ORDER BY table_name;
