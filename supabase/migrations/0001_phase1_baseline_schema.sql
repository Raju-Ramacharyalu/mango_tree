CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.academic_batches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  program_id uuid NOT NULL,
  curriculum_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  admission_year integer NOT NULL,
  expected_graduation_year integer,
  scheme_batch integer,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.academic_period_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  periods_per_year integer DEFAULT 2 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.academic_periods (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  period_type_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  sequence_number integer NOT NULL,
  term_group text,
  legacy_semester_id integer,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.academic_sections (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  program_id uuid NOT NULL,
  academic_batch_id uuid,
  academic_period_id uuid NOT NULL,
  academic_year text NOT NULL,
  section_name text NOT NULL,
  max_capacity integer DEFAULT 60 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.academic_units (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  campus_id uuid,
  parent_unit_id uuid,
  unit_type text DEFAULT 'DEPARTMENT'::text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.assessment_patterns (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  max_internal_marks numeric(6,2) DEFAULT 50 NOT NULL,
  max_external_marks numeric(6,2) DEFAULT 50 NOT NULL,
  total_marks numeric(6,2) DEFAULT 100 NOT NULL,
  min_internal_pass numeric(6,2),
  min_external_pass numeric(6,2),
  min_total_pass numeric(6,2),
  components jsonb DEFAULT '[]'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid,
  actor_user_id uuid,
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.campuses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  contact_phone text,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.course_catalog (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  offering_academic_unit_id uuid,
  course_category_id uuid,
  course_code text NOT NULL,
  title text NOT NULL,
  short_title text,
  default_credits numeric(4,2) DEFAULT 3.0 NOT NULL,
  textbooks text,
  reference_books text,
  syllabus_summary text,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.course_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_credit_bearing boolean DEFAULT true NOT NULL,
  is_elective boolean DEFAULT false NOT NULL,
  is_online boolean DEFAULT false NOT NULL,
  default_max_cie numeric(6,2) DEFAULT 50 NOT NULL,
  default_max_see numeric(6,2) DEFAULT 50 NOT NULL,
  default_total_marks numeric(6,2) DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.course_offerings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  academic_year text NOT NULL,
  academic_period_id uuid NOT NULL,
  curriculum_course_id uuid,
  course_id uuid NOT NULL,
  program_id uuid,
  academic_section_id uuid,
  assessment_pattern_id uuid,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.curricula (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  program_id uuid NOT NULL,
  program_version_id uuid,
  period_type_id uuid NOT NULL,
  grading_scale_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  scheme_batch integer,
  version_number integer DEFAULT 1 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.curriculum_courses (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  course_id uuid NOT NULL,
  academic_period_id uuid NOT NULL,
  program_specialization_id uuid,
  course_category_id uuid,
  assessment_pattern_id uuid,
  credits numeric(4,2) DEFAULT 3.0 NOT NULL,
  l_hours integer DEFAULT 0 NOT NULL,
  t_hours integer DEFAULT 0 NOT NULL,
  p_hours integer DEFAULT 0 NOT NULL,
  saae_hours integer DEFAULT 0 NOT NULL,
  max_internal_marks numeric(6,2) DEFAULT 50 NOT NULL,
  max_external_marks numeric(6,2) DEFAULT 50 NOT NULL,
  total_marks numeric(6,2) DEFAULT 100 NOT NULL,
  exam_duration_hours numeric(4,2) DEFAULT 3.0 NOT NULL,
  is_elective boolean DEFAULT false NOT NULL,
  is_lab boolean DEFAULT false NOT NULL,
  is_integrated boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.grade_scale_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  grading_scale_id uuid NOT NULL,
  grade_code text NOT NULL,
  description text NOT NULL,
  grade_point numeric(4,2) DEFAULT 0 NOT NULL,
  min_percentage numeric(5,2),
  max_percentage numeric(5,2),
  is_pass boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.grading_scales (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.identifier_formats (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  entity_type text NOT NULL,
  name text NOT NULL,
  pattern text NOT NULL,
  validation_regex text,
  prefix text,
  sequence_padding integer DEFAULT 3 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.institution_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.institution_domains (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  domain text NOT NULL,
  is_primary boolean DEFAULT false NOT NULL,
  is_verified boolean DEFAULT false NOT NULL,
  verified_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.institution_memberships (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  invited_by uuid,
  joined_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.institution_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.institution_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  setting_group text DEFAULT 'GENERAL'::text NOT NULL,
  setting_key text NOT NULL,
  setting_value jsonb DEFAULT '{}'::jsonb NOT NULL,
  description text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.institution_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  plan_code text DEFAULT 'FREE'::text NOT NULL,
  plan_name text DEFAULT 'Community / Self-Hosted'::text NOT NULL,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  starts_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  ends_at timestamp with time zone,
  max_students integer,
  max_staff integer,
  features jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.institutions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid,
  category_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  short_name text,
  university_affiliation text,
  institution_type text DEFAULT 'AUTONOMOUS'::text NOT NULL,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  official_email text,
  official_phone text,
  website_url text,
  logo_url text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  country text DEFAULT 'India'::text NOT NULL,
  postal_code text,
  timezone text DEFAULT 'Asia/Kolkata'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.membership_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  membership_id uuid NOT NULL,
  institution_role_id uuid NOT NULL,
  assigned_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.migration_audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  job_id uuid,
  action text NOT NULL,
  actor_user_id uuid,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.migration_errors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  job_id uuid NOT NULL,
  staging_row_id uuid,
  row_number integer NOT NULL,
  field_name text,
  error_code text,
  error_message text NOT NULL,
  raw_payload jsonb,
  resolution_status text DEFAULT 'OPEN'::text NOT NULL,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.migration_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  source_id uuid,
  entity_type text NOT NULL,
  import_mode text DEFAULT 'SAFE'::text NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  file_name text,
  file_checksum text,
  total_rows integer DEFAULT 0 NOT NULL,
  valid_rows integer DEFAULT 0 NOT NULL,
  imported_rows integer DEFAULT 0 NOT NULL,
  skipped_rows integer DEFAULT 0 NOT NULL,
  error_rows integer DEFAULT 0 NOT NULL,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  summary jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.migration_mappings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  source_id uuid NOT NULL,
  entity_type text NOT NULL,
  source_key text NOT NULL,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  last_job_id uuid,
  source_hash text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.migration_sources (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  source_type text DEFAULT 'CSV_UPLOAD'::text NOT NULL,
  description text,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.migration_staging_rows (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  job_id uuid NOT NULL,
  row_number integer NOT NULL,
  source_key text,
  raw_payload jsonb NOT NULL,
  normalized_payload jsonb,
  validation_status text DEFAULT 'PENDING'::text NOT NULL,
  validation_messages jsonb DEFAULT '[]'::jsonb NOT NULL,
  target_record_id uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  organization_type text DEFAULT 'TRUST'::text NOT NULL,
  website_url text,
  contact_email text,
  contact_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  country text DEFAULT 'India'::text NOT NULL,
  postal_code text,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.platform_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  setting_key text NOT NULL,
  setting_value jsonb DEFAULT '{}'::jsonb NOT NULL,
  description text,
  is_public boolean DEFAULT false NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.program_specializations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  program_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_default boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.program_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  program_id uuid NOT NULL,
  version_code text NOT NULL,
  name text NOT NULL,
  effective_from_year integer,
  effective_to_year integer,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.programs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  academic_unit_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  qualification text NOT NULL,
  program_level text DEFAULT 'UG'::text NOT NULL,
  duration_years numeric(3,1) DEFAULT 4.0 NOT NULL,
  total_credits_required numeric(6,2),
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  platform_role_id uuid,
  institution_role_id uuid,
  permission_code text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  user_id uuid,
  academic_unit_id uuid,
  employee_code text NOT NULL,
  legacy_staff_id integer,
  full_name text NOT NULL,
  email text,
  phone text,
  designation text NOT NULL,
  department_label text,
  branch_label text,
  is_evaluator boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.student_enrollments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  student_id uuid NOT NULL,
  program_id uuid NOT NULL,
  program_version_id uuid,
  program_specialization_id uuid,
  academic_batch_id uuid,
  current_period_id uuid,
  academic_section_id uuid,
  student_category text DEFAULT 'REGULAR'::text NOT NULL,
  enrollment_status text DEFAULT 'ACTIVE'::text NOT NULL,
  admission_quota text,
  total_credits_earned numeric(6,2) DEFAULT 0 NOT NULL,
  is_current boolean DEFAULT true NOT NULL,
  enrolled_at date,
  completed_at date,
  remarks text,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.students (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  institution_id uuid NOT NULL,
  user_id uuid,
  registration_number text NOT NULL,
  is_temporary_registration boolean DEFAULT false NOT NULL,
  admission_number text,
  full_name text NOT NULL,
  dob date,
  gender text,
  email text,
  phone text,
  photo_url text,
  ssp_id text,
  name_as_in_aadhaar text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_platform_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  platform_role_id uuid NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  assigned_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid NOT NULL,
  default_institution_id uuid,
  preferred_context text DEFAULT 'INSTITUTION'::text NOT NULL,
  theme text DEFAULT 'system'::text NOT NULL,
  preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  avatar_url text,
  is_active boolean DEFAULT true NOT NULL,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.academic_batches ADD CONSTRAINT academic_batches_pkey PRIMARY KEY (id);

ALTER TABLE public.academic_batches ADD CONSTRAINT academic_batches_institution_id_program_id_code_key UNIQUE (institution_id, program_id, code);

ALTER TABLE public.academic_period_types ADD CONSTRAINT academic_period_types_pkey PRIMARY KEY (id);

ALTER TABLE public.academic_period_types ADD CONSTRAINT academic_period_types_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.academic_period_types ADD CONSTRAINT academic_period_types_periods_per_year_check CHECK (((periods_per_year >= 1) AND (periods_per_year <= 12)));

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_pkey PRIMARY KEY (id);

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_institution_id_period_type_id_sequence_num_key UNIQUE (institution_id, period_type_id, sequence_number);

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_sequence_number_check CHECK ((sequence_number >= 1));

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_pkey PRIMARY KEY (id);

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_institution_id_academic_year_program_id_a_key UNIQUE (institution_id, academic_year, program_id, academic_period_id, section_name);

ALTER TABLE public.academic_units ADD CONSTRAINT academic_units_pkey PRIMARY KEY (id);

ALTER TABLE public.academic_units ADD CONSTRAINT academic_units_unit_type_check CHECK ((unit_type = ANY (ARRAY['SCHOOL'::text, 'FACULTY'::text, 'DEPARTMENT'::text, 'CENTRE'::text, 'BRANCH'::text, 'DIVISION'::text])));

ALTER TABLE public.assessment_patterns ADD CONSTRAINT assessment_patterns_pkey PRIMARY KEY (id);

ALTER TABLE public.assessment_patterns ADD CONSTRAINT assessment_patterns_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text, 'CUSTOM'::text])));

ALTER TABLE public.campuses ADD CONSTRAINT campuses_pkey PRIMARY KEY (id);

ALTER TABLE public.campuses ADD CONSTRAINT campuses_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.course_catalog ADD CONSTRAINT course_catalog_pkey PRIMARY KEY (id);

ALTER TABLE public.course_categories ADD CONSTRAINT course_categories_pkey PRIMARY KEY (id);

ALTER TABLE public.course_categories ADD CONSTRAINT course_categories_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_pkey PRIMARY KEY (id);

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_status_check CHECK ((status = ANY (ARRAY['PLANNED'::text, 'ACTIVE'::text, 'COMPLETED'::text, 'CANCELLED'::text])));

ALTER TABLE public.curricula ADD CONSTRAINT curricula_pkey PRIMARY KEY (id);

ALTER TABLE public.curricula ADD CONSTRAINT curricula_institution_id_code_version_number_key UNIQUE (institution_id, code, version_number);

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_pkey PRIMARY KEY (id);

ALTER TABLE public.grade_scale_items ADD CONSTRAINT grade_scale_items_pkey PRIMARY KEY (id);

ALTER TABLE public.grade_scale_items ADD CONSTRAINT grade_scale_items_grading_scale_id_grade_code_key UNIQUE (grading_scale_id, grade_code);

ALTER TABLE public.grading_scales ADD CONSTRAINT grading_scales_pkey PRIMARY KEY (id);

ALTER TABLE public.grading_scales ADD CONSTRAINT grading_scales_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.identifier_formats ADD CONSTRAINT identifier_formats_pkey PRIMARY KEY (id);

ALTER TABLE public.identifier_formats ADD CONSTRAINT identifier_formats_institution_id_entity_type_name_key UNIQUE (institution_id, entity_type, name);

ALTER TABLE public.identifier_formats ADD CONSTRAINT identifier_formats_entity_type_check CHECK ((entity_type = ANY (ARRAY['STUDENT_TEMP'::text, 'STUDENT_OFFICIAL'::text, 'STAFF_ID'::text, 'COURSE_CODE'::text, 'CUSTOM'::text])));

ALTER TABLE public.institution_categories ADD CONSTRAINT institution_categories_pkey PRIMARY KEY (id);

ALTER TABLE public.institution_categories ADD CONSTRAINT institution_categories_code_key UNIQUE (code);

ALTER TABLE public.institution_categories ADD CONSTRAINT institution_categories_name_key UNIQUE (name);

ALTER TABLE public.institution_domains ADD CONSTRAINT institution_domains_pkey PRIMARY KEY (id);

ALTER TABLE public.institution_domains ADD CONSTRAINT institution_domains_domain_key UNIQUE (domain);

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_pkey PRIMARY KEY (id);

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_institution_id_user_id_key UNIQUE (institution_id, user_id);

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_status_check CHECK ((status = ANY (ARRAY['INVITED'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'INACTIVE'::text])));

ALTER TABLE public.institution_roles ADD CONSTRAINT institution_roles_pkey PRIMARY KEY (id);

ALTER TABLE public.institution_roles ADD CONSTRAINT institution_roles_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.institution_settings ADD CONSTRAINT institution_settings_pkey PRIMARY KEY (id);

ALTER TABLE public.institution_settings ADD CONSTRAINT institution_settings_institution_id_setting_key_key UNIQUE (institution_id, setting_key);

ALTER TABLE public.institution_subscriptions ADD CONSTRAINT institution_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE public.institution_subscriptions ADD CONSTRAINT institution_subscriptions_status_check CHECK ((status = ANY (ARRAY['TRIAL'::text, 'ACTIVE'::text, 'PAST_DUE'::text, 'SUSPENDED'::text, 'CANCELLED'::text])));

ALTER TABLE public.institutions ADD CONSTRAINT institutions_pkey PRIMARY KEY (id);

ALTER TABLE public.institutions ADD CONSTRAINT institutions_code_key UNIQUE (code);

ALTER TABLE public.institutions ADD CONSTRAINT institutions_institution_type_check CHECK ((institution_type = ANY (ARRAY['AUTONOMOUS'::text, 'AFFILIATED'::text, 'DEEMED'::text, 'UNIVERSITY'::text, 'STANDALONE'::text])));

ALTER TABLE public.institutions ADD CONSTRAINT institutions_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text, 'INACTIVE'::text])));

ALTER TABLE public.membership_roles ADD CONSTRAINT membership_roles_pkey PRIMARY KEY (id);

ALTER TABLE public.membership_roles ADD CONSTRAINT membership_roles_membership_id_institution_role_id_key UNIQUE (membership_id, institution_role_id);

ALTER TABLE public.migration_audit_log ADD CONSTRAINT migration_audit_log_pkey PRIMARY KEY (id);

ALTER TABLE public.migration_errors ADD CONSTRAINT migration_errors_pkey PRIMARY KEY (id);

ALTER TABLE public.migration_errors ADD CONSTRAINT migration_errors_resolution_status_check CHECK ((resolution_status = ANY (ARRAY['OPEN'::text, 'CORRECTED'::text, 'IGNORED'::text, 'REPROCESSED'::text])));

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_pkey PRIMARY KEY (id);

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_entity_type_check CHECK ((entity_type = ANY (ARRAY['ACADEMIC_UNITS'::text, 'PROGRAMS'::text, 'CURRICULUM_COURSES'::text, 'COURSE_CATALOG'::text, 'STUDENTS'::text, 'STUDENT_ENROLLMENTS'::text, 'STUDENT_USN_MIGRATION'::text, 'STUDENT_STATUS'::text, 'STUDENT_SPECIALIZATIONS'::text, 'STAFF'::text, 'SECTIONS'::text, 'SETTINGS'::text])));

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_import_mode_check CHECK ((import_mode = ANY (ARRAY['SAFE'::text, 'OVERWRITE'::text])));

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'VALIDATING'::text, 'VALIDATED'::text, 'IMPORTING'::text, 'COMPLETED'::text, 'COMPLETED_WITH_ERRORS'::text, 'FAILED'::text, 'CANCELLED'::text])));

ALTER TABLE public.migration_mappings ADD CONSTRAINT migration_mappings_pkey PRIMARY KEY (id);

ALTER TABLE public.migration_mappings ADD CONSTRAINT migration_mappings_institution_id_source_id_entity_type_sou_key UNIQUE (institution_id, source_id, entity_type, source_key);

ALTER TABLE public.migration_sources ADD CONSTRAINT migration_sources_pkey PRIMARY KEY (id);

ALTER TABLE public.migration_sources ADD CONSTRAINT migration_sources_institution_id_code_key UNIQUE (institution_id, code);

ALTER TABLE public.migration_sources ADD CONSTRAINT migration_sources_source_type_check CHECK ((source_type = ANY (ARRAY['LEGACY_SUPABASE'::text, 'CSV_UPLOAD'::text, 'EXTERNAL_ERP'::text, 'MANUAL_IMPORT'::text])));

ALTER TABLE public.migration_staging_rows ADD CONSTRAINT migration_staging_rows_pkey PRIMARY KEY (id);

ALTER TABLE public.migration_staging_rows ADD CONSTRAINT migration_staging_rows_job_id_row_number_key UNIQUE (job_id, row_number);

ALTER TABLE public.migration_staging_rows ADD CONSTRAINT migration_staging_rows_validation_status_check CHECK ((validation_status = ANY (ARRAY['PENDING'::text, 'VALID'::text, 'DUPLICATE'::text, 'ERROR'::text, 'IMPORTED'::text, 'SKIPPED'::text])));

ALTER TABLE public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);

ALTER TABLE public.organizations ADD CONSTRAINT organizations_code_key UNIQUE (code);

ALTER TABLE public.organizations ADD CONSTRAINT organizations_organization_type_check CHECK ((organization_type = ANY (ARRAY['TRUST'::text, 'SOCIETY'::text, 'UNIVERSITY'::text, 'GROUP'::text, 'GOVERNMENT'::text, 'OTHER'::text])));

ALTER TABLE public.platform_roles ADD CONSTRAINT platform_roles_pkey PRIMARY KEY (id);

ALTER TABLE public.platform_roles ADD CONSTRAINT platform_roles_code_key UNIQUE (code);

ALTER TABLE public.platform_roles ADD CONSTRAINT platform_roles_name_key UNIQUE (name);

ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);

ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_setting_key_key UNIQUE (setting_key);

