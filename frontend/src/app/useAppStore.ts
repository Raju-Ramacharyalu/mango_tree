import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/services/supabase'
import type { InstitutionSummary, UserMembership, UserProfile, WorkspaceContext } from '@/types/auth'

interface PlatformRoleRow {
  platform_roles: { code: string } | { code: string }[] | null
}

interface MembershipRow {
  id: string
  institution_id: string
  is_default: boolean
  institutions: InstitutionSummary | InstitutionSummary[] | null
  membership_roles: Array<{
    institution_roles: { code: string } | { code: string }[] | null
  }> | null
}

interface AppState {
  session: Session | null
  profile: UserProfile | null
  platformRoles: string[]
  memberships: UserMembership[]
  context: WorkspaceContext
  activeInstitutionId: string | null
  activeExamCycleId: string | null
  isLoadingAuth: boolean
  error: string | null
  initializeSession: (session: Session | null) => Promise<void>
  setContext: (ctx: WorkspaceContext) => void
  setActiveInstitution: (institutionId: string) => void
  setActiveExamCycle: (cycleId: string | null) => void
  signOut: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  session: null,
  profile: null,
  platformRoles: [],
  memberships: [],
  context: 'INSTITUTION',
  activeInstitutionId: null,
  activeExamCycleId: null,
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
        isLoadingAuth: false,
        error: null,
      })
      return
    }

    const isInitialLoad = !get().profile
    set({ session, isLoadingAuth: isInitialLoad, error: null })
    const userId = session.user.id

    try {
      const [profileRes, platformRolesRes, membershipsRes, prefRes] = await Promise.all([
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
            membership_roles (institution_roles (code))
          `)
          .eq('user_id', userId)
          .eq('status', 'ACTIVE'),
        supabase
          .from('user_preferences')
          .select('default_institution_id, preferred_context')
          .eq('user_id', userId)
          .maybeSingle(),
      ])

      const platformRoles = ((platformRolesRes.data ?? []) as unknown as PlatformRoleRow[])
        .map((r) => (Array.isArray(r.platform_roles) ? r.platform_roles[0]?.code : r.platform_roles?.code))
        .filter((code): code is string => Boolean(code))

      const memberships: UserMembership[] = ((membershipsRes.data ?? []) as unknown as MembershipRow[])
        .map((m) => {
          const inst = Array.isArray(m.institutions) ? m.institutions[0] : m.institutions
          if (!inst) return null
          const roles = (m.membership_roles ?? [])
            .map((mr) =>
              Array.isArray(mr.institution_roles) ? mr.institution_roles[0]?.code : mr.institution_roles?.code
            )
            .filter((code): code is string => Boolean(code))
          return {
            membership_id: m.id,
            institution_id: m.institution_id,
            is_default: m.is_default,
            institution: inst,
            roles,
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
    set({ context: ctx })
  },

  setActiveInstitution: (institutionId) => {
    const valid = get().memberships.some((m) => m.institution_id === institutionId)
    if (!valid) return
    set({ activeInstitutionId: institutionId, activeExamCycleId: null, context: 'INSTITUTION' })
  },

  setActiveExamCycle: (cycleId) => {
    set({ activeExamCycleId: cycleId })
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
    })
  },
}))
