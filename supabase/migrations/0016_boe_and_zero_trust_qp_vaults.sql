-- ============================================================================
-- Phase 4B / Migration 0016: Per-Tenant Zero-Trust RSA Vaults, BOE Setter
-- Appointments, NDA-Logged Encrypted SEE Papers, Multi-Faculty PIN-Encrypted
-- IA QP Allocations, and Shared Platform VTU LaTeX Formula Library
-- ============================================================================

-- 1. Add 4-digit Faculty Vault PIN to staff_profiles
ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS staff_pin text;

-- 2. Per-Tenant COE RSA-2048 Public Key Registry (Private .pem stays strictly offline)
CREATE TABLE IF NOT EXISTS public.institution_vault_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  public_key_pem text NOT NULL,
  key_fingerprint text NOT NULL,
  algorithm text DEFAULT 'RSA-2048-OAEP' NOT NULL,
  rotated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_institution_vault_key UNIQUE (institution_id)
);

-- 3. BOE Setter Nominations & COE Appointments (Internal, External & COE Internal OMR)
CREATE TABLE IF NOT EXISTS public.boe_nominations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.course_catalog(id) ON DELETE SET NULL,
  course_code text NOT NULL,
  academic_unit_id uuid REFERENCES public.academic_units(id) ON DELETE SET NULL,
  department_name text NOT NULL,
  faculty_type text DEFAULT 'Internal' NOT NULL CHECK (faculty_type IN ('Internal', 'External')),
  staff_profile_id uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  faculty_code text,
  setter_name text NOT NULL,
  designation text DEFAULT 'Professor' NOT NULL,
  college_name text DEFAULT '' NOT NULL,
  college_address text DEFAULT '' NOT NULL,
  mobile text DEFAULT '' NOT NULL,
  email text NOT NULL,
  nomination_status text DEFAULT 'DRAFT' NOT NULL CHECK (nomination_status IN ('DRAFT', 'SUBMITTED')),
  is_selected boolean DEFAULT false NOT NULL,
  is_exported boolean DEFAULT false NOT NULL,
  is_received boolean DEFAULT false NOT NULL,
  access_token uuid UNIQUE,
  token_expires_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boe_nominations_inst_cycle
  ON public.boe_nominations (institution_id, exam_cycle_id, department_name, course_code);

CREATE INDEX IF NOT EXISTS idx_boe_nominations_token
  ON public.boe_nominations (access_token)
  WHERE access_token IS NOT NULL;

-- 4. Encrypted SEE Question Papers (COE-Only Decryption Vault)
CREATE TABLE IF NOT EXISTS public.see_submitted_papers (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  nomination_id uuid NOT NULL REFERENCES public.boe_nominations(id) ON DELETE CASCADE,
  course_code text NOT NULL,
  setter_email text NOT NULL,
  paper_format text DEFAULT 'STANDARD' NOT NULL CHECK (paper_format IN ('STANDARD', 'MBA', 'OMR')),
  encrypted_aes_key text NOT NULL,
  encrypted_payload text NOT NULL,
  status text DEFAULT 'SUBMITTED' NOT NULL CHECK (status IN ('SUBMITTED', 'PRINTED', 'ARCHIVED')),
  submitted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_see_paper_nomination UNIQUE (nomination_id)
);

CREATE INDEX IF NOT EXISTS idx_see_papers_inst_cycle
  ON public.see_submitted_papers (institution_id, exam_cycle_id, course_code);

-- 5. Immutable NDA & Confidential QP Security Logs
CREATE TABLE IF NOT EXISTS public.qp_security_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  nomination_id uuid REFERENCES public.boe_nominations(id) ON DELETE SET NULL,
  setter_email text NOT NULL,
  action text NOT NULL,
  signature_name text,
  browser_agent text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qp_security_logs_inst
  ON public.qp_security_logs (institution_id, created_at DESC);