ALTER TABLE public.program_specializations ADD CONSTRAINT program_specializations_pkey PRIMARY KEY (id);

ALTER TABLE public.program_specializations ADD CONSTRAINT program_specializations_program_id_code_key UNIQUE (program_id, code);

ALTER TABLE public.program_versions ADD CONSTRAINT program_versions_pkey PRIMARY KEY (id);

ALTER TABLE public.program_versions ADD CONSTRAINT program_versions_program_id_version_code_key UNIQUE (program_id, version_code);

ALTER TABLE public.programs ADD CONSTRAINT programs_pkey PRIMARY KEY (id);

ALTER TABLE public.programs ADD CONSTRAINT programs_program_level_check CHECK ((program_level = ANY (ARRAY['DIPLOMA'::text, 'UG'::text, 'PG'::text, 'INTEGRATED'::text, 'DOCTORAL'::text, 'CERTIFICATE'::text, 'OTHER'::text])));

ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);

ALTER TABLE public.role_permissions ADD CONSTRAINT chk_role_permissions_single_scope CHECK ((((platform_role_id IS NOT NULL) AND (institution_role_id IS NULL)) OR ((platform_role_id IS NULL) AND (institution_role_id IS NOT NULL))));

ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_pkey PRIMARY KEY (id);

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_pkey PRIMARY KEY (id);

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_enrollment_status_check CHECK ((enrollment_status = ANY (ARRAY['ACTIVE'::text, 'DETAINED'::text, 'DISCONTINUED'::text, 'COMPLETED'::text, 'TRANSFERRED'::text, 'SUSPENDED'::text])));

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_student_category_check CHECK ((student_category = ANY (ARRAY['REGULAR'::text, 'LATERAL_ENTRY'::text, 'YEAR_BACK'::text, 'COLLEGE_CHANGE'::text, 'BRANCH_CHANGE'::text, 'RE_ADMISSION'::text, 'TRANSFER'::text, 'OTHER'::text])));

