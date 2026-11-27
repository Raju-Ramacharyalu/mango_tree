-- ============================================================================
-- Phase 6A / Migration 0019: Revaluation Engine (Favorable Rule + Legal Audit
-- Log), Global Analytics Hub, Student 360° Profile, and Faculty Performance
-- ============================================================================

-- 1. Track raw SEE marks (out of 100) on exam_course_results for Best-of-Two comparisons
ALTER TABLE public.exam_course_results
  ADD COLUMN IF NOT EXISTS see_raw_marks numeric(6,2);

-- 2. Immutable Revaluation & Marks Audit Log
CREATE TABLE IF NOT EXISTS public.marks_audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  usn text NOT NULL,
  course_id uuid REFERENCES public.course_catalog(id) ON DELETE SET NULL,
  course_code text NOT NULL,
  change_type text NOT NULL CHECK (
    change_type IN ('REVAL_UPGRADE', 'REVAL_NO_CHANGE', 'GRACE_APPLIED', 'MANUAL_CORRECTION')
  ),
  old_see numeric(6,2),
  new_see numeric(6,2),
  old_grade text,
  new_grade text,
  evaluator_id text,
  reason text,
  changed_by uuid REFERENCES auth.users(id),
  changed_by_label text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marks_audit_log_inst_cycle
  ON public.marks_audit_log (institution_id, exam_cycle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marks_audit_log_usn
  ON public.marks_audit_log (institution_id, usn);

ALTER TABLE public.marks_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marks_audit_log_select ON public.marks_audit_log;
CREATE POLICY marks_audit_log_select ON public.marks_audit_log
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

DROP POLICY IF EXISTS marks_audit_log_write ON public.marks_audit_log;
CREATE POLICY marks_audit_log_write ON public.marks_audit_log
  FOR ALL TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
  )
  WITH CHECK (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
  );

