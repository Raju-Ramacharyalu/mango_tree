BEGIN;
DO $$
DECLARE
  v_amc_id uuid;
  v_cat_id uuid;
  v_inst_b_id uuid;
  v_user_b_id uuid := gen_random_uuid();
  v_role_b_id uuid;
  v_mem_b_id uuid;
  v_cnt integer;
  v_blocked boolean := false;
BEGIN
  SELECT id INTO v_amc_id FROM public.institutions WHERE code = 'AMCEC' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_cat_id FROM public.institution_categories WHERE is_active = true LIMIT 1;

  INSERT INTO public.institutions (category_id, code, name, status)
  VALUES (v_cat_id, 'TEST_B', 'Test College B', 'ACTIVE') RETURNING id INTO v_inst_b_id;

  INSERT INTO public.institution_roles (institution_id, code, name, is_system)
  VALUES (v_inst_b_id, 'INSTITUTION_ADMIN', 'Institution Administrator', true) RETURNING id INTO v_role_b_id;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_user_b_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'rls_test_b@example.local', 'unused', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Test Admin B"}'::jsonb, now(), now()
  );

  INSERT INTO public.institution_memberships (institution_id, user_id, status, joined_at)
  VALUES (v_inst_b_id, v_user_b_id, 'ACTIVE', now()) RETURNING id INTO v_mem_b_id;

  INSERT INTO public.membership_roles (membership_id, institution_role_id)
  VALUES (v_mem_b_id, v_role_b_id);

  INSERT INTO public.students (institution_id, registration_number, full_name)
  VALUES (v_inst_b_id, 'TESTB001', 'TEST STUDENT B');

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_cnt FROM public.students;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: unauthenticated anon can read students'; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_user_b_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_b_id, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_cnt FROM public.students WHERE institution_id = v_amc_id;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'FAIL: College B admin read AMCEC students'; END IF;

  SELECT count(*) INTO v_cnt FROM public.students WHERE institution_id = v_inst_b_id;
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'FAIL: College B admin could not read own student'; END IF;

  BEGIN
    INSERT INTO public.students (institution_id, registration_number, full_name)
    VALUES (v_amc_id, 'HACK001', 'CROSS TENANT TEST');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'FAIL: College B admin inserted into AMCEC'; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS: All RLS isolation checks passed.';
END $$;
ROLLBACK;
