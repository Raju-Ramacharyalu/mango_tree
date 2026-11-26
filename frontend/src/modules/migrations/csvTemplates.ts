import Papa from 'papaparse'
import type { MigrationEntityType } from '@/types/migrations'

export interface CsvTemplateConfig {
  entityType: MigrationEntityType
  label: string
  description: string
  requiredColumns: string[]
  headers: string[]
  sampleRow: Record<string, string>
}

export const CSV_TEMPLATES: Record<MigrationEntityType, CsvTemplateConfig> = {
  PROGRAMS: {
    entityType: 'PROGRAMS',
    label: 'Programs / Branches (Legacy master_branches)',
    description: 'Creates programs, optional parent academic units, and default GENERAL specialization tracks.',
    requiredColumns: ['branch_code', 'branch_name'],
    headers: ['branch_code', 'branch_name', 'program_type', 'qualification', 'duration_years', 'dept_code'],
    sampleRow: {
      branch_code: 'CS',
      branch_name: 'Computer Science and Engineering',
      program_type: 'UG',
      qualification: 'B.E.',
      duration_years: '4',
      dept_code: 'CSE',
    },
  },
  COURSE_CATALOG: {
    entityType: 'COURSE_CATALOG',
    label: 'Course Catalog & Curricula (Legacy master_courses)',
    description:
      'Imports universal courses and splits comma-separated branch_code values into curriculum mappings. ONLINE forces CIE=0, SEE=0.',
    requiredColumns: ['course_code', 'title'],
    headers: [
      'course_code',
      'title',
      'branch_code',
      'semester_id',
      'credits',
      'max_cie',
      'max_see',
      'total_marks',
      'course_type',
      'scheme_batch',
      'offering_department',
      'specialization',
    ],
    sampleRow: {
      course_code: '1BMATC101',
      title: 'Differential Calculus and Linear Algebra',
      branch_code: 'CS, IS, AI',
      semester_id: '1',
      credits: '4',
      max_cie: '50',
      max_see: '50',
      total_marks: '100',
      course_type: 'CORE',
      scheme_batch: '25',
      offering_department: 'MAT',
      specialization: 'GENERAL',
    },
  },
  STAFF: {
    entityType: 'STAFF',
    label: 'Staff & Evaluators (Legacy master_staff)',
    description: 'Imports staff profiles. Leave faculty_id blank to auto-generate {BRANCH}{YY}{SEQ:02d}.',
    requiredColumns: ['full_name'],
    headers: ['faculty_id', 'full_name', 'role', 'dept', 'branch', 'email', 'is_evaluator'],
    sampleRow: {
      faculty_id: '',
      full_name: 'Dr. Asha Rao',
      role: 'Associate Professor',
      dept: 'CSE',
      branch: 'CS',
      email: 'asha.rao@amceducation.in',
      is_evaluator: 'true',
    },
  },
  STUDENTS: {
    entityType: 'STUDENTS',
    label: 'Students & Enrollments (Legacy master_students)',
    description:
      'Creates student identities and active enrollments. Leave usn blank for 1st-year admissions to auto-assign TMP-{BRANCH}-{SEQ}.',
    requiredColumns: ['full_name', 'branch_code'],
    headers: [
      'usn',
      'full_name',
      'branch_code',
      'current_sem',
      'section',
      'scheme_batch',
      'contact',
      'email',
      'dob',
      'student_category',
      'specialization',
    ],
    sampleRow: {
      usn: '1AM25CS001',
      full_name: 'ANANYA SHARMA',
      branch_code: 'CS',
      current_sem: '3',
      section: 'A',
      scheme_batch: '25',
      contact: '9876543210',
      email: 'ananya.sharma@student.edu',
      dob: '2006-05-14',
      student_category: 'REGULAR',
      specialization: 'GENERAL',
    },
  },
  STUDENT_USN_MIGRATION: {
    entityType: 'STUDENT_USN_MIGRATION',
    label: 'Temp-to-Official USN Migration',
    description: 'Atomically updates TMP registration numbers to official USNs while preserving UUIDs and admission_number.',
    requiredColumns: ['temp_usn', 'official_usn'],
    headers: ['temp_usn', 'official_usn'],
    sampleRow: {
      temp_usn: 'TMP-CS-001',
      official_usn: '1AM26CS001',
    },
  },
  STUDENT_STATUS: {
    entityType: 'STUDENT_STATUS',
    label: 'Bulk Student Status Update',
    description: 'Updates enrollment_status to ACTIVE, DETAINED, DISCONTINUED, COMPLETED, TRANSFERRED, or SUSPENDED.',
    requiredColumns: ['usn', 'status'],
    headers: ['usn', 'status'],
    sampleRow: {
      usn: '1AM25CS001',
      status: 'DETAINED',
    },
  },
  STUDENT_SPECIALIZATIONS: {
    entityType: 'STUDENT_SPECIALIZATIONS',
    label: 'PG Specialization Track Assignment',
    description: 'Assigns specialization tracks (e.g., FINANCE, HR, DATA_SCIENCE) to students active enrollments.',
    requiredColumns: ['usn', 'specialization'],
    headers: ['usn', 'specialization'],
    sampleRow: {
      usn: '1AM25MBA01',
      specialization: 'FINANCE',
    },
  },
}