-- 6. Multi-Faculty PIN-Encrypted IA Question Paper Allocations
CREATE TABLE IF NOT EXISTS public.ia_qp_allocations (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  course_code text NOT NULL,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  faculty_code text NOT NULL,
  ia_number integer DEFAULT 1 NOT NULL CHECK (ia_number IN (1, 2, 3)),
  num_sets integer DEFAULT 1 NOT NULL CHECK (num_sets BETWEEN 1 AND 4),
  qp_pattern text DEFAULT 'DESCRIPTIVE' NOT NULL CHECK (qp_pattern IN ('DESCRIPTIVE', 'OMR_50', 'OMR_25')),
  max_marks integer DEFAULT 50 NOT NULL CHECK (max_marks > 0),
  duration_minutes integer DEFAULT 90 NOT NULL CHECK (duration_minutes > 0),
  qp_content text,
  co_statements text,
  status text DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED')),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_ia_qp_multi_faculty
    UNIQUE (institution_id, exam_cycle_id, course_id, ia_number, staff_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_ia_qp_alloc_inst_cycle
  ON public.ia_qp_allocations (institution_id, exam_cycle_id, ia_number, status);

CREATE INDEX IF NOT EXISTS idx_ia_qp_alloc_staff
  ON public.ia_qp_allocations (institution_id, staff_profile_id);

-- 7. Shared Platform VTU Engineering LaTeX Formula Library
CREATE TABLE IF NOT EXISTS public.platform_latex_equations (
  id serial PRIMARY KEY,
  category text NOT NULL,
  title text NOT NULL,
  description text DEFAULT '' NOT NULL,
  latex_code text NOT NULL,
  CONSTRAINT uq_platform_latex_title UNIQUE (category, title)
);

INSERT INTO public.platform_latex_equations (category, title, description, latex_code)
VALUES
  ('Mathematics', 'Quadratic Formula', 'Roots of a quadratic equation ax^2 + bx + c = 0', '$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$'),
  ('Mathematics', 'Taylor Series Expansion', 'Series expansion of f(x) around x = a', '$f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!}(x - a)^n$'),
  ('Mathematics', 'Laplace Transform', 'Standard unilateral Laplace transform definition', '$\mathcal{L}\{f(t)\} = \int_{0}^{\infty} e^{-st} f(t)\,dt$'),
  ('Mathematics', 'Fourier Transform', 'Continuous Fourier transform pair', '$F(\omega) = \int_{-\infty}^{\infty} f(t)e^{-j\omega t}\,dt$'),
  ('Mathematics', '2x2 Matrix Determinant', 'Standard 2x2 matrix and determinant notation', '$\det\begin{bmatrix} a & b \\ c & d \end{bmatrix} = ad - bc$'),
  ('Mathematics', '3x3 Matrix', 'General 3x3 matrix template', '$\begin{bmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{bmatrix}$'),
  ('Mathematics', 'Bayes Theorem', 'Conditional probability relation', '$P(A \mid B) = \frac{P(B \mid A)\,P(A)}{P(B)}$'),
  ('Mathematics', 'Normal Distribution PDF', 'Gaussian probability density function', '$f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{1}{2}\left(\frac{x-\mu}{\sigma}\right)^2}$'),
  ('Physics', 'Schrodinger Time-Independent', '1D time-independent wave equation', '$-\frac{\hbar^2}{2m}\frac{d^2\psi}{dx^2} + V(x)\psi = E\psi$'),
  ('Physics', 'De Broglie Wavelength', 'Matter wave relation with momentum', '$\lambda = \frac{h}{p} = \frac{h}{mv}$'),
  ('Physics', 'Maxwell-Faraday Law', 'Electromagnetic induction differential form', '$\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}$'),
  ('Physics', 'Snell Law of Refraction', 'Optical interface refraction relation', '$n_1 \sin\theta_1 = n_2 \sin\theta_2$'),
  ('ECE / Electrical', 'Ohm & AC Impedance', 'Complex RLC series impedance', '$Z = R + j\left(\omega L - \frac{1}{\omega C}\right)$'),
  ('ECE / Electrical', 'Resonant Frequency', 'Series/parallel LC resonance frequency', '$f_r = \frac{1}{2\pi\sqrt{LC}}$'),
  ('ECE / Electrical', 'Shannon-Hartley Capacity', 'Channel capacity in bits per second', '$C = B \log_2\left(1 + \frac{S}{N}\right)$'),
  ('ECE / Electrical', 'Diode Shockley Equation', 'PN junction I-V characteristic', '$I = I_S\left(e^{\frac{V_D}{\eta V_T}} - 1\right)$'),
  ('Computer Science', 'Master Theorem Recurrence', 'Divide-and-conquer recurrence form', '$T(n) = a\,T\!\left(\frac{n}{b}\right) + f(n)$'),
  ('Computer Science', 'Sigmoid Activation', 'Logistic activation function for neural networks', '$\sigma(z) = \frac{1}{1 + e^{-z}}$'),
  ('Computer Science', 'Shannon Entropy', 'Information entropy across discrete outcomes', '$H(X) = -\sum_{i=1}^{n} p(x_i)\log_2 p(x_i)$'),
  ('Computer Science', 'Cosine Similarity', 'Vector similarity in NLP and ML', '$\text{sim}(\vec{A}, \vec{B}) = \frac{\vec{A} \cdot \vec{B}}{\|\vec{A}\|\|\vec{B}\|}$'),
  ('Mechanical / Civil', 'Euler Buckling Load', 'Critical buckling load for pinned column', '$P_{cr} = \frac{\pi^2 E I}{L_e^2}$'),
  ('Mechanical / Civil', 'Bending Stress Equation', 'Flexure formula for beams', '$\frac{M}{I} = \frac{\sigma}{y} = \frac{E}{R}$'),
  ('Mechanical / Civil', 'Bernoulli Equation', 'Incompressible steady inviscid fluid flow', '$P + \frac{1}{2}\rho v^2 + \rho g h = \text{constant}$'),
  ('Chemistry', 'Nernst Equation', 'Electrochemical cell potential at temperature T', '$E = E^\circ - \frac{RT}{nF}\ln Q$')
ON CONFLICT (category, title) DO NOTHING;

-- 8. RPC: Generate Missing 4-Digit Staff Vault PINs
CREATE OR REPLACE FUNCTION public.generate_missing_staff_pins(p_institution_id uuid)
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
    OR public.has_institution_role(p_institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
  ) THEN
    RAISE EXCEPTION 'Unauthorized: COE or Institution Admin privileges required.';
  END IF;

  UPDATE public.staff_profiles
  SET
    staff_pin = lpad((1000 + floor(random() * 9000))::integer::text, 4, '0'),
    updated_by = v_actor_id
  WHERE institution_id = p_institution_id
    AND deleted_at IS NULL
    AND (staff_pin IS NULL OR trim(staff_pin) = '');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_missing_staff_pins(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_missing_staff_pins(uuid) TO authenticated;

-- 9. RPC: Verify 4-Digit Staff PIN for IA Vault Unlock
CREATE OR REPLACE FUNCTION public.verify_staff_pin(
  p_institution_id uuid,
  p_staff_profile_id uuid,
  p_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored text;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.is_platform_staff() OR public.is_institution_member(p_institution_id)
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Institution membership required.';
  END IF;

  SELECT staff_pin INTO v_stored
  FROM public.staff_profiles
  WHERE id = p_staff_profile_id
    AND institution_id = p_institution_id
    AND deleted_at IS NULL
    AND is_active = true;

  RETURN v_stored IS NOT NULL AND trim(v_stored) = trim(COALESCE(p_pin, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, uuid, text) TO authenticated;

-- 10. Token-Gated Zero-Trust External SEE Setter RPCs (Allows /setter-drafter?token=... without anon table reads)
CREATE OR REPLACE FUNCTION public.get_setter_nomination_by_token(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nom record;
  v_inst record;
  v_pub_key text;
  v_course_title text;
  v_course_cat text;
  v_already_submitted boolean;
  v_blueprint text := 'STANDARD';
BEGIN
  SELECT * INTO v_nom
  FROM public.boe_nominations
  WHERE access_token = p_token
  LIMIT 1;

  IF v_nom.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Invalid or unrecognized secure link. Contact the COE office.');
  END IF;

  IF NOT v_nom.is_selected THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This appointment has been revoked by the COE.');
  END IF;

  IF v_nom.token_expires_at IS NULL OR v_nom.token_expires_at <= timezone('utc'::text, now()) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This 15-day secure link has expired. Request a refreshed link from the COE.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.see_submitted_papers WHERE nomination_id = v_nom.id
  ) INTO v_already_submitted;

  IF v_already_submitted THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'A sealed paper has already been submitted for this appointment. Access is permanently locked.');
  END IF;

  SELECT name, short_name INTO v_inst
  FROM public.institutions
  WHERE id = v_nom.institution_id;

  SELECT public_key_pem INTO v_pub_key
  FROM public.institution_vault_keys
  WHERE institution_id = v_nom.institution_id;

  IF v_nom.course_id IS NOT NULL THEN
    SELECT cc.title, COALESCE(cat.code, '')
    INTO v_course_title, v_course_cat
    FROM public.course_catalog cc
    LEFT JOIN public.course_categories cat ON cat.id = cc.course_category_id
    WHERE cc.id = v_nom.course_id;
  END IF;

  IF upper(COALESCE(v_course_cat, '')) = 'OMR' OR upper(v_nom.course_code) ~ '(1BKSK|1BKBK|1BENG|1BIC|1BCIP|OMR)' THEN
    v_blueprint := 'OMR';
  ELSIF upper(COALESCE(v_nom.department_name, '')) LIKE '%MBA%' OR upper(COALESCE(v_nom.department_name, '')) LIKE '%MANAGEMENT%' THEN
    v_blueprint := 'MBA';
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'nomination_id', v_nom.id,
    'institution_id', v_nom.institution_id,
    'institution_name', COALESCE(v_inst.name, 'Institution'),
    'exam_cycle_id', v_nom.exam_cycle_id,
    'course_code', v_nom.course_code,
    'course_title', COALESCE(v_course_title, v_nom.course_code),
    'department_name', v_nom.department_name,
    'setter_name', v_nom.setter_name,
    'setter_email', v_nom.email,
    'blueprint', v_blueprint,
    'has_public_key', v_pub_key IS NOT NULL,
    'public_key_pem', v_pub_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_setter_nomination_by_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_setter_nomination_by_token(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_setter_nda_acceptance(
  p_token uuid,
  p_signature_name text,
  p_browser_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nom record;
BEGIN
  SELECT * INTO v_nom
  FROM public.boe_nominations
  WHERE access_token = p_token
    AND is_selected = true
    AND token_expires_at > timezone('utc'::text, now())
  LIMIT 1;

  IF v_nom.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired setter token.';
  END IF;

  IF lower(trim(COALESCE(p_signature_name, ''))) <> lower(trim(v_nom.setter_name)) THEN
    RAISE EXCEPTION 'Signature does not match official appointed name: %', v_nom.setter_name;
  END IF;

  INSERT INTO public.qp_security_logs (
    institution_id, nomination_id, setter_email, action, signature_name, browser_agent
  )
  VALUES (
    v_nom.institution_id, v_nom.id, v_nom.email, 'NDA_ACCEPTED', trim(p_signature_name), left(COALESCE(p_browser_agent, ''), 500)
  );

  RETURN jsonb_build_object('accepted', true, 'nomination_id', v_nom.id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_setter_nda_acceptance(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_setter_nda_acceptance(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_encrypted_see_paper(
  p_token uuid,
  p_paper_format text,
  p_encrypted_aes_key text,
  p_encrypted_payload text,
  p_browser_agent text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nom record;
  v_paper_id uuid;
BEGIN
  SELECT * INTO v_nom
  FROM public.boe_nominations
  WHERE access_token = p_token
    AND is_selected = true
    AND token_expires_at > timezone('utc'::text, now())
  LIMIT 1;

  IF v_nom.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired setter token.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.see_submitted_papers WHERE nomination_id = v_nom.id) THEN
    RAISE EXCEPTION 'A paper has already been submitted for this appointment.';
  END IF;

  INSERT INTO public.see_submitted_papers (
    institution_id, exam_cycle_id, nomination_id, course_code, setter_email,
    paper_format, encrypted_aes_key, encrypted_payload, status
  )
  VALUES (
    v_nom.institution_id, v_nom.exam_cycle_id, v_nom.id, v_nom.course_code, v_nom.email,
    upper(trim(COALESCE(p_paper_format, 'STANDARD'))), p_encrypted_aes_key, p_encrypted_payload, 'SUBMITTED'
  )
  RETURNING id INTO v_paper_id;

  INSERT INTO public.qp_security_logs (
    institution_id, nomination_id, setter_email, action, browser_agent
  )
  VALUES (
    v_nom.institution_id, v_nom.id, v_nom.email, 'PAPER_SUBMITTED_ENCRYPTED', left(COALESCE(p_browser_agent, ''), 500)
  );

  RETURN jsonb_build_object('submitted', true, 'paper_id', v_paper_id);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_encrypted_see_paper(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_encrypted_see_paper(uuid, text, text, text, text) TO anon, authenticated;

-- 11. Triggers (updated_at + audit_logs)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'institution_vault_keys',
    'boe_nominations',
    'ia_qp_allocations'
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

-- 12. Strict Zero-Trust Row Level Security
ALTER TABLE public.institution_vault_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boe_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.see_submitted_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qp_security_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ia_qp_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_latex_equations ENABLE ROW LEVEL SECURITY;

-- Public keys readable by institution members (needed to encrypt drafts); writable strictly by COE / Admin
DROP POLICY IF EXISTS vault_keys_select ON public.institution_vault_keys;
CREATE POLICY vault_keys_select ON public.institution_vault_keys
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

DROP POLICY IF EXISTS vault_keys_write ON public.institution_vault_keys;
CREATE POLICY vault_keys_write ON public.institution_vault_keys
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

-- BOE Nominations: Lead Team (HOD, BOE Chair, Dean, Principal, COE) only
DROP POLICY IF EXISTS boe_nominations_select ON public.boe_nominations;
CREATE POLICY boe_nominations_select ON public.boe_nominations
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR is_lead_team(institution_id));

DROP POLICY IF EXISTS boe_nominations_write ON public.boe_nominations;
CREATE POLICY boe_nominations_write ON public.boe_nominations
  FOR ALL TO authenticated
  USING (is_platform_admin() OR is_lead_team(institution_id))
  WITH CHECK (is_platform_admin() OR is_lead_team(institution_id));

-- Encrypted SEE Papers & Security Logs: Strictly COE / Principal / Institution Admin
DROP POLICY IF EXISTS see_papers_coe_only ON public.see_submitted_papers;
CREATE POLICY see_papers_coe_only ON public.see_submitted_papers
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

DROP POLICY IF EXISTS qp_logs_coe_only ON public.qp_security_logs;
CREATE POLICY qp_logs_coe_only ON public.qp_security_logs
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
  );

-- IA QP Allocations: COE / Admin manage all; assigned faculty can view & update their own encrypted drafts
DROP POLICY IF EXISTS ia_qp_select ON public.ia_qp_allocations;
CREATE POLICY ia_qp_select ON public.ia_qp_allocations
  FOR SELECT TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
    OR EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.id = ia_qp_allocations.staff_profile_id
        AND sp.user_id = auth.uid()
        AND sp.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS ia_qp_insert_delete ON public.ia_qp_allocations;
CREATE POLICY ia_qp_insert_delete ON public.ia_qp_allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
  );

DROP POLICY IF EXISTS ia_qp_delete ON public.ia_qp_allocations;
CREATE POLICY ia_qp_delete ON public.ia_qp_allocations
  FOR DELETE TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
  );

DROP POLICY IF EXISTS ia_qp_update ON public.ia_qp_allocations;
CREATE POLICY ia_qp_update ON public.ia_qp_allocations
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
    OR EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.id = ia_qp_allocations.staff_profile_id
        AND sp.user_id = auth.uid()
        AND sp.deleted_at IS NULL
    )
  )
  WITH CHECK (
    is_platform_admin()
    OR is_institution_admin(institution_id)
    OR has_institution_role(institution_id, ARRAY['EXAM_CONTROLLER', 'PRINCIPAL_DIRECTOR'])
    OR EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.id = ia_qp_allocations.staff_profile_id
        AND sp.user_id = auth.uid()
        AND sp.deleted_at IS NULL
    )
  );

-- Platform LaTeX Formula Library: Readable by all authenticated users; writable by Platform Admin
DROP POLICY IF EXISTS platform_latex_select ON public.platform_latex_equations;
CREATE POLICY platform_latex_select ON public.platform_latex_equations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS platform_latex_write ON public.platform_latex_equations;
CREATE POLICY platform_latex_write ON public.platform_latex_equations
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Immediate 4-Part Verification
SELECT
  'tables' AS check_type,
  count(*)::text AS found_count,
  '6' AS expected_count,
  string_agg(table_name, ', ' ORDER BY table_name) AS details
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'boe_nominations',
    'ia_qp_allocations',
    'institution_vault_keys',
    'platform_latex_equations',
    'qp_security_logs',
    'see_submitted_papers'
  )

UNION ALL

SELECT
  'rpcs' AS check_type,
  count(*)::text AS found_count,
  '5' AS expected_count,
  string_agg(routine_name, ', ' ORDER BY routine_name) AS details
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'generate_missing_staff_pins',
    'get_setter_nomination_by_token',
    'record_setter_nda_acceptance',
    'submit_encrypted_see_paper',
    'verify_staff_pin'
  )

UNION ALL

SELECT
  'rls_enabled' AS check_type,
  count(*)::text AS found_count,
  '6' AS expected_count,
  string_agg(relname, ', ' ORDER BY relname) AS details
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relrowsecurity = true
  AND c.relname IN (
    'boe_nominations',
    'ia_qp_allocations',
    'institution_vault_keys',
    'platform_latex_equations',
    'qp_security_logs',
    'see_submitted_papers'
  )

UNION ALL

SELECT
  'latex_seed' AS check_type,
  count(*)::text AS found_count,
  '24' AS expected_count,
  string_agg(DISTINCT category, ', ' ORDER BY category) AS details
FROM public.platform_latex_equations;
