-- ============================================================================
-- Migration 0018: Authenticated Multi-Tenant Faculty Portal Snapshot RPC,
-- 4-Digit PIN Reopen RPC for IA QP Vault, and Email-Matched Staff RLS
-- ============================================================================

-- 1. Allow faculty matched by institutional email (in addition to user_id)
--    to read and update their own encrypted IA QP allocations
DROP POLICY IF EXISTS ia_qp_select ON public.ia_qp_allocations;
CREATE POLICY ia_qp_select ON public.ia_qp_allocations
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
    OR EXISTS (
      SELECT 1
      FROM public.staff_profiles sp
      LEFT JOIN public.user_profiles up ON up.id = auth.uid()
      WHERE sp.id = ia_qp_allocations.staff_profile_id
        AND sp.deleted_at IS NULL
        AND (
          sp.user_id = auth.uid()
          OR (
            up.email IS NOT NULL
            AND lower(trim(COALESCE(sp.email, ''))) = lower(trim(up.email))
          )
        )
    )
  );

DROP POLICY IF EXISTS ia_qp_update ON public.ia_qp_allocations;
CREATE POLICY ia_qp_update ON public.ia_qp_allocations
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
    OR EXISTS (
      SELECT 1
      FROM public.staff_profiles sp
      LEFT JOIN public.user_profiles up ON up.id = auth.uid()
      WHERE sp.id = ia_qp_allocations.staff_profile_id
        AND sp.deleted_at IS NULL
        AND (
          sp.user_id = auth.uid()
          OR (
            up.email IS NOT NULL
            AND lower(trim(COALESCE(sp.email, ''))) = lower(trim(up.email))
          )
        )
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
    OR EXISTS (
      SELECT 1
      FROM public.staff_profiles sp
      LEFT JOIN public.user_profiles up ON up.id = auth.uid()
      WHERE sp.id = ia_qp_allocations.staff_profile_id
        AND sp.deleted_at IS NULL
        AND (
          sp.user_id = auth.uid()
          OR (
            up.email IS NOT NULL
            AND lower(trim(COALESCE(sp.email, ''))) = lower(trim(up.email))
          )
        )
    )
  );

