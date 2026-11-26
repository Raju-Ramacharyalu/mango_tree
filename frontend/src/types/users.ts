export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'

export interface DirectoryUser {
  id: string
  email: string
  full_name: string
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface PlatformRoleRecord {
  id: string
  code: string
  name: string
  description: string | null
}

export interface UserPlatformRoleRecord {
  id: string
  user_id: string
  platform_role_id: string
  is_active: boolean
  created_at: string
  user_profiles: { id: string; email: string; full_name: string } | { id: string; email: string; full_name: string }[] | null
  platform_roles: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}

export interface InstitutionRoleRecord {
  id: string
  institution_id: string
  code: string
  name: string
  description: string | null
  is_system: boolean
  is_active: boolean
  role_permissions?: Array<{ id: string; permission_code: string }>
}

export interface MembershipDetail {
  id: string
  institution_id: string
  user_id: string
  status: MembershipStatus
  is_default: boolean
  joined_at: string | null
  created_at: string
  user_profiles: { id: string; email: string; full_name: string } | { id: string; email: string; full_name: string }[] | null
  institutions: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
  membership_roles: Array<{
    id: string
    institution_role_id: string
    institution_roles: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
  }> | null
}

export interface StaffProfileRecord {
  id: string
  institution_id: string
  user_id: string | null
  employee_code: string
  full_name: string
  email: string | null
  phone: string | null
  designation: string
  department_label: string | null
  branch_label: string | null
  is_evaluator: boolean
  is_active: boolean
}

export interface AuditLogRecord {
  id: string
  institution_id: string | null
  actor_user_id: string | null
  table_name: string
  record_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'CUSTOM'
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  created_at: string
  institutions: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}
