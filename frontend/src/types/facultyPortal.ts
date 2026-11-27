import type { IaQpAllocationRow } from './qpVault'
import type { ProjectPhaseItem, SyllabusFormat, SyllabusModuleItem } from './governance'

export interface FacultyProfileSummary {
  id: string
  employee_code: string
  full_name: string
  email: string | null
  phone: string | null
  designation: string
  academic_unit_id: string | null
  department_label: string | null
  branch_label: string | null
  is_evaluator: boolean
  has_pin: boolean
  unit_code: string | null
  unit_name: string | null
}

export interface FacultySectionAllocationItem {
  id: string
  exam_cycle_id: string | null
  academic_year: string
  term: 'ODD' | 'EVEN' | 'SUMMER'
  program_id: string
  program_code: string
  program_name: string
  academic_unit_id: string | null
  semester_number: number
  section_name: string
  course_id: string
  course_code: string
  course_title: string
  course_type: string
  department_name: string
}

export interface FacultySeeDutyItem {
  id: string
  exam_cycle_id: string
  course_code: string
  course_title: string
  department_name: string
  access_token: string | null
  token_expires_at: string | null
}

export interface FacultyInvigilationItem {
  id: string
  exam_date: string
  session_code: 'FN' | 'AN' | 'CUSTOM'
  duty_role: 'DCS' | 'RELIEVER' | 'INVIGILATOR'
  room_number: string | null
  status: string
  remarks: string | null
}

export interface FacultyEvaluationItem {
  id: string
  course_code: string
  course_title: string
  fifo_rank: number
  assigned_bundles_count: number
  assigned_scripts_count: number
  status: string
  invited_at: string
}

export interface FacultySyllabusItem {
  course_id: string
  course_code: string
  course_title: string
  academic_year: string
  term: string
  syllabus_type: SyllabusFormat
  approval_status: string
  modules_json: SyllabusModuleItem[]
  lab_part_a: string
  lab_part_b: string
  project_phases_json: ProjectPhaseItem[]
  textbooks: string
  reference_books: string
  outcomes: Array<{
    co_code: string
    description: string
    target_bloom_level: string
  }>
}

export interface FacultyPortalSnapshot {
  found: boolean
  can_preview: boolean
  reason?: string
  faculty?: FacultyProfileSummary
  cycle?: {
    id: string
    code: string
    name: string
    cycle_type: string
    academic_year: string
    status: string
  } | null
  public_key_pem?: string | null
  allocations?: FacultySectionAllocationItem[]
  see_duties?: FacultySeeDutyItem[]
  ia_allocations?: IaQpAllocationRow[]
  invigilation_duties?: FacultyInvigilationItem[]
  evaluation_duties?: FacultyEvaluationItem[]
  syllabi?: FacultySyllabusItem[]
}

export interface SectionRosterResponse {
  submission: {
    id: string
    status: 'DRAFT' | 'SUBMITTED' | 'APPROVED'
    max_cie_marks: number
    submitted_at: string | null
    approved_at: string | null
  } | null
  students: Array<{
    student_id: string
    usn: string
    full_name: string
    theory_marks: number
    practical_marks: number
    total_marks: number
    is_absent: boolean
    has_saved: boolean
  }>
}
