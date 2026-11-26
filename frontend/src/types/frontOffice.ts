export type PaymentMode =
  | 'UPI (QR / App)'
  | 'Bank Transfer (NEFT / RTGS)'
  | 'SBI Direct'
  | 'CASH'
  | 'DD'

export type ReceiptVerificationStatus = 'RECORDED' | 'VERIFIED' | 'RECONCILED' | 'REJECTED'

export interface FeeReceiptRow {
  id: string
  institution_id: string
  exam_cycle_id: string | null
  student_id: string | null
  usn: string
  student_name: string
  program_code: string
  payment_date: string
  amount: number
  payment_type: string
  payment_mode: PaymentMode
  utr_number: string
  college_account: string
  verification_status: ReceiptVerificationStatus
  linked_registration_id: string | null
  remarks: string | null
  entered_by_name: string | null
  created_at: string
}

export interface StudentFrontOfficeRecord {
  id: string
  registration_number: string
  admission_number: string | null
  full_name: string
  photo_url: string | null
  photo_pin: string | null
  photo_upload_count: number
  last_photo_upload: string | null
  program_id: string | null
  program_code: string
  program_name: string
  program_level: string
  current_period_id: string | null
  current_sem: number
  section_name: string | null
  student_category: string
  specialization_code: string
  scheme_batch: number | null
}