ALTER TABLE public.students ADD CONSTRAINT students_pkey PRIMARY KEY (id);

ALTER TABLE public.user_platform_roles ADD CONSTRAINT user_platform_roles_pkey PRIMARY KEY (id);

ALTER TABLE public.user_platform_roles ADD CONSTRAINT user_platform_roles_user_id_platform_role_id_key UNIQUE (user_id, platform_role_id);

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_preferred_context_check CHECK ((preferred_context = ANY (ARRAY['PLATFORM'::text, 'INSTITUTION'::text])));

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_theme_check CHECK ((theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text])));

ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);

ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_email_key UNIQUE (email);

ALTER TABLE public.academic_batches ADD CONSTRAINT academic_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_batches ADD CONSTRAINT academic_batches_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE SET NULL;

ALTER TABLE public.academic_batches ADD CONSTRAINT academic_batches_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.academic_batches ADD CONSTRAINT academic_batches_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;

ALTER TABLE public.academic_batches ADD CONSTRAINT academic_batches_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_period_types ADD CONSTRAINT academic_period_types_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_period_types ADD CONSTRAINT academic_period_types_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.academic_period_types ADD CONSTRAINT academic_period_types_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_period_type_id_fkey FOREIGN KEY (period_type_id) REFERENCES academic_period_types(id) ON DELETE CASCADE;

