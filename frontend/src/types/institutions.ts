export type OrganizationType = 'TRUST' | 'SOCIETY' | 'UNIVERSITY' | 'GROUP' | 'GOVERNMENT' | 'OTHER'
export type InstitutionType = 'AUTONOMOUS' | 'AFFILIATED' | 'DEEMED' | 'UNIVERSITY' | 'STANDALONE'
export type InstitutionStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'

export interface InstitutionCategory {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
}

export interface Organization {
  id: string
  code: string
  name: string
  organization_type: OrganizationType
  website_url: string | null
  contact_email: string | null
  contact_phone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  country: string
  postal_code: string | null
  is_active: boolean
  created_at: string
}

export interface Institution {
  id: string
  organization_id: string | null
  category_id: string
  code: string
  name: string
  short_name: string | null
  university_affiliation: string | null
  institution_type: InstitutionType
  status: InstitutionStatus
  official_email: string | null
  official_phone: string | null
  website_url: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  country: string
  postal_code: string | null
  timezone: string
  created_at: string
  institution_categories?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
  organizations?: { id: string; code: string; name: string } | { id: string; code: string; name: string }[] | null
}

export interface Campus {
  id: string
  institution_id: string
  code: string
  name: string
  is_primary: boolean
  address_line1: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  contact_phone: string | null
  is_active: boolean
}

export interface InstitutionSetting {
  id: string
  institution_id: string
  setting_group: string
  setting_key: string
  setting_value: unknown
  description: string | null
}
