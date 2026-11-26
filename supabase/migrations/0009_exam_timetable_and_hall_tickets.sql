-- ============================================================================
-- Phase 2 / Milestone M10: Exam Timetable Slots, Appearing Lists & Hall Tickets
-- ============================================================================

-- 1. Exam Timetable Slots (One scheduled slot per course per exam cycle)
CREATE TABLE IF NOT EXISTS public.exam_timetable_slots (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  exam_date date NOT NULL,
  session_code text DEFAULT 'FN' NOT NULL CHECK (session_code IN ('FN', 'AN', 'CUSTOM')),
  start_time time NOT NULL,
  end_time time NOT NULL,
  duration_hours numeric(4,2) DEFAULT 3.0 NOT NULL CHECK (duration_hours > 0),
  is_omr_exam boolean DEFAULT false NOT NULL,
  qp_code text,
  remarks text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_timetable_cycle_course UNIQUE (exam_cycle_id, course_id),
  CONSTRAINT chk_exam_timetable_time CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_exam_timetable_inst_cycle_date
  ON public.exam_timetable_slots (institution_id, exam_cycle_id, exam_date, session_code);

-- 2. Hall Tickets Ledger
CREATE TABLE IF NOT EXISTS public.hall_tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.exam_registrations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  ticket_number text NOT NULL,
  verification_code text NOT NULL,
  status text DEFAULT 'ISSUED' NOT NULL CHECK (status IN ('ISSUED', 'WITHHELD', 'REVOKED')),
  withheld_reason text,
  eligible_course_count integer DEFAULT 0 NOT NULL CHECK (eligible_course_count >= 0),
  print_count integer DEFAULT 0 NOT NULL CHECK (print_count >= 0),
  last_printed_at timestamp with time zone,
  issued_by uuid REFERENCES auth.users(id),
  issued_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_hall_tickets_cycle_student UNIQUE (exam_cycle_id, student_id),
  CONSTRAINT uq_hall_tickets_inst_number UNIQUE (institution_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_hall_tickets_inst_cycle_status
  ON public.hall_tickets (institution_id, exam_cycle_id, status);

CREATE INDEX IF NOT EXISTS idx_hall_tickets_student
  ON public.hall_tickets (student_id);

-- 3. Set-Based Bulk Hall Ticket Issuance RPC
CREATE OR REPLACE FUNCTION public.issue_hall_tickets_for_cycle(
  p_institution_id uuid,
  p_exam_cycle_id uuid,
  p_require_paid boolean DEFAULT true,
  p_program_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_cycle_code text;
  v_issued integer := 0;
  v_updated integer := 0;
  v_skipped_ineligible integer := 0;
BEGIN
  IF v_actor_id IS NULL OR NOT (
    public.is_platform_admin() OR public.is_institution_admin(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: COE or Institution Admin privileges required to issue hall tickets.';
  END IF;

  SELECT upper(regexp_replace(code, '[^A-Za-z0-9]+', '', 'g'))
  INTO v_cycle_code
  FROM public.exam_cycles
  WHERE id = p_exam_cycle_id
    AND institution_id = p_institution_id
    AND deleted_at IS NULL;

  IF v_cycle_code IS NULL THEN
    RAISE EXCEPTION 'Exam cycle % not found for institution %.', p_exam_cycle_id, p_institution_id;
  END IF;

  -- Refresh eligible course counts on already-issued tickets
  WITH eligible_counts AS (
    SELECT
      er.id AS registration_id,
      count(erc.id)::integer AS eligible_cnt
    FROM public.exam_registrations er
    LEFT JOIN public.exam_registration_courses erc
      ON erc.registration_id = er.id
     AND erc.is_online_exempt = false
     AND erc.eligibility_status = 'ELIGIBLE'
    WHERE er.institution_id = p_institution_id
      AND er.exam_cycle_id = p_exam_cycle_id
      AND er.status = 'APPROVED'
      AND (NOT p_require_paid OR er.payment_status IN ('PAID', 'WAIVED'))
      AND (p_program_id IS NULL OR er.program_id = p_program_id)
    GROUP BY er.id
  ),
  refreshed AS (
    UPDATE public.hall_tickets ht
    SET
      eligible_course_count = ec.eligible_cnt,
      updated_by = v_actor_id
    FROM eligible_counts ec
    WHERE ht.registration_id = ec.registration_id
      AND ht.exam_cycle_id = p_exam_cycle_id
      AND ht.eligible_course_count <> ec.eligible_cnt
    RETURNING ht.id
  )
  SELECT count(*) INTO v_updated FROM refreshed;

  -- Issue new hall tickets for approved registrations with >= 1 eligible written/lab course
  WITH candidates AS (
    SELECT
      er.id AS registration_id,
      er.student_id,
      upper(trim(s.registration_number)) AS reg_no,
      count(erc.id)::integer AS eligible_cnt
    FROM public.exam_registrations er
    JOIN public.students s ON s.id = er.student_id AND s.deleted_at IS NULL
    LEFT JOIN public.exam_registration_courses erc
      ON erc.registration_id = er.id
     AND erc.is_online_exempt = false
     AND erc.eligibility_status = 'ELIGIBLE'
    WHERE er.institution_id = p_institution_id
      AND er.exam_cycle_id = p_exam_cycle_id
      AND er.status = 'APPROVED'
      AND (NOT p_require_paid OR er.payment_status IN ('PAID', 'WAIVED'))
      AND (p_program_id IS NULL OR er.program_id = p_program_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.hall_tickets ht
        WHERE ht.exam_cycle_id = p_exam_cycle_id
          AND ht.student_id = er.student_id
      )
    GROUP BY er.id, er.student_id, s.registration_number
  ),
  inserted AS (
    INSERT INTO public.hall_tickets (
      institution_id,
      exam_cycle_id,
      registration_id,
      student_id,
      ticket_number,
      verification_code,
      status,
      eligible_course_count,
      issued_by,
      created_by,
      updated_by
    )
    SELECT
      p_institution_id,
      p_exam_cycle_id,
      c.registration_id,
      c.student_id,
      'HT-' || v_cycle_code || '-' || c.reg_no,
      upper(substr(md5(gen_random_uuid()::text || c.registration_id::text || clock_timestamp()::text), 1, 12)),
      'ISSUED',
      c.eligible_cnt,
      v_actor_id,
      v_actor_id,
      v_actor_id
    FROM candidates c
    WHERE c.eligible_cnt > 0
    ON CONFLICT (exam_cycle_id, student_id) DO NOTHING
    RETURNING id
  )
  SELECT
    (SELECT count(*) FROM inserted),
    (SELECT count(*) FROM candidates WHERE eligible_cnt = 0)
  INTO v_issued, v_skipped_ineligible;

  RETURN jsonb_build_object(
    'issued', v_issued,
    'refreshed', v_updated,
    'skipped_no_eligible_courses', v_skipped_ineligible
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_hall_tickets_for_cycle(uuid, uuid, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_hall_tickets_for_cycle(uuid, uuid, boolean, uuid) TO authenticated;

-- 4. Print Audit Counter RPC
CREATE OR REPLACE FUNCTION public.record_hall_ticket_prints(
  p_institution_id uuid,
  p_ticket_ids uuid[]
)
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
    public.is_platform_admin() OR public.can_manage_academics(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Academic or Exam staff privileges required.';
  END IF;

  UPDATE public.hall_tickets
  SET
    print_count = print_count + 1,
    last_printed_at = timezone('utc'::text, now()),
    updated_by = v_actor_id
  WHERE institution_id = p_institution_id
    AND id = ANY(p_ticket_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_hall_ticket_prints(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_hall_ticket_prints(uuid, uuid[]) TO authenticated;

-- 5. Triggers (updated_at + audit_logs)
CREATE TRIGGER trg_exam_timetable_slots_updated_at
  BEFORE UPDATE ON public.exam_timetable_slots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_timetable_slots_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_timetable_slots
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_hall_tickets_updated_at
  BEFORE UPDATE ON public.hall_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_hall_tickets_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.hall_tickets
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

-- 6. Row Level Security
ALTER TABLE public.exam_timetable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hall_tickets ENABLE ROW LEVEL SECURITY;

-- exam_timetable_slots policies
CREATE POLICY exam_timetable_slots_select ON public.exam_timetable_slots
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_timetable_slots_insert ON public.exam_timetable_slots
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_timetable_slots_update ON public.exam_timetable_slots
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_timetable_slots_delete ON public.exam_timetable_slots
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- hall_tickets policies
CREATE POLICY hall_tickets_select ON public.hall_tickets
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY hall_tickets_insert ON public.hall_tickets
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY hall_tickets_update ON public.hall_tickets
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id))
  WITH CHECK (is_platform_admin() OR is_institution_admin(institution_id));

CREATE POLICY hall_tickets_delete ON public.hall_tickets
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));
