export type WorkspaceContext = 'PLATFORM' | 'INSTITUTION'

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

export interface UserMembership {
  membership_id: string
  institution_id: string
  is_default: boolean
  institution: InstitutionSummary
  roles: string[]
}