export function downloadCsvTemplate(entityType: MigrationEntityType) {
  const cfg = CSV_TEMPLATES[entityType]
  const csv = Papa.unparse([cfg.sampleRow], { columns: cfg.headers })
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `template_${entityType.toLowerCase()}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function normalizeRawHeaders(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) {
    const cleanKey = k.trim().toLowerCase()
    const cleanVal = v === null || v === undefined ? '' : String(v).trim()
    out[cleanKey] = cleanVal
  }
  if (!out.email && out.email_id) out.email = out.email_id
  if (!out.contact && out.phone) out.contact = out.phone
  if (!out.student_category && out.category) out.student_category = out.category
  return out
}

export function normalizeStudentCategory(raw: string): string {
  const v = raw.trim().toUpperCase().replace(/[-/\s]+/g, '_')
  if (!v || v === 'NAN' || v === 'NULL' || v === 'NONE' || v === 'REGULAR') return 'REGULAR'
  if (v.includes('LATERAL')) return 'LATERAL_ENTRY'
  if (v.includes('YEAR_BACK') || v.includes('YEARBACK')) return 'YEAR_BACK'
  if (v.includes('COLLEGE_CHANGE')) return 'COLLEGE_CHANGE'
  if (v.includes('BRANCH_CHANGE') || v.includes('CHANGE_OF_BRANCH')) return 'BRANCH_CHANGE'
  if (v.includes('RE_ADMISSION') || v.includes('READMISSION')) return 'RE_ADMISSION'
  if (v.includes('TRANSFER')) return 'TRANSFER'
  return 'OTHER'
}

export function normalizeProgramLevel(raw: string): string {
  const v = raw.trim().toUpperCase()
  if (v === 'PHD' || v === 'DOCTORAL') return 'DOCTORAL'
  if (v === 'PG') return 'PG'
  if (v === 'DIPLOMA') return 'DIPLOMA'
  if (v === 'INTEGRATED') return 'INTEGRATED'
  if (v === 'CERTIFICATE') return 'CERTIFICATE'
  if (v === 'UG' || !v) return 'UG'
  return 'OTHER'
}

export function parseBool(raw: string): boolean {
  return ['true', 'yes', '1', 'y', 't'].includes(raw.trim().toLowerCase())
}

export function cleanDateString(raw: string): string | null {
  const v = raw.trim()
  if (!v || ['nan', 'none', 'null', '-'].includes(v.toLowerCase())) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v)
  if (dmy) {
    const [, dd, mm, yyyy] = dmy
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  return null
}
