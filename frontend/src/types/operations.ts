export type DutyType = 'INVIGILATION' | 'EVALUATION' | 'BOTH'
export type DutyRole = 'DCS' | 'RELIEVER' | 'INVIGILATOR'
export type EvaluationDutyStatus = 'INVITED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED'

export interface DutyNominationRow {
  id: string
  institution_id: string
  exam_cycle_id: string
  staff_profile_id: string
  faculty_code: string
  faculty_name: string
  designation: string
  department_name: string
  duty_type: DutyType
  course_id: string | null
  course_code: string | null
  available_from: string | null
  available_to: string | null
  nomination_status: 'NOMINATED' | 'APPROVED' | 'WITHDRAWN'
  nominated_at: string
  remarks: string | null
}

export interface InvigilationDutyRow {
  id: string
  institution_id: string
  exam_cycle_id: string
  exam_date: string
  session_code: 'FN' | 'AN' | 'CUSTOM'
  staff_profile_id: string
  faculty_code: string
  faculty_name: string
  designation: string
  department_name: string
  duty_role: DutyRole
  room_id: string | null
  room_number: string | null
  status: 'ASSIGNED' | 'CONFIRMED' | 'COMPLETED' | 'EXCUSED'
  remarks: string | null
}

export interface EvaluationDutyRow {
  id: string
  institution_id: string
  exam_cycle_id: string
  course_id: string
  course_code: string
  staff_profile_id: string
  faculty_code: string
  faculty_name: string
  designation: string
  department_name: string
  fifo_rank: number
  assigned_bundles_count: number
  assigned_scripts_count: number
  status: EvaluationDutyStatus
  invited_at: string
  completed_at: string | null
  remarks: string | null
}

export interface StudentPortalSnapshot {
  found: boolean
  can_preview: boolean
  reason?: string
  student?: {
    id: string
    registration_number: string
    admission_number: string | null
    full_name: string
    email: string | null
    phone: string | null
    photo_url: string | null
    photo_pin: string | null
    program_code: string | null
    program_name: string | null
    current_sem: number
    section_name: string | null
    student_category: string
  }
  cycle?: {
    id: string
    code: string
    name: string
    cycle_type: string
    academic_year: string
    status: string
  } | null
  withheld_notice?: {
    is_withheld: boolean
    reason: string | null
  } | null
  registration?: {
    id: string
    registration_type: string
    status: string
    payment_status: string
    payment_reference: string | null
    total_fee: number
  } | null
  hall_ticket?: {
    id: string
    ticket_number: string
    verification_code: string
    status: 'ISSUED' | 'WITHHELD' | 'REVOKED'
    withheld_reason: string | null
    eligible_course_count: number
    issued_at: string
  } | null
  registered_courses?: Array<{
    course_id: string
    course_code: string
    course_title: string
    credits: number
    registration_category: string
    eligibility_status: string
    exam_date: string | null
    session_code: string | null
    start_time: string | null
    end_time: string | null
    is_omr_exam: boolean
    room_number: string | null
    block_name: string | null
    floor_label: string | null
    seat_label: string | null
    attendance_status: string | null
  }>
  semester_result?: {
    total_courses: number
    passed_courses: number
    failed_courses: number
    credits_registered: number
    credits_earned: number
    sgpa: number
    overall_status: string
    published_at: string | null
  } | null
  course_results?: Array<{
    course_code: string
    course_title: string
    credits: number
    cie_marks: number | null
    see_marks: number | null
    total_marks: number | null
    grade_code: string | null
    grade_point: number | null
    result_status: string
  }>
}
