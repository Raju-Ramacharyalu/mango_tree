import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import type {
  AdminPreviewTier,
  InstitutionSummary,
  RoleDescriptor,
  RoleScopeLevel,
  StaffScopeInfo,
  UserMembership,
  UserProfile,
  WorkspaceContext,
  WorkspaceTier,
} from '@/types/auth'
import { ROLE_FALLBACK_META } from './rbac'

interface PlatformRoleRow {
  platform_roles: { code: string } | { code: string }[] | null
}

interface RawInstitutionRole {
  code: string
  name?: string | null
  role_tier?: string | null
  scope_level?: string | null
}

interface MembershipRow {
  id: string
  institution_id: string
  is_default: boolean
  institutions: InstitutionSummary | InstitutionSummary[] | null
  membership_roles: Array<{
    institution_roles: RawInstitutionRole | RawInstitutionRole[] | null
  }> | null
}

interface StaffProfileScopeRow {
  id: string
  institution_id: string
  employee_code: string
  designation: string
  academic_unit_id: string | null
  is_evaluator: boolean
  academic_units: { code: string; name: string } | { code: string; name: string }[] | null
}

interface AppState {
  session: Session | null
  profile: UserProfile | null
  platformRoles: string[]
  memberships: UserMembership[]
  context: WorkspaceContext
  activeInstitutionId: string | null
  activeExamCycleId: string | null
  previewTier: AdminPreviewTier
  isLoadingAuth: boolean
  error: string | null
  initializeSession: (session: Session | null) => Promise<void>
  setContext: (ctx: WorkspaceContext) => void
  setActiveInstitution: (institutionId: string) => void
  setActiveExamCycle: (cycleId: string | null) => void
  setPreviewTier: (tier: AdminPreviewTier) => void
  signOut: () => Promise<void>
}