ALTER TABLE public.academic_periods ADD CONSTRAINT academic_periods_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_academic_batch_id_fkey FOREIGN KEY (academic_batch_id) REFERENCES academic_batches(id) ON DELETE SET NULL;

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id);

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;

ALTER TABLE public.academic_sections ADD CONSTRAINT academic_sections_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_units ADD CONSTRAINT academic_units_campus_id_fkey FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL;

ALTER TABLE public.academic_units ADD CONSTRAINT academic_units_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.academic_units ADD CONSTRAINT academic_units_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.academic_units ADD CONSTRAINT academic_units_parent_unit_id_fkey FOREIGN KEY (parent_unit_id) REFERENCES academic_units(id) ON DELETE SET NULL;

ALTER TABLE public.academic_units ADD CONSTRAINT academic_units_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.assessment_patterns ADD CONSTRAINT assessment_patterns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.assessment_patterns ADD CONSTRAINT assessment_patterns_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.assessment_patterns ADD CONSTRAINT assessment_patterns_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE SET NULL;

ALTER TABLE public.campuses ADD CONSTRAINT campuses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.campuses ADD CONSTRAINT campuses_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.campuses ADD CONSTRAINT campuses_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.course_catalog ADD CONSTRAINT course_catalog_course_category_id_fkey FOREIGN KEY (course_category_id) REFERENCES course_categories(id) ON DELETE SET NULL;

ALTER TABLE public.course_catalog ADD CONSTRAINT course_catalog_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.course_catalog ADD CONSTRAINT course_catalog_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.course_catalog ADD CONSTRAINT course_catalog_offering_academic_unit_id_fkey FOREIGN KEY (offering_academic_unit_id) REFERENCES academic_units(id) ON DELETE SET NULL;

ALTER TABLE public.course_catalog ADD CONSTRAINT course_catalog_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.course_categories ADD CONSTRAINT course_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.course_categories ADD CONSTRAINT course_categories_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.course_categories ADD CONSTRAINT course_categories_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id);

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_academic_section_id_fkey FOREIGN KEY (academic_section_id) REFERENCES academic_sections(id) ON DELETE SET NULL;

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_assessment_pattern_id_fkey FOREIGN KEY (assessment_pattern_id) REFERENCES assessment_patterns(id) ON DELETE SET NULL;

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_course_id_fkey FOREIGN KEY (course_id) REFERENCES course_catalog(id) ON DELETE RESTRICT;

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_curriculum_course_id_fkey FOREIGN KEY (curriculum_course_id) REFERENCES curriculum_courses(id) ON DELETE SET NULL;

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;

ALTER TABLE public.course_offerings ADD CONSTRAINT course_offerings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.curricula ADD CONSTRAINT curricula_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.curricula ADD CONSTRAINT curricula_grading_scale_id_fkey FOREIGN KEY (grading_scale_id) REFERENCES grading_scales(id) ON DELETE SET NULL;

ALTER TABLE public.curricula ADD CONSTRAINT curricula_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.curricula ADD CONSTRAINT curricula_period_type_id_fkey FOREIGN KEY (period_type_id) REFERENCES academic_period_types(id);

ALTER TABLE public.curricula ADD CONSTRAINT curricula_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;

ALTER TABLE public.curricula ADD CONSTRAINT curricula_program_version_id_fkey FOREIGN KEY (program_version_id) REFERENCES program_versions(id) ON DELETE SET NULL;

ALTER TABLE public.curricula ADD CONSTRAINT curricula_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES academic_periods(id);

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_assessment_pattern_id_fkey FOREIGN KEY (assessment_pattern_id) REFERENCES assessment_patterns(id) ON DELETE SET NULL;

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_course_category_id_fkey FOREIGN KEY (course_category_id) REFERENCES course_categories(id) ON DELETE SET NULL;

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_course_id_fkey FOREIGN KEY (course_id) REFERENCES course_catalog(id) ON DELETE RESTRICT;

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_curriculum_id_fkey FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE;

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_program_specialization_id_fkey FOREIGN KEY (program_specialization_id) REFERENCES program_specializations(id) ON DELETE SET NULL;

ALTER TABLE public.curriculum_courses ADD CONSTRAINT curriculum_courses_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.grade_scale_items ADD CONSTRAINT grade_scale_items_grading_scale_id_fkey FOREIGN KEY (grading_scale_id) REFERENCES grading_scales(id) ON DELETE CASCADE;

ALTER TABLE public.grade_scale_items ADD CONSTRAINT grade_scale_items_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.grading_scales ADD CONSTRAINT grading_scales_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.grading_scales ADD CONSTRAINT grading_scales_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.grading_scales ADD CONSTRAINT grading_scales_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.identifier_formats ADD CONSTRAINT identifier_formats_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.identifier_formats ADD CONSTRAINT identifier_formats_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.identifier_formats ADD CONSTRAINT identifier_formats_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_categories ADD CONSTRAINT institution_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_categories ADD CONSTRAINT institution_categories_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_domains ADD CONSTRAINT institution_domains_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_domains ADD CONSTRAINT institution_domains_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.institution_domains ADD CONSTRAINT institution_domains_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_memberships ADD CONSTRAINT institution_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.institution_roles ADD CONSTRAINT institution_roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_roles ADD CONSTRAINT institution_roles_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.institution_roles ADD CONSTRAINT institution_roles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_settings ADD CONSTRAINT institution_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_settings ADD CONSTRAINT institution_settings_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.institution_settings ADD CONSTRAINT institution_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_subscriptions ADD CONSTRAINT institution_subscriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.institution_subscriptions ADD CONSTRAINT institution_subscriptions_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.institution_subscriptions ADD CONSTRAINT institution_subscriptions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.institutions ADD CONSTRAINT institutions_category_id_fkey FOREIGN KEY (category_id) REFERENCES institution_categories(id);

ALTER TABLE public.institutions ADD CONSTRAINT institutions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.institutions ADD CONSTRAINT institutions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE public.institutions ADD CONSTRAINT institutions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.membership_roles ADD CONSTRAINT membership_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id);

ALTER TABLE public.membership_roles ADD CONSTRAINT membership_roles_institution_role_id_fkey FOREIGN KEY (institution_role_id) REFERENCES institution_roles(id) ON DELETE CASCADE;

ALTER TABLE public.membership_roles ADD CONSTRAINT membership_roles_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES institution_memberships(id) ON DELETE CASCADE;

ALTER TABLE public.migration_audit_log ADD CONSTRAINT migration_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);

