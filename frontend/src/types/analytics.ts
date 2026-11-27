export interface AnalyticsOverviewData {
  total_students: number
  ug_count: number
  pg_count: number
  active_cycles: number
  closed_cycles: number
  branch_counts: Array<{ branch: string; count: number }>
  cycle_statuses: Array<{ status: string; count: number }>
}

export interface CycleAnalyticsData {
  total_evals: number
  ghost_count: number
  pending_evals: number
  failed_evals: number
  passed_evals: number
  pass_pct: number
  grade_distribution: Array<{ grade: string; count: number }>
  branch_pass_rates: Array<{ branch: string; total: number; passed: number; pass_pct: number }>
}

export interface Student360Response {
  found: boolean
  reason?: string
  student?: {
    id: string
    registration_number: string
    admission_number: string | null
    full_name: string
    email: string | null
    phone: string | null
    photo_url: string | null
    is_active: boolean
    program_code: string
    program_name: string
    program_type: 'UG' | 'PG'
    current_sem: number
    student_category: string
  }
  metrics?: {
    credits_attempted: number
    credits_earned: number
    cgpa: number
    active_backlogs: number
  }
  history?: Array<{
    cycle_code: string
    cycle_name: string
    cycle_type: string
    course_code: string
    course_title: string
    credits: number
    semester_number: number
    cie_marks: number | null
    see_marks: number | null
    total_marks: number | null
    grade_code: string | null
    grade_point: number | null
    result_status: string
    has_reval: boolean
    has_grace: boolean
  }>
}

export interface FacultyPerfSummaryRow {
  faculty_name: string
  faculty_code?: string
  course_code: string
  registered: number
  attended: number
  passed: number
  pass_pct: number
}

export interface FacultyPerfRpcResponse {
  auto_summary: FacultyPerfSummaryRow[]
  raw_results: Array<{
    usn: string
    course_code: string
    grade_code: string
    is_pass: boolean
    is_attended: boolean
  }>
}

export interface MarksAuditLogRow {
  id: string
  usn: string
  course_code: string
  change_type: 'REVAL_UPGRADE' | 'REVAL_NO_CHANGE' | 'GRACE_APPLIED' | 'MANUAL_CORRECTION'
  old_see: number | null
  new_see: number | null
  old_grade: string | null
  new_grade: string | null
  evaluator_id: string | null
  reason: string | null
  changed_by_label: string | null
  created_at: string
}
