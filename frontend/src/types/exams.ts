export type ExamCycleType = 'REGULAR' | 'ARREAR' | 'SUPPLEMENTARY' | 'SUMMER' | 'ODE' | 'MAKEUP'

export type ExamCycleStatus =
  | 'DRAFT'
  | 'REGISTRATION_OPEN'
  | 'LOCKED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ARCHIVED'

export type RegistrationStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export type PaymentStatus = 'PENDING' | 'PAID' | 'WAIVED' | 'REFUNDED'

export type RegistrationCourseCategory = 'REGULAR' | 'ARREAR' | 'IMPROVEMENT' | 'SUMMER' | 'ODE'

export type EligibilityStatus = 'ELIGIBLE' | 'DETAINED' | 'EXEMPT' | 'WITHHELD'

export type ProgramLevel =
  | 'DIPLOMA'
  | 'UG'
  | 'PG'
  | 'INTEGRATED'
  | 'DOCTORAL'
  | 'CERTIFICATE'
  | 'OTHER'

export interface ExamCycle {
  id: string
  institution_id: string
  code: string
  name: string
  academic_year: string
  cycle_type: ExamCycleType
  status: ExamCycleStatus
  is_default_active: boolean
  registration_starts_at: string | null
  registration_ends_at: string | null
  late_fee_starts_at: string | null
  exam_starts_on: string | null
  exam_ends_on: string | null
  created_at: string
  updated_at: string
}

export interface ExamFeeRule {
  id: string
  institution_id: string
  exam_cycle_id: string | null
  cycle_type: ExamCycleType
  program_level: ProgramLevel | null
  rule_name: string
  currency: string
  application_fee: number
  grade_card_fee: number
  first_attempt_subject_fee: number
  subsequent_attempt_subject_fee: number
  online_course_fee: number
  late_fee: number
  is_active: boolean
  created_at: string
}

export interface CourseCatalogOption {
  id: string
  course_code: string
  title: string
  default_credits: number
  is_online: boolean
  category_code: string | null
}

export interface ExamRegistrationCourseItem {
  id: string
  registration_id: string
  course_id: string
  attempt_number: number
  registration_category: RegistrationCourseCategory
  is_online_exempt: boolean
  subject_fee: number
  eligibility_status: EligibilityStatus
  course_code: string
  course_title: string
}

export interface ExamRegistrationItem {
  id: string
  institution_id: string
  exam_cycle_id: string
  student_id: string
  enrollment_id: string | null
  program_id: string
  academic_period_id: string | null
  registration_type: ExamCycleType
  status: RegistrationStatus
  application_fee: number
  grade_card_fee: number
  subject_fee_total: number
  late_fee: number
  total_fee: number
  payment_status: PaymentStatus
  payment_reference: string | null
  paid_at: string | null
  approved_at: string | null
  remarks: string | null
  created_at: string
  student_reg_no: string
  student_name: string
  program_code: string
  program_name: string
  period_name: string | null
  courses: ExamRegistrationCourseItem[]
}