ALTER TABLE public.migration_audit_log ADD CONSTRAINT migration_audit_log_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.migration_audit_log ADD CONSTRAINT migration_audit_log_job_id_fkey FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE SET NULL;

ALTER TABLE public.migration_errors ADD CONSTRAINT migration_errors_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.migration_errors ADD CONSTRAINT migration_errors_job_id_fkey FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE CASCADE;

ALTER TABLE public.migration_errors ADD CONSTRAINT migration_errors_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);

ALTER TABLE public.migration_errors ADD CONSTRAINT migration_errors_staging_row_id_fkey FOREIGN KEY (staging_row_id) REFERENCES migration_staging_rows(id) ON DELETE SET NULL;

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_source_id_fkey FOREIGN KEY (source_id) REFERENCES migration_sources(id) ON DELETE SET NULL;

ALTER TABLE public.migration_jobs ADD CONSTRAINT migration_jobs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.migration_mappings ADD CONSTRAINT migration_mappings_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.migration_mappings ADD CONSTRAINT migration_mappings_last_job_id_fkey FOREIGN KEY (last_job_id) REFERENCES migration_jobs(id) ON DELETE SET NULL;

ALTER TABLE public.migration_mappings ADD CONSTRAINT migration_mappings_source_id_fkey FOREIGN KEY (source_id) REFERENCES migration_sources(id) ON DELETE CASCADE;

ALTER TABLE public.migration_sources ADD CONSTRAINT migration_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.migration_sources ADD CONSTRAINT migration_sources_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.migration_sources ADD CONSTRAINT migration_sources_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.migration_staging_rows ADD CONSTRAINT migration_staging_rows_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.migration_staging_rows ADD CONSTRAINT migration_staging_rows_job_id_fkey FOREIGN KEY (job_id) REFERENCES migration_jobs(id) ON DELETE CASCADE;

ALTER TABLE public.organizations ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.organizations ADD CONSTRAINT organizations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.platform_settings ADD CONSTRAINT platform_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.program_specializations ADD CONSTRAINT program_specializations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.program_specializations ADD CONSTRAINT program_specializations_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.program_specializations ADD CONSTRAINT program_specializations_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;

ALTER TABLE public.program_specializations ADD CONSTRAINT program_specializations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.program_versions ADD CONSTRAINT program_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.program_versions ADD CONSTRAINT program_versions_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.program_versions ADD CONSTRAINT program_versions_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE;

ALTER TABLE public.program_versions ADD CONSTRAINT program_versions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.programs ADD CONSTRAINT programs_academic_unit_id_fkey FOREIGN KEY (academic_unit_id) REFERENCES academic_units(id) ON DELETE SET NULL;

ALTER TABLE public.programs ADD CONSTRAINT programs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.programs ADD CONSTRAINT programs_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.programs ADD CONSTRAINT programs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_institution_role_id_fkey FOREIGN KEY (institution_role_id) REFERENCES institution_roles(id) ON DELETE CASCADE;

ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_platform_role_id_fkey FOREIGN KEY (platform_role_id) REFERENCES platform_roles(id) ON DELETE CASCADE;

ALTER TABLE public.staff_profiles ADD CONSTRAINT fk_staff_profiles_academic_unit FOREIGN KEY (academic_unit_id) REFERENCES academic_units(id) ON DELETE SET NULL;

ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_academic_batch_id_fkey FOREIGN KEY (academic_batch_id) REFERENCES academic_batches(id) ON DELETE SET NULL;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_academic_section_id_fkey FOREIGN KEY (academic_section_id) REFERENCES academic_sections(id) ON DELETE SET NULL;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_current_period_id_fkey FOREIGN KEY (current_period_id) REFERENCES academic_periods(id) ON DELETE SET NULL;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id);

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_program_specialization_id_fkey FOREIGN KEY (program_specialization_id) REFERENCES program_specializations(id) ON DELETE SET NULL;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_program_version_id_fkey FOREIGN KEY (program_version_id) REFERENCES program_versions(id) ON DELETE SET NULL;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE public.student_enrollments ADD CONSTRAINT student_enrollments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.students ADD CONSTRAINT students_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

ALTER TABLE public.students ADD CONSTRAINT students_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE;

ALTER TABLE public.students ADD CONSTRAINT students_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);

ALTER TABLE public.students ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.user_platform_roles ADD CONSTRAINT user_platform_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id);

ALTER TABLE public.user_platform_roles ADD CONSTRAINT user_platform_roles_platform_role_id_fkey FOREIGN KEY (platform_role_id) REFERENCES platform_roles(id) ON DELETE CASCADE;

ALTER TABLE public.user_platform_roles ADD CONSTRAINT user_platform_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_default_institution_id_fkey FOREIGN KEY (default_institution_id) REFERENCES institutions(id) ON DELETE SET NULL;

ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_academic_batches_inst ON public.academic_batches USING btree (institution_id);

CREATE INDEX idx_academic_periods_inst ON public.academic_periods USING btree (institution_id);

CREATE INDEX idx_academic_sections_inst ON public.academic_sections USING btree (institution_id, academic_year);

CREATE INDEX idx_academic_units_inst ON public.academic_units USING btree (institution_id);

CREATE INDEX idx_academic_units_parent ON public.academic_units USING btree (parent_unit_id);

CREATE UNIQUE INDEX uq_academic_units_inst_code ON public.academic_units USING btree (institution_id, upper(code)) WHERE (deleted_at IS NULL);

