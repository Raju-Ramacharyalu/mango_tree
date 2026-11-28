export type ExamCycleType = 'REGULAR' | 'ARREAR' | 'SUPPLEMENTARY' | 'SUMMER' | 'ODE' | 'MAKEUP'

export type ResultPublishStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED'

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
  result_publish_status?: ResultPublishStatus
  result_submitted_at?: string | null
  result_approved_at?: string | null
  result_publish_remarks?: string | null
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

export type ExamSessionCode = 'FN' | 'AN' | 'CUSTOM'

export type HallTicketStatus = 'ISSUED' | 'WITHHELD' | 'REVOKED'

export interface ExamTimetableSlot {
  id: string
  institution_id: string
  exam_cycle_id: string
  course_id: string
  exam_date: string
  session_code: ExamSessionCode
  start_time: string
  end_time: string
  duration_hours: number
  is_omr_exam: boolean
  qp_code: string | null
  remarks: string | null
  course_code: string
  course_title: string
}

export interface AppearingRow {
  reg_course_id: string
  registration_id: string
  registration_status: RegistrationStatus
  payment_status: PaymentStatus
  student_id: string
  student_reg_no: string
  student_name: string
  program_id: string
  program_code: string
  program_name: string
  period_id: string | null
  period_name: string | null
  section_name: string | null
  course_id: string
  course_code: string
  course_title: string
  attempt_number: number
  registration_category: RegistrationCourseCategory
  is_online_exempt: boolean
  eligibility_status: EligibilityStatus
  exam_date: string | null
  session_code: ExamSessionCode | null
  start_time: string | null
  end_time: string | null
  is_omr_exam: boolean
}

export interface HallTicketCourseLine {
  course_code: string
  course_title: string
  attempt_number: number
  registration_category: RegistrationCourseCategory
  is_online_exempt: boolean
  eligibility_status: EligibilityStatus
  exam_date: string | null
  session_code: ExamSessionCode | null
  start_time: string | null
  end_time: string | null
  is_omr_exam: boolean
}

export interface HallTicketItem {
  id: string
  institution_id: string
  exam_cycle_id: string
  registration_id: string
  student_id: string
  ticket_number: string
  verification_code: string
  status: HallTicketStatus
  withheld_reason: string | null
  eligible_course_count: number
  print_count: number
  last_printed_at: string | null
  issued_at: string
  student_reg_no: string
  student_name: string
  student_photo_url: string | null
  program_id: string
  program_code: string
  program_name: string
  period_name: string | null
  section_name: string | null
  registration_type: ExamCycleType
  payment_status: PaymentStatus
  courses: HallTicketCourseLine[]
}

export type AllotmentRunStatus = 'DRAFT' | 'PUBLISHED' | 'LOCKED'

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'MALPRACTICE' | 'EXEMPT'

export interface ExamRoom {
  id: string
  institution_id: string
  campus_id: string | null
  room_number: string
  room_name: string | null
  block_name: string | null
  floor_label: string | null
  capacity: number
  rows_count: number
  columns_count: number
  sort_order: number
  remarks: string | null
  is_active: boolean
}

export interface ExamCourseAlias {
  id: string
  institution_id: string
  source_course_code: string
  canonical_course_code: string
  remarks: string | null
  is_active: boolean
}

export interface ExamRoomAllotmentRun {
  id: string
  institution_id: string
  exam_cycle_id: string
  exam_date: string
  session_code: ExamSessionCode
  status: AllotmentRunStatus
  small_branch_threshold: number
  interleave_descriptive: boolean
  omr_sequential: boolean
  total_students: number
  total_rooms_used: number
  created_at: string
  updated_at: string
}

