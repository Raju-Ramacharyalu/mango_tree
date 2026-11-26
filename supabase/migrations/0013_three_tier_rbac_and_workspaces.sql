-- ============================================================================
-- Phase 3A / Migration 0013: Three-Tier Multi-Tenant RBAC, Department-Scoped
-- RLS Helpers, and Automatic Role Seeding for Existing & Future Institutions
-- ============================================================================

-- 1. Extend institution_roles with Tier and Scope metadata (backwards-compatible defaults)
ALTER TABLE public.institution_roles
  ADD COLUMN IF NOT EXISTS role_tier text DEFAULT 'OPERATIONAL' NOT NULL
    CHECK (role_tier IN ('MANAGEMENT', 'LEAD_TEAM', 'OPERATIONAL'));

ALTER TABLE public.institution_roles
  ADD COLUMN IF NOT EXISTS scope_level text DEFAULT 'INSTITUTION' NOT NULL
    CHECK (scope_level IN ('INSTITUTION', 'FIRST_YEAR', 'ACADEMIC_UNIT', 'SELF'));

CREATE INDEX IF NOT EXISTS idx_institution_roles_inst_tier
  ON public.institution_roles (institution_id, role_tier, is_active);

-- 2. Idempotent Seeder Function for All 3-Tier Roles per Institution
CREATE OR REPLACE FUNCTION public.seed_three_tier_institution_roles(p_institution_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH role_catalog(code, name, description, role_tier, scope_level) AS (
    VALUES
      -- Institutional Full Admin (mapped under LEAD_TEAM governance)
      ('INSTITUTION_ADMIN',  'Institution Admin',          'Full administrative control over institution workspace',           'LEAD_TEAM',   'INSTITUTION'),

      -- Tier 1: Management Team
      ('TRUST_ADMIN',        'Trust / Management Admin',   'Board & trust executive oversight across institutional KPIs',      'MANAGEMENT',  'INSTITUTION'),
      ('MANAGEMENT_EXEC',    'Management Executive',       'Executive read access to finance, admissions, MIS & results',      'MANAGEMENT',  'INSTITUTION'),
      ('FINANCE_CONTROLLER', 'Finance Controller',         'Fee reconciliation, cash book scrutiny & institutional budgets',   'MANAGEMENT',  'INSTITUTION'),

      -- Tier 2: Lead Team
      ('PRINCIPAL_DIRECTOR', 'Principal / Director',       'Head of Institution approvals, overrides & executive governance',  'LEAD_TEAM',   'INSTITUTION'),
      ('EXAM_CONTROLLER',    'Controller of Examinations', 'End-to-end exam operations, confidential decoding & QP vault',     'LEAD_TEAM',   'INSTITUTION'),
      ('DEAN_ACADEMICS',     'Dean Academics',             'Institution-wide curriculum, schemes, calendars & CIE oversight',  'LEAD_TEAM',   'INSTITUTION'),
      ('DEAN_FIRST_YEAR',    'Dean First Year',            'First-year (Sem 1 & 2) cross-branch allocations & CIE approvals',  'LEAD_TEAM',   'FIRST_YEAR'),
      ('ACADEMIC_ADVISOR',   'Academic Advisor',           'Academic scrutiny, PAC approvals & scheme compliance',             'LEAD_TEAM',   'INSTITUTION'),
      ('HOD',                'Head of Department (HOD)',   'Department-scoped faculty, allocations, IA verification & BOE',    'LEAD_TEAM',   'ACADEMIC_UNIT'),
      ('BOS_CHAIR',          'BOS Chairperson',            'Board of Studies syllabus, CO-PO matrix & CIE rubric governance',  'LEAD_TEAM',   'ACADEMIC_UNIT'),
      ('BOE_CHAIR',          'BOE Chairperson',            'Board of Examiners setter panels & QP scrutiny nominations',       'LEAD_TEAM',   'ACADEMIC_UNIT'),

      -- Legacy Phase 1 Academic / Dept Admin codes classified cleanly into Lead Team
      ('ACADEMIC_ADMIN',     'Academic Administrator',     'Academic operations & examination coordination',                   'LEAD_TEAM',   'INSTITUTION'),
      ('DEPT_ADMIN',         'Department Administrator',   'Department-scoped academic & registration administration',         'LEAD_TEAM',   'ACADEMIC_UNIT'),

      -- Tier 3: Operational & Self-Service Users
      ('FINANCE_CLERK',      'Accounts / Fee Clerk',       'Desk fee receipt entry & UTR verification',                        'OPERATIONAL', 'INSTITUTION'),
      ('DEPT_COORDINATOR',   'Department Coordinator',     'Course registration, exam applications & student photo tracking',  'OPERATIONAL', 'ACADEMIC_UNIT'),
      ('FACULTY',            'Faculty Member',             'Assigned IA QP drafting, CIE marks entry & invigilation duties',   'OPERATIONAL', 'SELF'),
      ('EVALUATOR',          'Answer Script Evaluator',    'Blind SEE bundle evaluation via dummy script codes only',          'OPERATIONAL', 'SELF'),
      ('STUDENT',            'Student',                    'Self-service Photo Booth, Temp ID, Hall Tickets & Grade Cards',    'OPERATIONAL', 'SELF')
  ),
  updated AS (
    UPDATE public.institution_roles ir
    SET
      role_tier = rc.role_tier,
      scope_level = rc.scope_level,
      description = COALESCE(NULLIF(ir.description, ''), rc.description),
      is_system = true
    FROM role_catalog rc
    WHERE ir.institution_id = p_institution_id
      AND upper(trim(ir.code)) = rc.code
    RETURNING ir.id
  ),
  inserted AS (
    INSERT INTO public.institution_roles (
      institution_id, code, name, description, role_tier, scope_level, is_system, is_active
    )
    SELECT
      p_institution_id, rc.code, rc.name, rc.description, rc.role_tier, rc.scope_level, true, true
    FROM role_catalog rc
    WHERE NOT EXISTS (
      SELECT 1 FROM public.institution_roles ir
      WHERE ir.institution_id = p_institution_id
        AND upper(trim(ir.code)) = rc.code
    )
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

-- Seed / classify all existing institutions immediately
DO $$
DECLARE
  v_inst record;
BEGIN
  FOR v_inst IN SELECT id FROM public.institutions WHERE deleted_at IS NULL LOOP
    PERFORM public.seed_three_tier_institution_roles(v_inst.id);
  END LOOP;
END;
$$;

-- Trigger so every newly created institution automatically receives the 3-tier role catalog
CREATE OR REPLACE FUNCTION public.trg_fn_seed_three_tier_roles_on_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_three_tier_institution_roles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_institutions_seed_three_tier_roles ON public.institutions;
CREATE TRIGGER trg_institutions_seed_three_tier_roles
  AFTER INSERT ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_seed_three_tier_roles_on_institution();

-- 3. Three-Tier & Department-Scoped RLS Helper Functions
CREATE OR REPLACE FUNCTION public.has_institution_role(
  p_institution_id uuid,
  p_role_codes text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.institution_memberships im
    JOIN public.membership_roles mr ON mr.membership_id = im.id
    JOIN public.institution_roles ir ON ir.id = mr.institution_role_id
    WHERE im.user_id = auth.uid()
      AND im.institution_id = p_institution_id
      AND im.status = 'ACTIVE'
      AND ir.is_active = true
      AND upper(trim(ir.code)) = ANY(p_role_codes)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_management_team(p_institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR EXISTS (
      SELECT 1
      FROM public.institution_memberships im
      JOIN public.membership_roles mr ON mr.membership_id = im.id
      JOIN public.institution_roles ir ON ir.id = mr.institution_role_id
      WHERE im.user_id = auth.uid()
        AND im.institution_id = p_institution_id
        AND im.status = 'ACTIVE'
        AND ir.is_active = true
        AND ir.role_tier = 'MANAGEMENT'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_lead_team(p_institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR EXISTS (
      SELECT 1
      FROM public.institution_memberships im
      JOIN public.membership_roles mr ON mr.membership_id = im.id
      JOIN public.institution_roles ir ON ir.id = mr.institution_role_id
      WHERE im.user_id = auth.uid()
        AND im.institution_id = p_institution_id
        AND im.status = 'ACTIVE'
        AND ir.is_active = true
        AND ir.role_tier = 'LEAD_TEAM'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_first_year_dean(p_institution_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_institution_role(p_institution_id, ARRAY['DEAN_FIRST_YEAR']);
$$;

CREATE OR REPLACE FUNCTION public.get_user_academic_unit_id(p_institution_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sp.academic_unit_id
  FROM public.staff_profiles sp
  WHERE sp.institution_id = p_institution_id
    AND sp.user_id = auth.uid()
    AND sp.deleted_at IS NULL
    AND sp.is_active = true
  ORDER BY sp.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_academic_unit(
  p_institution_id uuid,
  p_academic_unit_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR public.is_institution_admin(p_institution_id)
    OR public.has_institution_role(
      p_institution_id,
      ARRAY['DEAN_ACADEMICS', 'ACADEMIC_ADVISOR', 'ACADEMIC_ADMIN']
    )
    OR (
      p_academic_unit_id IS NOT NULL
      AND public.has_institution_role(
        p_institution_id,
        ARRAY['HOD', 'BOS_CHAIR', 'BOE_CHAIR', 'DEPT_ADMIN', 'DEPT_COORDINATOR']
      )
      AND public.get_user_academic_unit_id(p_institution_id) = p_academic_unit_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_institution_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_management_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_lead_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_first_year_dean(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_academic_unit_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_academic_unit(uuid, uuid) TO authenticated;