CREATE INDEX idx_audit_logs_actor ON public.audit_logs USING btree (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_logs_inst_time ON public.audit_logs USING btree (institution_id, created_at DESC);

CREATE INDEX idx_audit_logs_table_record ON public.audit_logs USING btree (table_name, record_id);

CREATE INDEX idx_campuses_institution ON public.campuses USING btree (institution_id);

CREATE INDEX idx_course_catalog_inst ON public.course_catalog USING btree (institution_id);

CREATE UNIQUE INDEX uq_course_catalog_inst_code ON public.course_catalog USING btree (institution_id, upper(course_code)) WHERE (deleted_at IS NULL);

CREATE INDEX idx_course_offerings_inst ON public.course_offerings USING btree (institution_id, academic_year);

CREATE UNIQUE INDEX uq_course_offerings_context ON public.course_offerings USING btree (institution_id, academic_year, academic_period_id, course_id, COALESCE(program_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(academic_section_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX idx_curricula_inst ON public.curricula USING btree (institution_id);

CREATE INDEX idx_curricula_program ON public.curricula USING btree (program_id);

CREATE INDEX idx_curriculum_courses_curriculum ON public.curriculum_courses USING btree (curriculum_id, academic_period_id);

CREATE INDEX idx_curriculum_courses_inst ON public.curriculum_courses USING btree (institution_id);

CREATE UNIQUE INDEX uq_curriculum_courses_scope ON public.curriculum_courses USING btree (curriculum_id, course_id, academic_period_id, COALESCE(program_specialization_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX idx_institution_domains_inst ON public.institution_domains USING btree (institution_id);

CREATE INDEX idx_memberships_inst ON public.institution_memberships USING btree (institution_id, status);

CREATE INDEX idx_memberships_user ON public.institution_memberships USING btree (user_id, status);

CREATE INDEX idx_institution_roles_inst ON public.institution_roles USING btree (institution_id);

CREATE INDEX idx_institution_settings_inst ON public.institution_settings USING btree (institution_id, setting_group);

CREATE INDEX idx_institution_subscriptions_inst ON public.institution_subscriptions USING btree (institution_id);

CREATE INDEX idx_institutions_category ON public.institutions USING btree (category_id);

CREATE INDEX idx_institutions_org ON public.institutions USING btree (organization_id);

CREATE INDEX idx_institutions_status ON public.institutions USING btree (status) WHERE (deleted_at IS NULL);

CREATE INDEX idx_membership_roles_membership ON public.membership_roles USING btree (membership_id);

CREATE INDEX idx_membership_roles_role ON public.membership_roles USING btree (institution_role_id);

CREATE INDEX idx_migration_audit_inst ON public.migration_audit_log USING btree (institution_id, created_at DESC);

CREATE INDEX idx_migration_errors_job ON public.migration_errors USING btree (job_id, resolution_status);

CREATE INDEX idx_migration_jobs_inst ON public.migration_jobs USING btree (institution_id, created_at DESC);

CREATE INDEX idx_migration_mappings_target ON public.migration_mappings USING btree (target_table, target_id);

CREATE INDEX idx_staging_rows_job_status ON public.migration_staging_rows USING btree (job_id, validation_status);

CREATE INDEX idx_program_specializations_inst ON public.program_specializations USING btree (institution_id);

CREATE INDEX idx_program_versions_inst ON public.program_versions USING btree (institution_id);

CREATE INDEX idx_programs_inst ON public.programs USING btree (institution_id);

CREATE INDEX idx_programs_unit ON public.programs USING btree (academic_unit_id);

CREATE UNIQUE INDEX uq_programs_inst_code ON public.programs USING btree (institution_id, upper(code)) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX uq_role_permissions_institution ON public.role_permissions USING btree (institution_role_id, permission_code) WHERE (institution_role_id IS NOT NULL);

CREATE UNIQUE INDEX uq_role_permissions_platform ON public.role_permissions USING btree (platform_role_id, permission_code) WHERE (platform_role_id IS NOT NULL);

CREATE INDEX idx_staff_profiles_inst ON public.staff_profiles USING btree (institution_id);

CREATE INDEX idx_staff_profiles_user ON public.staff_profiles USING btree (user_id);

CREATE UNIQUE INDEX uq_staff_profiles_inst_code ON public.staff_profiles USING btree (institution_id, upper(employee_code)) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX uq_staff_profiles_inst_email ON public.staff_profiles USING btree (institution_id, lower(email)) WHERE ((email IS NOT NULL) AND (deleted_at IS NULL));

CREATE INDEX idx_enrollments_inst_status ON public.student_enrollments USING btree (institution_id, enrollment_status);

CREATE INDEX idx_enrollments_program_period ON public.student_enrollments USING btree (institution_id, program_id, current_period_id);

CREATE INDEX idx_enrollments_student ON public.student_enrollments USING btree (student_id);

CREATE UNIQUE INDEX uq_student_current_enrollment ON public.student_enrollments USING btree (student_id, program_id) WHERE (is_current = true);

CREATE INDEX idx_students_admission_no ON public.students USING btree (institution_id, admission_number) WHERE (admission_number IS NOT NULL);

CREATE INDEX idx_students_inst ON public.students USING btree (institution_id);

CREATE UNIQUE INDEX uq_students_inst_email ON public.students USING btree (institution_id, lower(email)) WHERE ((email IS NOT NULL) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX uq_students_inst_reg_no ON public.students USING btree (institution_id, upper(registration_number)) WHERE (deleted_at IS NULL);

CREATE INDEX idx_user_platform_roles_user ON public.user_platform_roles USING btree (user_id) WHERE (is_active = true);

CREATE OR REPLACE FUNCTION public.can_manage_academics(p_institution_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_institution_role(
    p_institution_id,
    ARRAY['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER', 'ACADEMIC_ADMIN', 'DEPT_ADMIN']
  );
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    lower(NEW.email),
    COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_institution_role(p_institution_id uuid, p_role_codes text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.institution_memberships im
    JOIN public.membership_roles mr ON mr.membership_id = im.id
    JOIN public.institution_roles ir ON ir.id = mr.institution_role_id
    WHERE im.institution_id = p_institution_id
      AND im.user_id = auth.uid()
      AND im.status = 'ACTIVE'
      AND ir.is_active = true
      AND ir.code = ANY (p_role_codes)
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_platform_role(p_role_codes text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_platform_roles upr
    JOIN public.platform_roles pr ON pr.id = upr.platform_role_id
    WHERE upr.user_id = auth.uid()
      AND upr.is_active = true
      AND pr.code = ANY (p_role_codes)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_institution_admin(p_institution_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_institution_role(
    p_institution_id,
    ARRAY['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER']
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_institution_member(p_institution_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.institution_memberships im
    JOIN public.institutions i ON i.id = im.institution_id
    WHERE im.institution_id = p_institution_id
      AND im.user_id = auth.uid()
      AND im.status = 'ACTIVE'
      AND i.deleted_at IS NULL
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_platform_role(ARRAY['SUPER_ADMIN', 'PLATFORM_ADMIN']);
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_platform_role(ARRAY['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT']);
$function$;

CREATE OR REPLACE FUNCTION public.log_table_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_institution_id uuid;
  v_record_id uuid;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  IF TG_TABLE_NAME = 'institutions' THEN
    v_institution_id := (v_row ->> 'id')::uuid;
  ELSIF v_row ? 'institution_id' AND NULLIF(v_row ->> 'institution_id', '') IS NOT NULL THEN
    v_institution_id := (v_row ->> 'institution_id')::uuid;
  ELSE
    v_institution_id := NULL;
  END IF;

  IF v_row ? 'id' AND NULLIF(v_row ->> 'id', '') IS NOT NULL THEN
    v_record_id := (v_row ->> 'id')::uuid;
  END IF;

  INSERT INTO public.audit_logs (
    institution_id,
    actor_user_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  ) VALUES (
    v_institution_id,
    auth.uid(),
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.migrate_student_registration_number(p_institution_id uuid, p_temp_reg_no text, p_official_reg_no text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id uuid;
BEGIN
  UPDATE public.students
  SET
    admission_number = COALESCE(admission_number, registration_number),
    registration_number = upper(trim(p_official_reg_no)),
    is_temporary_registration = false,
    updated_by = auth.uid()
  WHERE institution_id = p_institution_id
    AND upper(registration_number) = upper(trim(p_temp_reg_no))
    AND deleted_at IS NULL
  RETURNING id INTO v_student_id;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Active student with registration number % not found in institution %', p_temp_reg_no, p_institution_id;
  END IF;

  RETURN v_student_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

CREATE TRIGGER trg_academic_batches_updated_at BEFORE UPDATE ON public.academic_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_academic_period_types_updated_at BEFORE UPDATE ON public.academic_period_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_academic_periods_updated_at BEFORE UPDATE ON public.academic_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_academic_sections_updated_at BEFORE UPDATE ON public.academic_sections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_academic_units_audit AFTER INSERT OR DELETE OR UPDATE ON public.academic_units FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_academic_units_updated_at BEFORE UPDATE ON public.academic_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_assessment_patterns_updated_at BEFORE UPDATE ON public.assessment_patterns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_campuses_updated_at BEFORE UPDATE ON public.campuses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_course_catalog_audit AFTER INSERT OR DELETE OR UPDATE ON public.course_catalog FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_course_catalog_updated_at BEFORE UPDATE ON public.course_catalog FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_course_categories_updated_at BEFORE UPDATE ON public.course_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_course_offerings_updated_at BEFORE UPDATE ON public.course_offerings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_curricula_audit AFTER INSERT OR DELETE OR UPDATE ON public.curricula FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_curricula_updated_at BEFORE UPDATE ON public.curricula FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_curriculum_courses_audit AFTER INSERT OR DELETE OR UPDATE ON public.curriculum_courses FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_curriculum_courses_updated_at BEFORE UPDATE ON public.curriculum_courses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_grading_scales_updated_at BEFORE UPDATE ON public.grading_scales FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_identifier_formats_updated_at BEFORE UPDATE ON public.identifier_formats FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_institution_categories_updated_at BEFORE UPDATE ON public.institution_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_institution_domains_updated_at BEFORE UPDATE ON public.institution_domains FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_institution_memberships_audit AFTER INSERT OR DELETE OR UPDATE ON public.institution_memberships FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_institution_memberships_updated_at BEFORE UPDATE ON public.institution_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_institution_roles_audit AFTER INSERT OR DELETE OR UPDATE ON public.institution_roles FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_institution_roles_updated_at BEFORE UPDATE ON public.institution_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_institution_settings_audit AFTER INSERT OR DELETE OR UPDATE ON public.institution_settings FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_institution_settings_updated_at BEFORE UPDATE ON public.institution_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_institution_subscriptions_updated_at BEFORE UPDATE ON public.institution_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_institutions_audit AFTER INSERT OR DELETE OR UPDATE ON public.institutions FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_institutions_updated_at BEFORE UPDATE ON public.institutions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_membership_roles_audit AFTER INSERT OR DELETE OR UPDATE ON public.membership_roles FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_migration_jobs_updated_at BEFORE UPDATE ON public.migration_jobs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_migration_mappings_updated_at BEFORE UPDATE ON public.migration_mappings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_migration_sources_updated_at BEFORE UPDATE ON public.migration_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_migration_staging_rows_updated_at BEFORE UPDATE ON public.migration_staging_rows FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_organizations_audit AFTER INSERT OR DELETE OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_platform_roles_updated_at BEFORE UPDATE ON public.platform_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_platform_settings_updated_at BEFORE UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_program_specializations_updated_at BEFORE UPDATE ON public.program_specializations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_program_versions_updated_at BEFORE UPDATE ON public.program_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_programs_audit AFTER INSERT OR DELETE OR UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_programs_updated_at BEFORE UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_staff_profiles_audit AFTER INSERT OR DELETE OR UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_staff_profiles_updated_at BEFORE UPDATE ON public.staff_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_student_enrollments_audit AFTER INSERT OR DELETE OR UPDATE ON public.student_enrollments FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_student_enrollments_updated_at BEFORE UPDATE ON public.student_enrollments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_students_audit AFTER INSERT OR DELETE OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_platform_roles_audit AFTER INSERT OR DELETE OR UPDATE ON public.user_platform_roles FOR EACH ROW EXECUTE FUNCTION log_table_audit();

CREATE TRIGGER trg_user_platform_roles_updated_at BEFORE UPDATE ON public.user_platform_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.academic_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.academic_period_types ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.academic_periods ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.academic_sections ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.academic_units ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.assessment_patterns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.campuses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.course_catalog ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.course_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.course_offerings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.curricula ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.curriculum_courses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.grade_scale_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.grading_scales ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.identifier_formats ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.institution_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.institution_domains ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.institution_memberships ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.institution_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.institution_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.institution_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.migration_audit_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.migration_errors ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.migration_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.migration_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.migration_sources ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.migration_staging_rows ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.program_specializations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.program_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_platform_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY academic_batches_delete ON public.academic_batches AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY academic_batches_insert ON public.academic_batches AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_batches_select ON public.academic_batches AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY academic_batches_update ON public.academic_batches AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_period_types_delete ON public.academic_period_types AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY academic_period_types_insert ON public.academic_period_types AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_period_types_select ON public.academic_period_types AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY academic_period_types_update ON public.academic_period_types AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_periods_delete ON public.academic_periods AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY academic_periods_insert ON public.academic_periods AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_periods_select ON public.academic_periods AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY academic_periods_update ON public.academic_periods AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_sections_delete ON public.academic_sections AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY academic_sections_insert ON public.academic_sections AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_sections_select ON public.academic_sections AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY academic_sections_update ON public.academic_sections AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_units_delete ON public.academic_units AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY academic_units_insert ON public.academic_units AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY academic_units_select ON public.academic_units AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY academic_units_update ON public.academic_units AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY assessment_patterns_delete ON public.assessment_patterns AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY assessment_patterns_insert ON public.assessment_patterns AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY assessment_patterns_select ON public.assessment_patterns AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY assessment_patterns_update ON public.assessment_patterns AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY audit_logs_select ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR ((institution_id IS NOT NULL) AND is_institution_admin(institution_id))));

CREATE POLICY campuses_delete ON public.campuses AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY campuses_insert ON public.campuses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY campuses_select ON public.campuses AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY campuses_update ON public.campuses AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY course_catalog_delete ON public.course_catalog AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY course_catalog_insert ON public.course_catalog AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY course_catalog_select ON public.course_catalog AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY course_catalog_update ON public.course_catalog AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY course_categories_delete ON public.course_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY course_categories_insert ON public.course_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY course_categories_select ON public.course_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY course_categories_update ON public.course_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY course_offerings_delete ON public.course_offerings AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY course_offerings_insert ON public.course_offerings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY course_offerings_select ON public.course_offerings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY course_offerings_update ON public.course_offerings AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY curricula_delete ON public.curricula AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY curricula_insert ON public.curricula AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY curricula_select ON public.curricula AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY curricula_update ON public.curricula AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY curriculum_courses_delete ON public.curriculum_courses AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY curriculum_courses_insert ON public.curriculum_courses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY curriculum_courses_select ON public.curriculum_courses AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY curriculum_courses_update ON public.curriculum_courses AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY grade_scale_items_delete ON public.grade_scale_items AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY grade_scale_items_insert ON public.grade_scale_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY grade_scale_items_select ON public.grade_scale_items AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY grade_scale_items_update ON public.grade_scale_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY grading_scales_delete ON public.grading_scales AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY grading_scales_insert ON public.grading_scales AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY grading_scales_select ON public.grading_scales AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY grading_scales_update ON public.grading_scales AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY identifier_formats_delete ON public.identifier_formats AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY identifier_formats_insert ON public.identifier_formats AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY identifier_formats_select ON public.identifier_formats AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY identifier_formats_update ON public.identifier_formats AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY inst_categories_delete ON public.institution_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY inst_categories_insert ON public.institution_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY inst_categories_select ON public.institution_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY inst_categories_update ON public.institution_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY institution_domains_delete ON public.institution_domains AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_domains_insert ON public.institution_domains AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_domains_select ON public.institution_domains AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY institution_domains_update ON public.institution_domains AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY memberships_delete ON public.institution_memberships AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY memberships_insert ON public.institution_memberships AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY memberships_select ON public.institution_memberships AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR is_platform_staff() OR is_institution_admin(institution_id)));

CREATE POLICY memberships_update ON public.institution_memberships AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_roles_delete ON public.institution_roles AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_roles_insert ON public.institution_roles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_roles_select ON public.institution_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY institution_roles_update ON public.institution_roles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_settings_delete ON public.institution_settings AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_settings_insert ON public.institution_settings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY institution_settings_select ON public.institution_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY institution_settings_update ON public.institution_settings AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY inst_subscriptions_delete ON public.institution_subscriptions AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY inst_subscriptions_insert ON public.institution_subscriptions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY inst_subscriptions_select ON public.institution_subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_admin(institution_id)));

CREATE POLICY inst_subscriptions_update ON public.institution_subscriptions AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY institutions_delete ON public.institutions AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY institutions_insert ON public.institutions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY institutions_select ON public.institutions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(id)));

CREATE POLICY institutions_update ON public.institutions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(id)));

CREATE POLICY membership_roles_delete ON public.membership_roles AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR (EXISTS ( SELECT 1
   FROM institution_memberships im
  WHERE ((im.id = membership_roles.membership_id) AND is_institution_admin(im.institution_id))))));

CREATE POLICY membership_roles_insert ON public.membership_roles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR (EXISTS ( SELECT 1
   FROM (institution_memberships im
     JOIN institution_roles ir ON ((ir.id = membership_roles.institution_role_id)))
  WHERE ((im.id = membership_roles.membership_id) AND (ir.institution_id = im.institution_id) AND is_institution_admin(im.institution_id))))));

CREATE POLICY membership_roles_select ON public.membership_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR (EXISTS ( SELECT 1
   FROM institution_memberships im
  WHERE ((im.id = membership_roles.membership_id) AND ((im.user_id = auth.uid()) OR is_institution_admin(im.institution_id)))))));