export interface ExamSeatAllotmentItem {
  id: string
  institution_id: string
  exam_cycle_id: string
  allotment_run_id: string
  room_id: string
  room_number: string
  room_name: string | null
  block_name: string | null
  floor_label: string | null
  room_remarks: string | null
  exam_date: string
  session_code: ExamSessionCode
  seat_number: number
  seat_label: string
  student_id: string
  student_reg_no: string
  student_name: string
  registration_id: string
  registration_course_id: string
  course_id: string
  course_code: string
  course_title: string
  effective_course_code: string
  program_id: string
  program_code: string
  program_name: string
  is_omr_exam: boolean
  attendance_status: AttendanceStatus
  booklet_number: string | null
  remarks: string | null
}

export type BundleStatus = 'CREATED' | 'DISPATCHED' | 'EVALUATED' | 'DECODED' | 'LOCKED'

export type ScriptEvalStatus = 'PENDING' | 'ENTERED' | 'VERIFIED' | 'DECODED'

export type CourseResultStatus = 'PENDING' | 'PASS' | 'FAIL' | 'ABSENT' | 'MALPRACTICE' | 'EXEMPT' | 'WITHHELD'

export type SemesterResultStatus = 'PENDING' | 'PASS' | 'FAIL' | 'WITHHELD'

export interface ExamScriptBundle {
  id: string
  institution_id: string
  exam_cycle_id: string
  course_id: string
  effective_course_code: string
  course_title: string
  program_id: string
  program_code: string
  program_level: ProgramLevel
  usn_series_prefix: string | null
  bundle_code: string
  bundle_sequence: number
  max_bundle_size: number
  script_count: number
  see_max_marks: number
  see_scale_to: number
  evaluation_pattern_code?: string
  locked_from_form_a?: boolean
  evaluator_staff_id: string | null
  evaluator_name: string | null
  status: BundleStatus
  dispatched_at: string | null
  evaluated_at: string | null
  decoded_at: string | null
  remarks: string | null
  created_at: string
}

export interface ExamBundleScriptItem {
  id: string
  bundle_id: string
  seat_allotment_id: string | null
  registration_id: string
  registration_course_id: string
  student_id: string
  student_reg_no: string
  student_name: string
  course_id: string
  program_id: string
  script_sequence: number
  dummy_code: string
  booklet_number: string | null
  see_marks_raw: number | null
  see_marks_scaled: number | null
  moderation_marks?: number | null
  final_see_marks?: number | null
  is_absent: boolean
  is_malpractice: boolean
  evaluation_status: ScriptEvalStatus
  evaluator_remarks: string | null
}

export interface ExamCourseResultItem {
  id: string
  institution_id: string
  exam_cycle_id: string
  registration_id: string
  registration_course_id: string
  student_id: string
  student_reg_no: string
  student_name: string
  course_id: string
  course_code: string
  course_title: string
  effective_course_code: string
  program_id: string
  program_code: string
  program_level: ProgramLevel
  period_name: string | null
  credits: number
  is_online_exempt: boolean
  cie_marks: number | null
  cie_max_marks: number
  see_marks: number | null
  see_max_marks: number
  total_marks: number | null
  max_total_marks: number
  percentage: number | null
  grade_code: string | null
  grade_point: number | null
  result_status: CourseResultStatus
  source_bundle_id: string | null
  is_published: boolean
  remarks: string | null
}

export interface ExamSemesterResultItem {
  id: string
  institution_id: string
  exam_cycle_id: string
  registration_id: string
  student_id: string
  student_reg_no: string
  student_name: string
  program_id: string
  program_code: string
  program_name: string
  program_level: ProgramLevel
  academic_period_id: string | null
  period_name: string | null
  total_courses: number
  passed_courses: number
  failed_courses: number
  credits_registered: number
  credits_earned: number
  total_grade_points: number
  sgpa: number
  overall_status: SemesterResultStatus
  is_withheld?: boolean
  withheld_reason?: string | null
  pre_withhold_status?: string | null
  is_published: boolean
  published_at: string | null
}

export interface GradeScaleItemRow {
  grade_code: string
  description: string
  grade_point: number
  min_percentage: number | null
  max_percentage: number | null
  is_pass: boolean
  sort_order: number
}

export interface EvaluatorStaffOption {
  id: string
  employee_code: string
  full_name: string
  department_label: string | null
  is_evaluator: boolean
}