-- 3. RPC: Atomic Favorable-Rule Revaluation Processor + SGPA Recalculation
CREATE OR REPLACE FUNCTION public.process_revaluation_entry(
  p_institution_id uuid,
  p_exam_cycle_id uuid,
  p_usn text,
  p_course_code text,
  p_new_raw_marks numeric,
  p_evaluator_id text DEFAULT 'COE',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_clean_usn text := upper(trim(COALESCE(p_usn, '')));
  v_clean_course text := upper(trim(COALESCE(p_course_code, '')));
  v_res record;
  v_is_pg boolean := false;
  v_old_raw numeric(6,2);
  v_new_raw numeric(6,2) := GREATEST(0, LEAST(100, COALESCE(p_new_raw_marks, 0)));
  v_new_scaled numeric(6,2);
  v_new_total numeric(6,2);
  v_min_see numeric(6,2);
  v_min_total numeric(6,2);
  v_new_grade text;
  v_new_gp numeric(4,2);
  v_new_status text;
  v_agg record;
BEGIN
  IF v_actor_id IS NULL OR NOT (
    public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR public.has_institution_role(p_institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
  ) THEN
    RAISE EXCEPTION 'Unauthorized: COE, Principal, or Institution Admin privileges required.';
  END IF;

  SELECT COALESCE(full_name, email, 'COE') INTO v_actor_email
  FROM public.user_profiles
  WHERE id = v_actor_id;

  SELECT
    ecr.*,
    s.registration_number,
    p.code AS program_code,
    p.name AS program_name
  INTO v_res
  FROM public.exam_course_results ecr
  JOIN public.students s ON s.id = ecr.student_id
  LEFT JOIN public.programs p ON p.id = ecr.program_id
  WHERE ecr.institution_id = p_institution_id
    AND ecr.exam_cycle_id = p_exam_cycle_id
    AND upper(trim(s.registration_number)) = v_clean_usn
    AND upper(trim(ecr.effective_course_code)) = v_clean_course
  LIMIT 1;

  IF v_res.id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'upgraded', false,
      'message', format('No existing result found for %s in %s for this cycle.', v_clean_usn, v_clean_course)
    );
  END IF;

  v_is_pg := upper(COALESCE(v_res.program_code, '') || ' ' || COALESCE(v_res.program_name, '')) ~ '(MBA|MCA|M\.?TECH|M\.?SC|\bPG\b)';
  v_min_see := CASE WHEN v_is_pg THEN 20 ELSE 18 END;
  v_min_total := CASE WHEN v_is_pg THEN 50 ELSE 40 END;
  v_old_raw := COALESCE(v_res.see_raw_marks, COALESCE(v_res.see_marks, 0) * 2);

  IF v_new_raw > v_old_raw THEN
    v_new_scaled := ceil(v_new_raw / 2.0);
    v_new_total := COALESCE(v_res.cie_marks, 0) + v_new_scaled;

    IF v_new_scaled < v_min_see OR v_new_total < v_min_total THEN
      v_new_grade := 'F'; v_new_gp := 0; v_new_status := 'FAIL';
    ELSIF v_new_total >= 90 THEN
      v_new_grade := 'O'; v_new_gp := 10; v_new_status := 'PASS';
    ELSIF v_new_total >= 80 THEN
      v_new_grade := 'A+'; v_new_gp := 9; v_new_status := 'PASS';
    ELSIF v_new_total >= 70 THEN
      v_new_grade := 'A'; v_new_gp := 8; v_new_status := 'PASS';
    ELSIF v_new_total >= 60 THEN
      v_new_grade := 'B+'; v_new_gp := 7; v_new_status := 'PASS';
    ELSIF v_new_total >= 55 THEN
      v_new_grade := 'B'; v_new_gp := 6; v_new_status := 'PASS';
    ELSIF v_new_total >= 50 THEN
      v_new_grade := 'C'; v_new_gp := 5; v_new_status := 'PASS';
    ELSIF v_new_total >= 40 AND NOT v_is_pg THEN
      v_new_grade := 'P'; v_new_gp := 4; v_new_status := 'PASS';
    ELSE
      v_new_grade := 'F'; v_new_gp := 0; v_new_status := 'FAIL';
    END IF;

    UPDATE public.exam_course_results
    SET
      see_raw_marks = v_new_raw,
      see_marks = v_new_scaled,
      total_marks = v_new_total,
      percentage = LEAST(100, round((v_new_total / GREATEST(COALESCE(max_total_marks, 100), 1)) * 100, 2)),
      grade_code = v_new_grade,
      grade_point = v_new_gp,
      result_status = v_new_status,
      updated_by = v_actor_id
    WHERE id = v_res.id;

    -- Atomically recompute semester SGPA for this student & cycle
    SELECT
      count(*) AS total_c,
      count(*) FILTER (WHERE result_status IN ('PASS', 'EXEMPT')) AS passed_c,
      count(*) FILTER (WHERE result_status IN ('FAIL', 'ABSENT', 'MALPRACTICE')) AS failed_c,
      COALESCE(sum(credits), 0) AS cr_reg,
      COALESCE(sum(credits) FILTER (WHERE result_status IN ('PASS', 'EXEMPT')), 0) AS cr_earned,
      COALESCE(sum(credits * COALESCE(grade_point, 0)), 0) AS tot_gp
    INTO v_agg
    FROM public.exam_course_results
    WHERE institution_id = p_institution_id
      AND exam_cycle_id = p_exam_cycle_id
      AND student_id = v_res.student_id;

    UPDATE public.exam_semester_results
    SET
      total_courses = v_agg.total_c,
      passed_courses = v_agg.passed_c,
      failed_courses = v_agg.failed_c,
      credits_registered = v_agg.cr_reg,
      credits_earned = v_agg.cr_earned,
      total_grade_points = v_agg.tot_gp,
      sgpa = CASE WHEN v_agg.cr_reg > 0 THEN round(v_agg.tot_gp / v_agg.cr_reg, 2) ELSE 0 END,
      overall_status = CASE WHEN v_agg.failed_c > 0 THEN 'FAIL' ELSE 'PASS' END,
      updated_by = v_actor_id
    WHERE institution_id = p_institution_id
      AND exam_cycle_id = p_exam_cycle_id
      AND student_id = v_res.student_id;

    INSERT INTO public.marks_audit_log (
      institution_id, exam_cycle_id, student_id, usn, course_id, course_code,
      change_type, old_see, new_see, old_grade, new_grade,
      evaluator_id, reason, changed_by, changed_by_label
    )
    VALUES (
      p_institution_id, p_exam_cycle_id, v_res.student_id, v_clean_usn, v_res.course_id, v_clean_course,
      'REVAL_UPGRADE', v_old_raw, v_new_raw, v_res.grade_code, v_new_grade,
      COALESCE(NULLIF(trim(p_evaluator_id), ''), 'COE'),
      COALESCE(NULLIF(trim(p_reason), ''), 'Revaluation - Favorable Rule Applied'),
      v_actor_id, v_actor_email
    );

    RETURN jsonb_build_object(
      'found', true,
      'upgraded', true,
      'usn', v_clean_usn,
      'course_code', v_clean_course,
      'old_see', v_old_raw,
      'new_see', v_new_raw,
      'old_grade', v_res.grade_code,
      'new_grade', v_new_grade,
      'message', format('UPGRADED: %s (%s) %s -> %s. New Grade: %s.', v_clean_usn, v_clean_course, v_old_raw, v_new_raw, v_new_grade)
    );
  ELSE
    INSERT INTO public.marks_audit_log (
      institution_id, exam_cycle_id, student_id, usn, course_id, course_code,
      change_type, old_see, new_see, old_grade, new_grade,
      evaluator_id, reason, changed_by, changed_by_label
    )
    VALUES (
      p_institution_id, p_exam_cycle_id, v_res.student_id, v_clean_usn, v_res.course_id, v_clean_course,
      'REVAL_NO_CHANGE', v_old_raw, v_new_raw, v_res.grade_code, v_res.grade_code,
      COALESCE(NULLIF(trim(p_evaluator_id), ''), 'COE'),
      COALESCE(NULLIF(trim(p_reason), ''), 'Revaluation - Favorable Rule Not Met (No Change)'),
      v_actor_id, v_actor_email
    );

    RETURN jsonb_build_object(
      'found', true,
      'upgraded', false,
      'usn', v_clean_usn,
      'course_code', v_clean_course,
      'old_see', v_old_raw,
      'new_see', v_new_raw,
      'old_grade', v_res.grade_code,
      'new_grade', v_res.grade_code,
      'message', format('NO CHANGE: %s (%s) scored %s vs original %s. Original retained.', v_clean_usn, v_clean_course, v_new_raw, v_old_raw)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.process_revaluation_entry(uuid, uuid, text, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_revaluation_entry(uuid, uuid, text, text, numeric, text, text) TO authenticated;

-- 4. RPC: Institutional Overview Demographics & Cycle Lifecycle
CREATE OR REPLACE FUNCTION public.get_analytics_overview(p_institution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_ug integer := 0;
  v_pg integer := 0;
  v_active_cycles integer := 0;
  v_closed_cycles integer := 0;
  v_branches jsonb := '[]'::jsonb;
  v_cycle_statuses jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE NOT (upper(COALESCE(p.code, '') || ' ' || COALESCE(p.name, '')) ~ '(MBA|MCA|M\.?TECH|M\.?SC|\bPG\b)')),
    count(*) FILTER (WHERE upper(COALESCE(p.code, '') || ' ' || COALESCE(p.name, '')) ~ '(MBA|MCA|M\.?TECH|M\.?SC|\bPG\b)')
  INTO v_total, v_ug, v_pg
  FROM public.students s
  LEFT JOIN public.student_enrollments se ON se.student_id = s.id AND se.is_current = true
  LEFT JOIN public.programs p ON p.id = se.program_id
  WHERE s.institution_id = p_institution_id
    AND s.deleted_at IS NULL
    AND s.is_active = true;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('branch', branch, 'count', cnt) ORDER BY cnt DESC),
    '[]'::jsonb
  )
  INTO v_branches
  FROM (
    SELECT COALESCE(p.code, 'UNASSIGNED') AS branch, count(*)::integer AS cnt
    FROM public.students s
    LEFT JOIN public.student_enrollments se ON se.student_id = s.id AND se.is_current = true
    LEFT JOIN public.programs p ON p.id = se.program_id
    WHERE s.institution_id = p_institution_id
      AND s.deleted_at IS NULL
      AND s.is_active = true
    GROUP BY COALESCE(p.code, 'UNASSIGNED')
  ) b;

  SELECT
    count(*) FILTER (WHERE status NOT IN ('CLOSED', 'ARCHIVED')),
    count(*) FILTER (WHERE status IN ('CLOSED', 'ARCHIVED'))
  INTO v_active_cycles, v_closed_cycles
  FROM public.exam_cycles
  WHERE institution_id = p_institution_id
    AND deleted_at IS NULL;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('status', status, 'count', cnt) ORDER BY cnt DESC),
    '[]'::jsonb
  )
  INTO v_cycle_statuses
  FROM (
    SELECT COALESCE(status, 'DRAFT') AS status, count(*)::integer AS cnt
    FROM public.exam_cycles
    WHERE institution_id = p_institution_id
      AND deleted_at IS NULL
    GROUP BY COALESCE(status, 'DRAFT')
  ) cs;

  RETURN jsonb_build_object(
    'total_students', v_total,
    'ug_count', v_ug,
    'pg_count', v_pg,
    'active_cycles', v_active_cycles,
    'closed_cycles', v_closed_cycles,
    'branch_counts', v_branches,
    'cycle_statuses', v_cycle_statuses
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_analytics_overview(uuid) TO authenticated;

-- 5. RPC: Exam Cycle Analytics (Ghost Student Detection, Grade Dist, Branch Pass %)
CREATE OR REPLACE FUNCTION public.get_cycle_analytics(
  p_institution_id uuid,
  p_exam_cycle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats record;
  v_grades jsonb := '[]'::jsonb;
  v_branches jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  SELECT
    count(*)::integer AS total_evals,
    count(*) FILTER (WHERE s.id IS NULL OR s.deleted_at IS NOT NULL)::integer AS ghost_count,
    count(*) FILTER (WHERE ecr.result_status = 'PENDING' OR ecr.grade_code IS NULL OR ecr.grade_code IN ('PND', 'PENDING'))::integer AS pending_evals,
    count(*) FILTER (WHERE ecr.result_status = 'FAIL' OR ecr.grade_code = 'F')::integer AS failed_evals,
    count(*) FILTER (WHERE ecr.result_status IN ('PASS', 'EXEMPT'))::integer AS passed_evals
  INTO v_stats
  FROM public.exam_course_results ecr
  LEFT JOIN public.students s ON s.id = ecr.student_id
  WHERE ecr.institution_id = p_institution_id
    AND ecr.exam_cycle_id = p_exam_cycle_id;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('grade', grade, 'count', cnt) ORDER BY ord),
    '[]'::jsonb
  )
  INTO v_grades
  FROM (
    SELECT
      COALESCE(ecr.grade_code, 'PND') AS grade,
      count(*)::integer AS cnt,
      array_position(ARRAY['O','A+','A','B+','B','C','P','F','AB','MP','NE','PND'], COALESCE(ecr.grade_code, 'PND')) AS ord
    FROM public.exam_course_results ecr
    WHERE ecr.institution_id = p_institution_id
      AND ecr.exam_cycle_id = p_exam_cycle_id
      AND ecr.result_status <> 'PENDING'
      AND COALESCE(ecr.grade_code, '') NOT IN ('', 'PND', 'PENDING')
    GROUP BY COALESCE(ecr.grade_code, 'PND')
  ) g;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('branch', branch, 'total', tot, 'passed', pas, 'pass_pct', pass_pct) ORDER BY pass_pct DESC),
    '[]'::jsonb
  )
  INTO v_branches
  FROM (
    SELECT
      COALESCE(p.code, 'GHOST') AS branch,
      count(*)::integer AS tot,
      count(*) FILTER (WHERE ecr.result_status IN ('PASS', 'EXEMPT'))::integer AS pas,
      round((count(*) FILTER (WHERE ecr.result_status IN ('PASS', 'EXEMPT'))::numeric / GREATEST(count(*), 1)) * 100, 1) AS pass_pct
    FROM public.exam_course_results ecr
    LEFT JOIN public.programs p ON p.id = ecr.program_id
    WHERE ecr.institution_id = p_institution_id
      AND ecr.exam_cycle_id = p_exam_cycle_id
      AND ecr.result_status <> 'PENDING'
    GROUP BY COALESCE(p.code, 'GHOST')
  ) br;

  RETURN jsonb_build_object(
    'total_evals', COALESCE(v_stats.total_evals, 0),
    'ghost_count', COALESCE(v_stats.ghost_count, 0),
    'pending_evals', COALESCE(v_stats.pending_evals, 0),
    'failed_evals', COALESCE(v_stats.failed_evals, 0),
    'passed_evals', COALESCE(v_stats.passed_evals, 0),
    'pass_pct', CASE
      WHEN (COALESCE(v_stats.total_evals, 0) - COALESCE(v_stats.pending_evals, 0)) > 0
        THEN round((v_stats.passed_evals::numeric / (v_stats.total_evals - v_stats.pending_evals)) * 100, 1)
      ELSE 0
    END,
    'grade_distribution', v_grades,
    'branch_pass_rates', v_branches
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cycle_analytics(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cycle_analytics(uuid, uuid) TO authenticated;

-- 6. RPC: Student 360° Cumulative Dossier & Semester-Wise Transcript
CREATE OR REPLACE FUNCTION public.get_student_360_profile(
  p_institution_id uuid,
  p_usn text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := upper(trim(COALESCE(p_usn, '')));
  v_stu record;
  v_history jsonb := '[]'::jsonb;
  v_metrics record;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  SELECT
    s.id, s.registration_number, s.admission_number, s.full_name, s.email, s.phone,
    s.photo_url, s.is_active,
    COALESCE(p.code, 'N/A') AS program_code,
    COALESCE(p.name, 'N/A') AS program_name,
    CASE WHEN upper(COALESCE(p.code, '') || ' ' || COALESCE(p.name, '')) ~ '(MBA|MCA|M\.?TECH|M\.?SC|\bPG\b)' THEN 'PG' ELSE 'UG' END AS program_type,
    COALESCE(ap.legacy_semester_id, ap.sequence_number, 1) AS current_sem,
    COALESCE(se.student_category, 'REGULAR') AS student_category
  INTO v_stu
  FROM public.students s
  LEFT JOIN public.student_enrollments se ON se.student_id = s.id AND se.is_current = true
  LEFT JOIN public.programs p ON p.id = se.program_id
  LEFT JOIN public.academic_periods ap ON ap.id = se.current_period_id
  WHERE s.institution_id = p_institution_id
    AND s.deleted_at IS NULL
    AND (
      upper(trim(s.registration_number)) = v_clean
      OR upper(trim(COALESCE(s.admission_number, ''))) = v_clean
    )
  LIMIT 1;

  IF v_stu.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'reason', format('USN "%s" not found in institution.', v_clean));
  END IF;

  -- Latest attempt per course for CGPA, credits, and active backlogs
  WITH ranked AS (
    SELECT
      ecr.course_id,
      ecr.credits,
      COALESCE(ecr.grade_point, 0) AS gp,
      ecr.result_status,
      row_number() OVER (PARTITION BY ecr.course_id ORDER BY ec.created_at DESC, ecr.created_at DESC) AS rn
    FROM public.exam_course_results ecr
    JOIN public.exam_cycles ec ON ec.id = ecr.exam_cycle_id
    WHERE ecr.institution_id = p_institution_id
      AND ecr.student_id = v_stu.id
      AND ecr.result_status <> 'PENDING'
  )
  SELECT
    COALESCE(sum(credits), 0) AS credits_attempted,
    COALESCE(sum(credits) FILTER (WHERE result_status IN ('PASS', 'EXEMPT')), 0) AS credits_earned,
    CASE WHEN COALESCE(sum(credits), 0) > 0 THEN round(sum(gp * credits) / sum(credits), 2) ELSE 0 END AS cgpa,
    count(*) FILTER (WHERE result_status NOT IN ('PASS', 'EXEMPT'))::integer AS active_backlogs
  INTO v_metrics
  FROM ranked
  WHERE rn = 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'cycle_code', ec.code,
        'cycle_name', ec.name,
        'cycle_type', ec.cycle_type,
        'course_code', ecr.effective_course_code,
        'course_title', cc.title,
        'credits', ecr.credits,
        'semester_number', COALESCE(ap.legacy_semester_id, ap.sequence_number, 1),
        'cie_marks', ecr.cie_marks,
        'see_marks', ecr.see_marks,
        'total_marks', ecr.total_marks,
        'grade_code', ecr.grade_code,
        'grade_point', ecr.grade_point,
        'result_status', ecr.result_status,
        'has_reval', EXISTS (
          SELECT 1 FROM public.marks_audit_log mal
          WHERE mal.institution_id = p_institution_id
            AND mal.student_id = v_stu.id
            AND mal.course_code = ecr.effective_course_code
            AND mal.change_type LIKE 'REVAL%'
        ),
        'has_grace', EXISTS (
          SELECT 1 FROM public.marks_audit_log mal
          WHERE mal.institution_id = p_institution_id
            AND mal.student_id = v_stu.id
            AND mal.course_code = ecr.effective_course_code
            AND mal.change_type = 'GRACE_APPLIED'
        )
      )
      ORDER BY COALESCE(ap.legacy_semester_id, ap.sequence_number, 1) ASC, ec.created_at ASC, ecr.effective_course_code ASC
    ),
    '[]'::jsonb
  )
  INTO v_history
  FROM public.exam_course_results ecr
  JOIN public.exam_cycles ec ON ec.id = ecr.exam_cycle_id
  JOIN public.course_catalog cc ON cc.id = ecr.course_id
  LEFT JOIN public.exam_registrations er ON er.id = ecr.registration_id
  LEFT JOIN public.academic_periods ap ON ap.id = er.academic_period_id
  WHERE ecr.institution_id = p_institution_id
    AND ecr.student_id = v_stu.id;

  RETURN jsonb_build_object(
    'found', true,
    'student', to_jsonb(v_stu),
    'metrics', to_jsonb(v_metrics),
    'history', v_history
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_360_profile(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_360_profile(uuid, text) TO authenticated;

-- 7. RPC: Dual-Mode Faculty Performance (Live Section Allocations + Raw Cycle Rows for CSV Override)
CREATE OR REPLACE FUNCTION public.get_faculty_performance_data(
  p_institution_id uuid,
  p_exam_cycle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto jsonb := '[]'::jsonb;
  v_raw jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'faculty_name', faculty_name,
        'faculty_code', faculty_code,
        'course_code', course_code,
        'registered', registered,
        'attended', attended,
        'passed', passed,
        'pass_pct', CASE WHEN attended > 0 THEN round((passed::numeric / attended) * 100, 2) ELSE 0 END
      )
      ORDER BY course_code ASC, pass_pct DESC
    ),
    '[]'::jsonb
  )
  INTO v_auto
  FROM (
    SELECT
      sp.full_name AS faculty_name,
      sp.employee_code AS faculty_code,
      ecr.effective_course_code AS course_code,
      count(*)::integer AS registered,
      count(*) FILTER (WHERE COALESCE(ecr.grade_code, '') NOT IN ('AB', 'NE') AND ecr.result_status <> 'ABSENT')::integer AS attended,
      count(*) FILTER (WHERE ecr.result_status IN ('PASS', 'EXEMPT'))::integer AS passed
    FROM public.exam_course_results ecr
    JOIN public.student_enrollments se
      ON se.student_id = ecr.student_id AND se.institution_id = p_institution_id AND se.is_current = true
    LEFT JOIN public.academic_sections asec ON asec.id = se.academic_section_id
    JOIN public.course_section_allocations csa
      ON csa.institution_id = p_institution_id
      AND csa.course_id = ecr.course_id
      AND csa.program_id = ecr.program_id
      AND csa.is_active = true
      AND (asec.section_name IS NULL OR upper(trim(csa.section_name)) = upper(trim(asec.section_name)))
    JOIN public.staff_profiles sp ON sp.id = csa.staff_profile_id
    WHERE ecr.institution_id = p_institution_id
      AND ecr.exam_cycle_id = p_exam_cycle_id
    GROUP BY sp.full_name, sp.employee_code, ecr.effective_course_code
  ) agg;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'usn', upper(trim(s.registration_number)),
        'course_code', upper(trim(ecr.effective_course_code)),
        'grade_code', COALESCE(ecr.grade_code, ''),
        'is_pass', (ecr.result_status IN ('PASS', 'EXEMPT')),
        'is_attended', (COALESCE(ecr.grade_code, '') NOT IN ('AB', 'NE') AND ecr.result_status <> 'ABSENT')
      )
    ),
    '[]'::jsonb
  )
  INTO v_raw
  FROM public.exam_course_results ecr
  JOIN public.students s ON s.id = ecr.student_id
  WHERE ecr.institution_id = p_institution_id
    AND ecr.exam_cycle_id = p_exam_cycle_id;

  RETURN jsonb_build_object('auto_summary', v_auto, 'raw_results', v_raw);
END;
$$;

REVOKE ALL ON FUNCTION public.get_faculty_performance_data(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_faculty_performance_data(uuid, uuid) TO authenticated;

-- Immediate Verification
SELECT
  '0019_tables' AS check_type,
  count(*)::text AS found_count,
  '1' AS expected_count,
  string_agg(table_name, ', ') AS details
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'marks_audit_log'

UNION ALL

SELECT
  '0019_rpcs' AS check_type,
  count(*)::text AS found_count,
  '5' AS expected_count,
  string_agg(routine_name, ', ' ORDER BY routine_name) AS details
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_analytics_overview',
    'get_cycle_analytics',
    'get_faculty_performance_data',
    'get_student_360_profile',
    'process_revaluation_entry'
  );