-- 2. RPC: Tenant-Scoped Authenticated Faculty Portal Snapshot
--    Faculty see ONLY their own profile, section allocations, approved unsubmitted SEE tasks,
--    invigilation/evaluation duties, and IA QP allocations.
--    Admins / Lead Team / COE may pass p_preview_faculty_code to preview any faculty dashboard.
CREATE OR REPLACE FUNCTION public.get_faculty_portal_snapshot(
  p_institution_id uuid,
  p_exam_cycle_id uuid DEFAULT NULL,
  p_preview_faculty_code text DEFAULT NULL
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
  v_staff record;
  v_cycle record;
  v_pub_key text;
  v_allocations jsonb := '[]'::jsonb;
  v_see_duties jsonb := '[]'::jsonb;
  v_invig_duties jsonb := '[]'::jsonb;
  v_eval_duties jsonb := '[]'::jsonb;
  v_ia_allocations jsonb := '[]'::jsonb;
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
    OR public.has_institution_role(p_institution_id, ARRAY['EXAM_STAFF', 'DEPT_COORDINATOR'])
  );

  SELECT email INTO v_user_email
  FROM public.user_profiles
  WHERE id = v_uid;

  IF p_preview_faculty_code IS NOT NULL AND trim(p_preview_faculty_code) <> '' THEN
    IF NOT v_can_preview THEN
      RAISE EXCEPTION 'Unauthorized: Faculty may only view their own portal record.';
    END IF;

    SELECT
      sp.id, sp.employee_code, sp.full_name, sp.email, sp.phone,
      sp.designation, sp.academic_unit_id, sp.department_label, sp.branch_label,
      (sp.staff_pin IS NOT NULL AND trim(sp.staff_pin) <> '') AS has_pin,
      au.code AS unit_code, au.name AS unit_name
    INTO v_staff
    FROM public.staff_profiles sp
    LEFT JOIN public.academic_units au ON au.id = sp.academic_unit_id
    WHERE sp.institution_id = p_institution_id
      AND sp.deleted_at IS NULL
      AND sp.is_active = true
      AND upper(trim(sp.employee_code)) = upper(trim(p_preview_faculty_code))
    LIMIT 1;
  ELSE
    SELECT
      sp.id, sp.employee_code, sp.full_name, sp.email, sp.phone,
      sp.designation, sp.academic_unit_id, sp.department_label, sp.branch_label,
      (sp.staff_pin IS NOT NULL AND trim(sp.staff_pin) <> '') AS has_pin,
      au.code AS unit_code, au.name AS unit_name
    INTO v_staff
    FROM public.staff_profiles sp
    LEFT JOIN public.academic_units au ON au.id = sp.academic_unit_id
    WHERE sp.institution_id = p_institution_id
      AND sp.deleted_at IS NULL
      AND sp.is_active = true
      AND (
        sp.user_id = v_uid
        OR (v_user_email IS NOT NULL AND lower(trim(COALESCE(sp.email, ''))) = lower(trim(v_user_email)))
      )
    ORDER BY (sp.user_id = v_uid) DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_staff.id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'can_preview', v_can_preview,
      'reason', CASE
        WHEN p_preview_faculty_code IS NOT NULL AND trim(p_preview_faculty_code) <> '' THEN 'No active faculty profile matched that Employee Code.'
        ELSE 'Your account is not linked to an active staff_profiles record yet. Admins/COE can enter a Faculty ID above to preview.'
      END
    );
  END IF;

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

  SELECT public_key_pem INTO v_pub_key
  FROM public.institution_vault_keys
  WHERE institution_id = p_institution_id;

  -- 1. Classroom Section Allocations
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', csa.id,
        'exam_cycle_id', csa.exam_cycle_id,
        'academic_year', csa.academic_year,
        'term', csa.term,
        'program_id', csa.program_id,
        'program_code', p.code,
        'program_name', p.name,
        'academic_unit_id', p.academic_unit_id,
        'semester_number', csa.semester_number,
        'section_name', csa.section_name,
        'course_id', csa.course_id,
        'course_code', csa.course_code,
        'course_title', cc.title,
        'course_type', COALESCE(cat.code, 'STANDARD'),
        'credits', cc.default_credits
      )
      ORDER BY csa.academic_year DESC, csa.semester_number ASC, csa.course_code ASC, csa.section_name ASC
    ),
    '[]'::jsonb
  )
  INTO v_allocations
  FROM public.course_section_allocations csa
  JOIN public.programs p ON p.id = csa.program_id
  JOIN public.course_catalog cc ON cc.id = csa.course_id
  LEFT JOIN public.course_categories cat ON cat.id = cc.course_category_id
  WHERE csa.institution_id = p_institution_id
    AND csa.staff_profile_id = v_staff.id
    AND csa.is_active = true;

  IF v_cycle.id IS NOT NULL THEN
    -- 2. Pending Approved SEE QP Setter Appointments
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', bn.id,
          'course_code', bn.course_code,
          'course_title', COALESCE(cc.title, bn.course_code),
          'department_name', bn.department_name,
          'access_token', bn.access_token,
          'token_expires_at', bn.token_expires_at
        )
        ORDER BY bn.created_at DESC
      ),
      '[]'::jsonb
    )
    INTO v_see_duties
    FROM public.boe_nominations bn
    LEFT JOIN public.course_catalog cc ON cc.id = bn.course_id
    WHERE bn.institution_id = p_institution_id
      AND bn.exam_cycle_id = v_cycle.id
      AND bn.is_selected = true
      AND (
        bn.staff_profile_id = v_staff.id
        OR upper(trim(COALESCE(bn.faculty_code, ''))) = upper(trim(v_staff.employee_code))
        OR (v_staff.email IS NOT NULL AND lower(trim(bn.email)) = lower(trim(v_staff.email)))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.see_submitted_papers sp WHERE sp.nomination_id = bn.id
      );

    -- 3. Active Invigilation Duties
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', idt.id,
          'exam_date', idt.exam_date,
          'session_code', idt.session_code,
          'duty_role', idt.duty_role,
          'room_number', idt.room_number,
          'status', idt.status,
          'remarks', idt.remarks
        )
        ORDER BY idt.exam_date ASC, idt.session_code ASC
      ),
      '[]'::jsonb
    )
    INTO v_invig_duties
    FROM public.exam_invigilation_duties idt
    WHERE idt.institution_id = p_institution_id
      AND idt.exam_cycle_id = v_cycle.id
      AND idt.staff_profile_id = v_staff.id
      AND idt.status <> 'EXCUSED';

    -- 4. Active FIFO Evaluation Duties
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', edt.id,
          'course_code', edt.course_code,
          'course_title', COALESCE(cc.title, edt.course_code),
          'fifo_rank', edt.fifo_rank,
          'assigned_bundles_count', edt.assigned_bundles_count,
          'assigned_scripts_count', edt.assigned_scripts_count,
          'status', edt.status,
          'invited_at', edt.invited_at
        )
        ORDER BY edt.fifo_rank ASC, edt.course_code ASC
      ),
      '[]'::jsonb
    )
    INTO v_eval_duties
    FROM public.exam_evaluation_duties edt
    LEFT JOIN public.course_catalog cc ON cc.id = edt.course_id
    WHERE edt.institution_id = p_institution_id
      AND edt.exam_cycle_id = v_cycle.id
      AND edt.staff_profile_id = v_staff.id
      AND edt.status <> 'DECLINED';

    -- 5. Assigned IA QP Setter Allocations
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', iqa.id,
          'course_id', iqa.course_id,
          'course_code', iqa.course_code,
          'course_title', COALESCE(cc.title, iqa.course_code),
          'course_type', COALESCE(cat.code, 'THEORY'),
          'staff_profile_id', iqa.staff_profile_id,
          'faculty_code', iqa.faculty_code,
          'ia_number', iqa.ia_number,
          'num_sets', iqa.num_sets,
          'qp_pattern', iqa.qp_pattern,
          'max_marks', iqa.max_marks,
          'duration_minutes', iqa.duration_minutes,
          'qp_content', iqa.qp_content,
          'status', iqa.status,
          'updated_at', iqa.updated_at
        )
        ORDER BY iqa.created_at DESC
      ),
      '[]'::jsonb
    )
    INTO v_ia_allocations
    FROM public.ia_qp_allocations iqa
    LEFT JOIN public.course_catalog cc ON cc.id = iqa.course_id
    LEFT JOIN public.course_categories cat ON cat.id = cc.course_category_id
    WHERE iqa.institution_id = p_institution_id
      AND iqa.exam_cycle_id = v_cycle.id
      AND iqa.staff_profile_id = v_staff.id;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'can_preview', v_can_preview,
    'staff', to_jsonb(v_staff),
    'cycle', CASE WHEN v_cycle.id IS NOT NULL THEN to_jsonb(v_cycle) ELSE NULL END,
    'public_key_pem', v_pub_key,
    'allocations', v_allocations,
    'see_duties', v_see_duties,
    'invigilation_duties', v_invig_duties,
    'evaluation_duties', v_eval_duties,
    'ia_allocations', v_ia_allocations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_faculty_portal_snapshot(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_faculty_portal_snapshot(uuid, uuid, text) TO authenticated;

-- 3. RPC: Reopen a SUBMITTED IA Question Paper back to DRAFT via 4-Digit Faculty PIN
CREATE OR REPLACE FUNCTION public.reopen_ia_qp_with_pin(
  p_institution_id uuid,
  p_allocation_id uuid,
  p_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_staff_id uuid;
  v_stored_pin text;
BEGIN
  IF v_uid IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  SELECT iqa.staff_profile_id, sp.staff_pin
  INTO v_staff_id, v_stored_pin
  FROM public.ia_qp_allocations iqa
  JOIN public.staff_profiles sp ON sp.id = iqa.staff_profile_id
  WHERE iqa.id = p_allocation_id
    AND iqa.institution_id = p_institution_id
    AND sp.deleted_at IS NULL;

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'IA allocation not found.';
  END IF;

  IF v_stored_pin IS NULL OR trim(v_stored_pin) <> trim(COALESCE(p_pin, '')) THEN
    RAISE EXCEPTION 'Invalid 4-Digit Faculty PIN.';
  END IF;

  UPDATE public.ia_qp_allocations
  SET status = 'DRAFT', updated_by = v_uid
  WHERE id = p_allocation_id
    AND institution_id = p_institution_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_ia_qp_with_pin(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_ia_qp_with_pin(uuid, uuid, text) TO authenticated;

-- Immediate Verification
SELECT
  '0018_rpcs' AS check_type,
  count(*)::text AS found_count,
  '2' AS expected_count,
  string_agg(routine_name, ', ' ORDER BY routine_name) AS details
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_faculty_portal_snapshot', 'reopen_ia_qp_with_pin');
