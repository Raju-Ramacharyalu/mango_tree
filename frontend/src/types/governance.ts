export type SyllabusFormat = 'THEORY' | 'LAB' | 'INTEGRATED' | 'PROJECT'
export type SyllabusApprovalStatus = 'DRAFT' | 'HOD_REVIEW' | 'BOS_APPROVED' | 'PUBLISHED'
export type RubricComponentType =
  | 'THEORY_TEST'
  | 'CCA_ACTIVITY'
  | 'LAB_RECORD'
  | 'LAB_INTERNAL'
  | 'PROJECT_PHASE'
  | 'SEMINAR_PRESENTATION'
export type RubricCalcLogic = 'AVERAGE_BEST_2' | 'AVERAGE_ALL' | 'SUM' | 'SCALE_DOWN'
export type LeaveType = 'CASUAL' | 'MEDICAL' | 'FDP' | 'MATERNITY' | 'ON_DUTY' | 'OTHER'
export type CieSubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED'

export interface BloomsLevel {
  id: number
  code: string
  level_number: number
  name: string
  action_verbs: string
}

export interface SyllabusModuleItem {
  module_number: number
  title: string
  content: string
}

export interface ProjectPhaseItem {
  phase: number
  title: string
  deliverables: string
}

export interface CourseOutcomeDraft {
  co_code: string
  description: string
  target_bloom_level: string
  mappings: Record<string, number | ''>
}

export interface EvaluationRubricDraft {
  component_name: string
  component_type: RubricComponentType
  max_marks: number
  scaled_to: number
  calculation_logic: RubricCalcLogic
}

export interface GovernanceStaffRow {
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
  is_active: boolean
  unit_code: string | null
  unit_name: string | null
}

export interface GovernanceProgramRow {
  id: string
  code: string
  name: string
  program_level: string
  academic_unit_id: string | null
}

export interface GovernanceUnitRow {
  id: string
  code: string
  name: string
}

export interface SectionAllocationRow {
  id: string
  institution_id: string
  exam_cycle_id: string | null
  academic_year: string
  term: 'ODD' | 'EVEN' | 'SUMMER'
  program_id: string
  program_code: string
  semester_number: number
  section_name: string
  course_id: string
  course_code: string
  course_title: string
  staff_profile_id: string
  faculty_code: string
  faculty_name: string
}

export interface FacultyLeaveRow {
  id: string
  staff_profile_id: string
  start_date: string
  end_date: string
  leave_type: LeaveType
  reason: string | null
  status: string
}

export interface CieSubmissionRow {
  id: string
  exam_cycle_id: string | null
  allocation_id: string | null
  academic_year: string
  term: 'ODD' | 'EVEN' | 'SUMMER'
  program_id: string
  program_code: string
  academic_unit_id: string | null
  course_id: string
  course_code: string
  course_title: string
  semester_number: number
  section_name: string
  staff_profile_id: string | null
  faculty_code: string
  faculty_name: string
  max_cie_marks: number
  status: CieSubmissionStatus
  submitted_at: string | null
  approved_at: string | null
}

export interface CieMarkRow {
  student_id: string
  usn: string
  full_name: string
  theory_marks: number
  practical_marks: number
  total_marks: number
  is_absent: boolean
}
