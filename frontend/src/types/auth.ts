export type WorkspaceContext = 'PLATFORM' | 'INSTITUTION'

export type WorkspaceTier = 'MANAGEMENT' | 'LEAD_TEAM' | 'OPERATIONAL'

export type AdminPreviewTier = 'ALL' | WorkspaceTier

export type RoleScopeLevel = 'INSTITUTION' | 'FIRST_YEAR' | 'ACADEMIC_UNIT' | 'SELF'

export interface UserProfile {
  id: string
  email: string
  full_name: string
  phone: string | null
  avatar_url: string | null
}

export interface InstitutionSummary {
  id: string
  code: string
  name: string
  short_name: string | null
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'
}

export interface RoleDescriptor {
  code: string
  name: string
  role_tier: WorkspaceTier
  scope_level: RoleScopeLevel
}

export interface StaffScopeInfo {
  staff_profile_id: string
  employee_code: string
  designation: string
  academic_unit_id: string | null
  academic_unit_code: string | null
  academic_unit_name: string | null
  is_evaluator: boolean
}

export interface UserMembership {
  membership_id: string
  institution_id: string
  is_default: boolean
  institution: InstitutionSummary
  roles: string[]
  roleDetails: RoleDescriptor[]
  staffScope: StaffScopeInfo | null
}
