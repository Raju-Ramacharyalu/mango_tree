export type IdentifierEntityType = 'STUDENT_TEMP' | 'STUDENT_OFFICIAL' | 'STAFF_ID' | 'COURSE_CODE' | 'CUSTOM'
export type AcademicUnitType = 'SCHOOL' | 'FACULTY' | 'DEPARTMENT' | 'CENTRE' | 'BRANCH' | 'DIVISION'
export type ProgramLevel = 'DIPLOMA' | 'UG' | 'PG' | 'INTEGRATED' | 'DOCTORAL' | 'CERTIFICATE' | 'OTHER'

export interface IdentifierFormat {
  id: string
  institution_id: string
  entity_type: IdentifierEntityType
  name: string
  pattern: string
  validation_regex: string | null
  prefix: string | null
  sequence_padding: number
  is_active: boolean
}

export interface CourseCategory {
  id: string
  institution_id: string
  code: string
  name: string
  is_credit_bearing: boolean
  is_elective: boolean
  is_online: boolean
  default_max_cie: number
  default_max_see: number
  default_total_marks: number
  is_active: boolean
  sort_order: number
}

export interface AssessmentPattern {
  id: string
  institution_id: string
  code: string
  name: string
  max_internal_marks: number
  max_external_marks: number
  total_marks: number
  min_internal_pass: number | null
  min_external_pass: number | null
  min_total_pass: number | null
  is_active: boolean
}

export interface GradeScaleItem {
  id: string
  institution_id: string
  grading_scale_id: string
  grade_code: string
  description: string
  grade_point: number
  min_percentage: number | null
  max_percentage: number | null
  is_pass: boolean
  sort_order: number
}

export interface GradingScale {
  id: string
  institution_id: string
  code: string
  name: string
  is_default: boolean
  is_active: boolean
  grade_scale_items?: GradeScaleItem[]
}

export interface AcademicUnit {
  id: string
  institution_id: string
  campus_id: string | null
  parent_unit_id: string | null
  unit_type: AcademicUnitType
  code: string
  name: string
  is_active: boolean
}

export interface ProgramVersion {
  id: string
  institution_id: string
  program_id: string
  version_code: string
  name: string
  effective_from_year: number | null
  effective_to_year: number | null
  is_active: boolean
}

export interface ProgramSpecialization {
  id: string
  institution_id: string
  program_id: string
  code: string
  name: string
  is_default: boolean
  is_active: boolean
}

export interface Program {
  id: string
  institution_id: string
  academic_unit_id: string | null
  code: string
  name: string
  qualification: string
  program_level: ProgramLevel
  duration_years: number
  total_credits_required: number | null
  is_active: boolean
  academic_units?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}

export interface AcademicPeriodType {
  id: string
  institution_id: string
  code: string
  name: string
  periods_per_year: number
  is_active: boolean
}

export interface AcademicPeriod {
  id: string
  institution_id: string
  period_type_id: string
  code: string
  name: string
  sequence_number: number
  term_group: string | null
  legacy_semester_id: number | null
  is_active: boolean
  academic_period_types?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}

export interface AcademicBatch {
  id: string
  institution_id: string
  program_id: string
  curriculum_id: string | null
  code: string
  name: string
  admission_year: number
  expected_graduation_year: number | null
  scheme_batch: number | null
  is_active: boolean
  programs?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}

export interface AcademicSection {
  id: string
  institution_id: string
  program_id: string
  academic_batch_id: string | null
  academic_period_id: string
  academic_year: string
  section_name: string
  max_capacity: number
  is_active: boolean
  programs?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
  academic_periods?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}

export interface CourseCatalogItem {
  id: string
  institution_id: string
  offering_academic_unit_id: string | null
  course_category_id: string | null
  course_code: string
  title: string
  short_title: string | null
  default_credits: number
  is_active: boolean
  academic_units?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
  course_categories?: { id: string; code: string; name: string; is_online: boolean } | { id: string; code: string; name: string; is_online: boolean }[] | null
}

export interface Curriculum {
  id: string
  institution_id: string
  program_id: string
  program_version_id: string | null
  period_type_id: string
  grading_scale_id: string | null
  code: string
  name: string
  scheme_batch: number | null
  version_number: number
  is_active: boolean
  programs?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
  academic_period_types?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}

export interface CurriculumCourse {
  id: string
  institution_id: string
  curriculum_id: string
  course_id: string
  academic_period_id: string
  program_specialization_id: string | null
  course_category_id: string | null
  assessment_pattern_id: string | null
  credits: number
  l_hours: number
  t_hours: number
  p_hours: number
  saae_hours: number
  max_internal_marks: number
  max_external_marks: number
  total_marks: number
  exam_duration_hours: number
  is_elective: boolean
  is_lab: boolean
  is_active: boolean
  course_catalog?: { id: string; course_code: string; title: string } | { id: string; course_code: string; title: string }[] | null
  academic_periods?: { id: string; code: string; name: string; sequence_number: number } | { id: string; code: string; name: string; sequence_number: number }[] | null
  course_categories?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}
