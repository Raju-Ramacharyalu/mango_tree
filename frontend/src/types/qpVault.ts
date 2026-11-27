export type PaperFormat = 'STANDARD' | 'MBA' | 'OMR'
export type IaQpPattern = 'DESCRIPTIVE' | 'OMR_50' | 'OMR_25'

export interface InstitutionVaultKey {
  id: string
  institution_id: string
  public_key_pem: string
  key_fingerprint: string
  algorithm: string
  rotated_at: string
}

export interface BoeNominationRow {
  id: string
  institution_id: string
  exam_cycle_id: string
  course_id: string | null
  course_code: string
  academic_unit_id: string | null
  department_name: string
  faculty_type: 'Internal' | 'External'
  staff_profile_id: string | null
  faculty_code: string | null
  setter_name: string
  designation: string
  college_name: string
  college_address: string
  mobile: string
  email: string
  nomination_status: 'DRAFT' | 'SUBMITTED'
  is_selected: boolean
  is_exported: boolean
  is_received: boolean
  access_token: string | null
  token_expires_at: string | null
  created_at: string
}

export interface SeeSubmittedPaperRow {
  id: string
  institution_id: string
  exam_cycle_id: string
  nomination_id: string
  course_code: string
  setter_email: string
  paper_format: PaperFormat
  encrypted_aes_key: string
  encrypted_payload: string
  status: 'SUBMITTED' | 'PRINTED' | 'ARCHIVED'
  submitted_at: string
}

export interface IaQpAllocationRow {
  id: string
  institution_id: string
  exam_cycle_id: string
  course_id: string
  course_code: string
  course_title: string
  course_type: string
  staff_profile_id: string
  faculty_code: string
  faculty_name: string
  ia_number: 1 | 2 | 3
  num_sets: number
  qp_pattern: IaQpPattern
  max_marks: number
  duration_minutes: number
  qp_content: string | null
  status: 'DRAFT' | 'SUBMITTED'
  updated_at: string
}

export interface PlatformLatexEquation {
  id: number
  category: string
  title: string
  description: string
  latex_code: string
}

export interface IaDescriptivePart {
  id: string
  text: string
  marks: string
  co: string
  blooms: string
  image?: string | null
}

export interface IaDescriptiveQuestion {
  qNum: number
  targetMarks: number
  parts: IaDescriptivePart[]
}

export interface IaOmrQuestion {
  qNum: number
  isOmr: true
  text: string
  options: { A: string; B: string; C: string; D: string }
  ans: 'A' | 'B' | 'C' | 'D'
  marks: string
  co: string
  blooms: string
  image?: string | null
}

export type IaQuestionSet = IaDescriptiveQuestion[] | IaOmrQuestion[]

export interface IaVaultPayload {
  qpPattern: IaQpPattern
  setsMap: Record<number, IaQuestionSet>
  coStatements: string
}

export interface IaEncryptedEnvelope {
  v: 1
  encrypted: true
  qp_pattern: IaQpPattern
  iv: string
  cipher: string
  pin_iv: string
  faculty_lock: string
  coe_lock: string | null
}

export interface SeeSubQuestion {
  text: string
  image: string | null
  scheme: string
  marks: string
  bloom: string
  co: string
}

export interface SeeQuestionBlock {
  a: SeeSubQuestion
  b: SeeSubQuestion
  c: SeeSubQuestion
}

export interface SeeOmrItem {
  text: string
  image: string | null
  optA: string
  optB: string
  optC: string
  optD: string
  answer: 'A' | 'B' | 'C' | 'D'
  bloom: string
  co: string
}

export interface SeeDecryptedPayload {
  course: string
  format: PaperFormat
  setter: string
  department: string
  timestamp: string
  modules?: Record<string, { q1: SeeQuestionBlock; q2: SeeQuestionBlock }>
  questions?: Record<string, SeeQuestionBlock | SeeOmrItem>
}