CREATE POLICY migration_audit_log_delete ON public.migration_audit_log AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_audit_log_insert ON public.migration_audit_log AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_audit_log_select ON public.migration_audit_log AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY migration_audit_log_update ON public.migration_audit_log AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_errors_delete ON public.migration_errors AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_errors_insert ON public.migration_errors AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_errors_select ON public.migration_errors AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY migration_errors_update ON public.migration_errors AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_jobs_delete ON public.migration_jobs AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_jobs_insert ON public.migration_jobs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_jobs_select ON public.migration_jobs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY migration_jobs_update ON public.migration_jobs AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_mappings_delete ON public.migration_mappings AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_mappings_insert ON public.migration_mappings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_mappings_select ON public.migration_mappings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY migration_mappings_update ON public.migration_mappings AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_sources_delete ON public.migration_sources AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_sources_insert ON public.migration_sources AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_sources_select ON public.migration_sources AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY migration_sources_update ON public.migration_sources AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_staging_rows_delete ON public.migration_staging_rows AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_staging_rows_insert ON public.migration_staging_rows AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY migration_staging_rows_select ON public.migration_staging_rows AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY migration_staging_rows_update ON public.migration_staging_rows AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY organizations_delete ON public.organizations AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY organizations_insert ON public.organizations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY organizations_select ON public.organizations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR (EXISTS ( SELECT 1
   FROM institutions i
  WHERE ((i.organization_id = organizations.id) AND is_institution_member(i.id))))));