function normalizeRoleDescriptor(raw: RawInstitutionRole): RoleDescriptor {
  const code = raw.code.trim().toUpperCase()
  const fb = ROLE_FALLBACK_META[code]
  const tier =
    raw.role_tier === 'MANAGEMENT' || raw.role_tier === 'LEAD_TEAM' || raw.role_tier === 'OPERATIONAL'
      ? (raw.role_tier as WorkspaceTier)
      : (fb?.tier ?? 'OPERATIONAL')
  const scope =
    raw.scope_level === 'INSTITUTION' ||
    raw.scope_level === 'FIRST_YEAR' ||
    raw.scope_level === 'ACADEMIC_UNIT' ||
    raw.scope_level === 'SELF'
      ? (raw.scope_level as RoleScopeLevel)
      : (fb?.scope ?? 'INSTITUTION')

  return {
    code,
    name: raw.name?.trim() || code,
    role_tier: tier,
    scope_level: scope,
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  session: null,
  profile: null,
  platformRoles: [],
  memberships: [],
  context: 'INSTITUTION',
  activeInstitutionId: null,
  activeExamCycleId: null,
  previewTier: 'ALL',
  isLoadingAuth: true,
  error: null,

  initializeSession: async (session) => {
    if (!session?.user) {
      set({
        session: null,
        profile: null,
        platformRoles: [],
        memberships: [],
        activeInstitutionId: null,
        activeExamCycleId: null,
        context: 'INSTITUTION',
        previewTier: 'ALL',
        isLoadingAuth: false,
        error: null,
      })
      return
    }

    const isInitialLoad = !get().profile
    set({ session, isLoadingAuth: isInitialLoad, error: null })
    const userId = session.user.id

    try {
      const [profileRes, platformRolesRes, membershipsRes, prefRes, staffRes] = await Promise.all([
        supabase.from('user_profiles').select('id, email, full_name, phone, avatar_url').eq('id', userId).single(),
        supabase
          .from('user_platform_roles')
          .select('platform_roles(code)')
          .eq('user_id', userId)
          .eq('is_active', true),
        supabase
          .from('institution_memberships')
          .select(`
            id,
            institution_id,
            is_default,
            institutions (id, code, name, short_name, status),
            membership_roles (institution_roles (code, name, role_tier, scope_level))
          `)
          .eq('user_id', userId)
          .eq('status', 'ACTIVE'),
        supabase
          .from('user_preferences')
          .select('default_institution_id, preferred_context')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('staff_profiles')
          .select('id, institution_id, employee_code, designation, academic_unit_id, is_evaluator, academic_units(code, name)')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .eq('is_active', true),
      ])

      const staffByInst = new Map<string, StaffScopeInfo>()
      for (const row of (staffRes.data ?? []) as unknown as StaffProfileScopeRow[]) {
        const unit = Array.isArray(row.academic_units) ? row.academic_units[0] : row.academic_units
        staffByInst.set(row.institution_id, {
          staff_profile_id: row.id,
          employee_code: row.employee_code,
          designation: row.designation,
          academic_unit_id: row.academic_unit_id,
          academic_unit_code: unit?.code ?? null,
          academic_unit_name: unit?.name ?? null,
          is_evaluator: Boolean(row.is_evaluator),
        })
      }

      const platformRoles = ((platformRolesRes.data ?? []) as unknown as PlatformRoleRow[])
        .map((r) => (Array.isArray(r.platform_roles) ? r.platform_roles[0]?.code : r.platform_roles?.code))
        .filter((code): code is string => Boolean(code))

      const memberships: UserMembership[] = ((membershipsRes.data ?? []) as unknown as MembershipRow[])
        .map((m) => {
          const inst = Array.isArray(m.institutions) ? m.institutions[0] : m.institutions
          if (!inst) return null
          const roleDetails = (m.membership_roles ?? [])
            .map((mr) =>
              Array.isArray(mr.institution_roles) ? mr.institution_roles[0] : mr.institution_roles
            )
            .filter((r): r is RawInstitutionRole => Boolean(r?.code))
            .map(normalizeRoleDescriptor)
          return {
            membership_id: m.id,
            institution_id: m.institution_id,
            is_default: m.is_default,
            institution: inst,
            roles: roleDetails.map((r) => r.code),
            roleDetails,
            staffScope: staffByInst.get(m.institution_id) ?? null,
          }
        })
        .filter((item): item is UserMembership => item !== null)

      const hasPlatformAccess = platformRoles.length > 0
      const prefContext = prefRes.data?.preferred_context as WorkspaceContext | undefined
      const initialContext: WorkspaceContext =
        prefContext === 'PLATFORM' && hasPlatformAccess
          ? 'PLATFORM'
          : memberships.length > 0
            ? 'INSTITUTION'
            : hasPlatformAccess
              ? 'PLATFORM'
              : 'INSTITUTION'

      const preferredInstId = prefRes.data?.default_institution_id as string | undefined
      const validPreferred = memberships.find((m) => m.institution_id === preferredInstId)?.institution_id
      const defaultInst = memberships.find((m) => m.is_default)?.institution_id ?? memberships[0]?.institution_id ?? null

      set({
        profile: (profileRes.data as UserProfile | null) ?? null,
        platformRoles,
        memberships,
        context: isInitialLoad ? initialContext : get().context,
        activeInstitutionId: isInitialLoad ? (validPreferred ?? defaultInst) : (get().activeInstitutionId ?? defaultInst),
        isLoadingAuth: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load user workspace'
      set({ error: message, isLoadingAuth: false })
    }
  },

  setContext: (ctx) => {
    const { platformRoles, memberships } = get()
    if (ctx === 'PLATFORM' && platformRoles.length === 0) return
    if (ctx === 'INSTITUTION' && memberships.length === 0) return
    set({ context: ctx, previewTier: 'ALL' })
  },

  setActiveInstitution: (institutionId) => {
    const valid = get().memberships.some((m) => m.institution_id === institutionId)
    if (!valid) return
    set({
      activeInstitutionId: institutionId,
      activeExamCycleId: null,
      context: 'INSTITUTION',
      previewTier: 'ALL',
    })
  },

  setActiveExamCycle: (cycleId) => {
    set({ activeExamCycleId: cycleId })
  },

  setPreviewTier: (tier) => {
    set({ previewTier: tier })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({
      session: null,
      profile: null,
      platformRoles: [],
      memberships: [],
      activeInstitutionId: null,
      activeExamCycleId: null,
      context: 'INSTITUTION',
      previewTier: 'ALL',
    })
  },
}))
