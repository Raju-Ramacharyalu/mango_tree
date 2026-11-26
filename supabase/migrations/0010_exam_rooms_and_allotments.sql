-- ============================================================================
-- Phase 2 / Milestone M11: Exam Rooms, Subject Aliases, Seating Allotments,
-- Form B Absentee Tracking, Form A Consolidation & Room-Wise QPDS
-- ============================================================================

-- 1. Examination Rooms Master
CREATE TABLE IF NOT EXISTS public.exam_rooms (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  campus_id uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  room_number text NOT NULL,
  room_name text,
  block_name text,
  floor_label text,
  capacity integer NOT NULL CHECK (capacity > 0),
  rows_count integer DEFAULT 6 NOT NULL CHECK (rows_count > 0),
  columns_count integer DEFAULT 5 NOT NULL CHECK (columns_count > 0),
  sort_order integer DEFAULT 0 NOT NULL,
  remarks text,
  is_active boolean DEFAULT true NOT NULL,
  deleted_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_rooms_inst_number
  ON public.exam_rooms (institution_id, upper(trim(room_number)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_exam_rooms_inst_active
  ON public.exam_rooms (institution_id, is_active, sort_order)
  WHERE deleted_at IS NULL;

-- 2. Subject Alias Mappings (e.g. 1BKSK109 -> 1BKSK209, 1BENG106 -> 1BENG206)
CREATE TABLE IF NOT EXISTS public.exam_course_aliases (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  source_course_code text NOT NULL,
  canonical_course_code text NOT NULL,
  remarks text,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_course_aliases_inst_source
  ON public.exam_course_aliases (institution_id, upper(trim(source_course_code)));

-- 3. Room Allotment Runs (One run per Exam Cycle + Exam Date + Session)
CREATE TABLE IF NOT EXISTS public.exam_room_allotment_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  exam_date date NOT NULL,
  session_code text NOT NULL CHECK (session_code IN ('FN', 'AN', 'CUSTOM')),
  status text DEFAULT 'DRAFT' NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'LOCKED')),
  small_branch_threshold integer DEFAULT 15 NOT NULL CHECK (small_branch_threshold >= 0),
  interleave_descriptive boolean DEFAULT true NOT NULL,
  omr_sequential boolean DEFAULT true NOT NULL,
  total_students integer DEFAULT 0 NOT NULL CHECK (total_students >= 0),
  total_rooms_used integer DEFAULT 0 NOT NULL CHECK (total_rooms_used >= 0),
  summary jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_exam_allotment_run_slot UNIQUE (exam_cycle_id, exam_date, session_code)
);

CREATE INDEX IF NOT EXISTS idx_exam_allotment_runs_inst_cycle
  ON public.exam_room_allotment_runs (institution_id, exam_cycle_id, exam_date, session_code);

-- 4. Individual Seat Allotments & Live Form B Attendance Ledger
CREATE TABLE IF NOT EXISTS public.exam_seat_allotments (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  exam_cycle_id uuid NOT NULL REFERENCES public.exam_cycles(id) ON DELETE CASCADE,
  allotment_run_id uuid NOT NULL REFERENCES public.exam_room_allotment_runs(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.exam_rooms(id) ON DELETE RESTRICT,
  exam_date date NOT NULL,
  session_code text NOT NULL CHECK (session_code IN ('FN', 'AN', 'CUSTOM')),
  seat_number integer NOT NULL CHECK (seat_number >= 1),
  seat_label text NOT NULL,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.exam_registrations(id) ON DELETE CASCADE,
  registration_course_id uuid NOT NULL REFERENCES public.exam_registration_courses(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.course_catalog(id) ON DELETE RESTRICT,
  program_id uuid NOT NULL REFERENCES public.programs(id),
  effective_course_code text NOT NULL,
  is_omr_exam boolean DEFAULT false NOT NULL,
  attendance_status text DEFAULT 'PRESENT' NOT NULL CHECK (attendance_status IN ('PRESENT', 'ABSENT', 'MALPRACTICE', 'EXEMPT')),
  booklet_number text,
  remarks text,
  marked_by uuid REFERENCES auth.users(id),
  marked_at timestamp with time zone,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT uq_seat_allotments_run_student UNIQUE (allotment_run_id, student_id),
  CONSTRAINT uq_seat_allotments_run_room_seat UNIQUE (allotment_run_id, room_id, seat_number)
);

CREATE INDEX IF NOT EXISTS idx_seat_allotments_run_room
  ON public.exam_seat_allotments (allotment_run_id, room_id, seat_number);

CREATE INDEX IF NOT EXISTS idx_seat_allotments_cycle_course
  ON public.exam_seat_allotments (institution_id, exam_cycle_id, effective_course_code, program_id);

-- 5. Triggers (updated_at + audit_logs on setup/runs; high-throughput seat ledger tracks marked_by/marked_at)
CREATE TRIGGER trg_exam_rooms_updated_at
  BEFORE UPDATE ON public.exam_rooms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_rooms_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_rooms
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_exam_course_aliases_updated_at
  BEFORE UPDATE ON public.exam_course_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_course_aliases_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_course_aliases
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_exam_allotment_runs_updated_at
  BEFORE UPDATE ON public.exam_room_allotment_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_exam_allotment_runs_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exam_room_allotment_runs
  FOR EACH ROW EXECUTE FUNCTION public.log_table_audit();

CREATE TRIGGER trg_exam_seat_allotments_updated_at
  BEFORE UPDATE ON public.exam_seat_allotments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Row Level Security
ALTER TABLE public.exam_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_course_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_room_allotment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_seat_allotments ENABLE ROW LEVEL SECURITY;

-- exam_rooms policies
CREATE POLICY exam_rooms_select ON public.exam_rooms
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_rooms_insert ON public.exam_rooms
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_rooms_update ON public.exam_rooms
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_rooms_delete ON public.exam_rooms
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_course_aliases policies
CREATE POLICY exam_course_aliases_select ON public.exam_course_aliases
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_course_aliases_insert ON public.exam_course_aliases
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_course_aliases_update ON public.exam_course_aliases
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_course_aliases_delete ON public.exam_course_aliases
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_room_allotment_runs policies
CREATE POLICY exam_allotment_runs_select ON public.exam_room_allotment_runs
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_allotment_runs_insert ON public.exam_room_allotment_runs
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_allotment_runs_update ON public.exam_room_allotment_runs
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_allotment_runs_delete ON public.exam_room_allotment_runs
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));

-- exam_seat_allotments policies
CREATE POLICY exam_seat_allotments_select ON public.exam_seat_allotments
  FOR SELECT TO authenticated
  USING (is_platform_staff() OR is_institution_member(institution_id));

CREATE POLICY exam_seat_allotments_insert ON public.exam_seat_allotments
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_seat_allotments_update ON public.exam_seat_allotments
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR can_manage_academics(institution_id))
  WITH CHECK (is_platform_admin() OR can_manage_academics(institution_id));

CREATE POLICY exam_seat_allotments_delete ON public.exam_seat_allotments
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR is_institution_admin(institution_id));