CREATE POLICY organizations_update ON public.organizations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY platform_roles_select ON public.platform_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_staff());

CREATE POLICY platform_roles_write ON public.platform_roles AS PERMISSIVE FOR ALL TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]))
  WITH CHECK (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY platform_settings_delete ON public.platform_settings AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY platform_settings_insert ON public.platform_settings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY platform_settings_select ON public.platform_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (((is_public = true) OR is_platform_staff()));

CREATE POLICY platform_settings_update ON public.platform_settings AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY program_specializations_delete ON public.program_specializations AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY program_specializations_insert ON public.program_specializations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY program_specializations_select ON public.program_specializations AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY program_specializations_update ON public.program_specializations AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY program_versions_delete ON public.program_versions AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY program_versions_insert ON public.program_versions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY program_versions_select ON public.program_versions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY program_versions_update ON public.program_versions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY programs_delete ON public.programs AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY programs_insert ON public.programs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY programs_select ON public.programs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY programs_update ON public.programs AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY role_permissions_delete ON public.role_permissions AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR ((institution_role_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM institution_roles ir
  WHERE ((ir.id = role_permissions.institution_role_id) AND is_institution_admin(ir.institution_id)))))));

CREATE POLICY role_permissions_insert ON public.role_permissions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR ((institution_role_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM institution_roles ir
  WHERE ((ir.id = role_permissions.institution_role_id) AND is_institution_admin(ir.institution_id)))))));

CREATE POLICY role_permissions_select ON public.role_permissions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR ((institution_role_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM institution_roles ir
  WHERE ((ir.id = role_permissions.institution_role_id) AND is_institution_member(ir.institution_id)))))));

CREATE POLICY staff_profiles_delete ON public.staff_profiles AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY staff_profiles_insert ON public.staff_profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY staff_profiles_select ON public.staff_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY staff_profiles_update ON public.staff_profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)))
  WITH CHECK ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY student_enrollments_delete ON public.student_enrollments AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY student_enrollments_insert ON public.student_enrollments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY student_enrollments_select ON public.student_enrollments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY student_enrollments_update ON public.student_enrollments AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY students_delete ON public.students AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_platform_admin() OR is_institution_admin(institution_id)));

CREATE POLICY students_insert ON public.students AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY students_select ON public.students AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_staff() OR is_institution_member(institution_id)));

CREATE POLICY students_update ON public.students AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_platform_admin() OR can_manage_academics(institution_id)))
  WITH CHECK ((is_platform_admin() OR can_manage_academics(institution_id)));

CREATE POLICY user_platform_roles_delete ON public.user_platform_roles AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY user_platform_roles_insert ON public.user_platform_roles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY user_platform_roles_select ON public.user_platform_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR is_platform_staff()));

CREATE POLICY user_platform_roles_update ON public.user_platform_roles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]))
  WITH CHECK (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY user_preferences_all_own ON public.user_preferences AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY user_profiles_delete ON public.user_profiles AS PERMISSIVE FOR DELETE TO authenticated
  USING (has_platform_role(ARRAY['SUPER_ADMIN'::text]));

CREATE POLICY user_profiles_insert ON public.user_profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((id = auth.uid()) OR is_platform_admin()));

CREATE POLICY user_profiles_select ON public.user_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (((id = auth.uid()) OR is_platform_staff() OR (EXISTS ( SELECT 1
   FROM institution_memberships im_target
  WHERE ((im_target.user_id = user_profiles.id) AND is_institution_member(im_target.institution_id))))));

CREATE POLICY user_profiles_update ON public.user_profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((id = auth.uid()) OR is_platform_admin()))
  WITH CHECK (((id = auth.uid()) OR is_platform_admin()));
