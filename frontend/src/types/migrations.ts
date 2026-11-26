export type MigrationEntityType =
  | 'PROGRAMS'
  | 'COURSE_CATALOG'
  | 'STAFF'
  | 'STUDENTS'
  | 'STUDENT_USN_MIGRATION'
  | 'STUDENT_STATUS'
  | 'STUDENT_SPECIALIZATIONS'

export type ImportMode = 'SAFE' | 'OVERWRITE'

export type StagingRowStatus = 'PENDING' | 'VALID' | 'DUPLICATE' | 'ERROR' | 'IMPORTED' | 'SKIPPED'

export interface StagedPreviewRow {
  rowNumber: number
  sourceKey: string
  rawPayload: Record<string, string>
  normalizedPayload: Record<string, unknown>
  status: 'VALID' | 'DUPLICATE' | 'ERROR'
  messages: string[]
  existingTargetId?: string
}

export interface MigrationJobRecord {
  id: string
  institution_id: string
  source_id: string | null
  entity_type: string
  import_mode: ImportMode
  status: string
  file_name: string | null
  total_rows: number
  valid_rows: number
  imported_rows: number
  skipped_rows: number
  error_rows: number
  started_at: string | null
  completed_at: string | null
  summary: Record<string, unknown>
  created_at: string
}

export interface MigrationErrorRecord {
  id: string
  institution_id: string
  job_id: string
  staging_row_id: string | null
  row_number: number
  field_name: string | null
  error_code: string | null
  error_message: string
  raw_payload: Record<string, unknown> | null
  resolution_status: 'OPEN' | 'CORRECTED' | 'IGNORED' | 'REPROCESSED'
  resolved_at: string | null
  created_at: string
}

export interface MigrationAuditRecord {
  id: string
  institution_id: string
  job_id: string | null
  action: string
  actor_user_id: string | null
  details: Record<string, unknown>
  created_at: string
}
