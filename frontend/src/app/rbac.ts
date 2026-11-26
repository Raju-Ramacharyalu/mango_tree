import type {
  AdminPreviewTier,
  RoleDescriptor,
  RoleScopeLevel,
  UserMembership,
  WorkspaceContext,
  WorkspaceTier,
} from '@/types/auth'

export type ExamTabId =
  | 'cycles'
  | 'fees'
  | 'registrations'
  | 'timetable'
  | 'appearing'
  | 'hall-tickets'
  | 'allotments'
  | 'forms-qpds'
  | 'bundles'
  | 'results'
  | 'branding'

export const ROLE_FALLBACK_META: Record<string, { tier: WorkspaceTier; scope: RoleScopeLevel }> = {
  INSTITUTION_ADMIN: { tier: 'LEAD_TEAM', scope: 'INSTITUTION' },
  TRUST_ADMIN: { tier: 'MANAGEMENT', scope: 'INSTITUTION' },
  MANAGEMENT_EXEC: { tier: 'MANAGEMENT', scope: 'INSTITUTION' },
  FINANCE_CONTROLLER: { tier: 'MANAGEMENT', scope: 'INSTITUTION' },
  PRINCIPAL_DIRECTOR: { tier: 'LEAD_TEAM', scope: 'INSTITUTION' },
  EXAM_CONTROLLER: { tier: 'LEAD_TEAM', scope: 'INSTITUTION' },
  DEAN_ACADEMICS: { tier: 'LEAD_TEAM', scope: 'INSTITUTION' },
  DEAN_FIRST_YEAR: { tier: 'LEAD_TEAM', scope: 'FIRST_YEAR' },
  ACADEMIC_ADVISOR: { tier: 'LEAD_TEAM', scope: 'INSTITUTION' },
  HOD: { tier: 'LEAD_TEAM', scope: 'ACADEMIC_UNIT' },
  BOS_CHAIR: { tier: 'LEAD_TEAM', scope: 'ACADEMIC_UNIT' },
  BOE_CHAIR: { tier: 'LEAD_TEAM', scope: 'ACADEMIC_UNIT' },
  ACADEMIC_ADMIN: { tier: 'LEAD_TEAM', scope: 'INSTITUTION' },
  DEPT_ADMIN: { tier: 'LEAD_TEAM', scope: 'ACADEMIC_UNIT' },
  FINANCE_CLERK: { tier: 'OPERATIONAL', scope: 'INSTITUTION' },
  DEPT_COORDINATOR: { tier: 'OPERATIONAL', scope: 'ACADEMIC_UNIT' },
  EXAM_STAFF: { tier: 'OPERATIONAL', scope: 'INSTITUTION' },
  FACULTY: { tier: 'OPERATIONAL', scope: 'SELF' },
  EVALUATOR: { tier: 'OPERATIONAL', scope: 'SELF' },
  STUDENT: { tier: 'OPERATIONAL', scope: 'SELF' },
}

export const TIER_LABELS: Record<AdminPreviewTier, string> = {
  ALL: 'Full Command Access',
  MANAGEMENT: 'Management Team',
  LEAD_TEAM: 'Lead Team',
  OPERATIONAL: 'Operational User',
}

export const ALL_EXAM_TABS: ExamTabId[] = [
  'cycles',
  'fees',
  'registrations',
  'timetable',
  'appearing',
  'hall-tickets',
  'allotments',
  'forms-qpds',
  'bundles',
  'results',
  'branding',
]

export interface ResolvedWorkspaceAccess {
  isPlatformAdmin: boolean
  isFullAdmin: boolean
  isCoeOrExecutiveLead: boolean
  actualTiers: WorkspaceTier[]
  effectiveTier: AdminPreviewTier
  isPreviewMode: boolean
  scopeBadge: string
  canAccessRoute: (path: string) => boolean
  allowedExamTabs: ExamTabId[]
  examCapabilities: {
    canManageCycles: boolean
    canManageRegistrations: boolean
    canManageBranding: boolean
    canDecodeBundles: boolean
    canPublishResults: boolean
  }
}

function getTierForRole(role: RoleDescriptor): WorkspaceTier {
  if (role.role_tier === 'MANAGEMENT' || role.role_tier === 'LEAD_TEAM' || role.role_tier === 'OPERATIONAL') {
    return role.role_tier
  }
  return ROLE_FALLBACK_META[role.code.toUpperCase()]?.tier ?? 'OPERATIONAL'
}

export function resolveUserAccess(params: {
  platformRoles: string[]
  activeMembership: UserMembership | undefined
  context: WorkspaceContext
  previewTier: AdminPreviewTier
}): ResolvedWorkspaceAccess {
  const { platformRoles, activeMembership, context, previewTier } = params

  const isPlatformAdmin = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')
  const instRoles = activeMembership?.roles ?? []
  const roleDetails = activeMembership?.roleDetails ?? []

  const isInstAdmin = instRoles.includes('INSTITUTION_ADMIN')
  const isFullAdmin = isPlatformAdmin || isInstAdmin

  const tierSet = new Set<WorkspaceTier>()
  for (const rd of roleDetails) {
    tierSet.add(getTierForRole(rd))
  }
  for (const code of instRoles) {
    const fb = ROLE_FALLBACK_META[code.toUpperCase()]
    if (fb) tierSet.add(fb.tier)
  }

  const actualTiers = Array.from(tierSet)

  let naturalTier: AdminPreviewTier = 'OPERATIONAL'
  if (isFullAdmin) {
    naturalTier = 'ALL'
  } else if (tierSet.has('LEAD_TEAM')) {
    naturalTier = 'LEAD_TEAM'
  } else if (tierSet.has('MANAGEMENT')) {
    naturalTier = 'MANAGEMENT'
  } else {
    naturalTier = 'OPERATIONAL'
  }

  const isPreviewMode = isFullAdmin && context === 'INSTITUTION' && previewTier !== 'ALL'
  const effectiveTier: AdminPreviewTier = isPreviewMode ? previewTier : naturalTier

  const isCoeOrExecutiveLead =
    isFullAdmin ||
    instRoles.some((r) => r === 'EXAM_CONTROLLER' || r === 'PRINCIPAL_DIRECTOR')

  const isFirstYearDean = instRoles.includes('DEAN_FIRST_YEAR')
  const staffUnit = activeMembership?.staffScope?.academic_unit_name

  let scopeBadge = 'Institution-Wide'
  if (context === 'PLATFORM') {
    scopeBadge = 'Cross-Tenant Platform'
  } else if (effectiveTier === 'MANAGEMENT') {
    scopeBadge = 'Executive Read & Oversight'
  } else if (effectiveTier === 'LEAD_TEAM') {
    if (isCoeOrExecutiveLead && !isPreviewMode) {
      scopeBadge = 'Institution Governance'
    } else if (isFirstYearDean) {
      scopeBadge = '1st Year (Sem 1 & 2)'
    } else if (staffUnit) {
      scopeBadge = `Dept: ${staffUnit}`
    } else {
      scopeBadge = 'Lead Team Governance'
    }
  } else if (effectiveTier === 'OPERATIONAL') {
    if (instRoles.includes('FINANCE_CLERK')) scopeBadge = 'Accounts Desk'
    else if (instRoles.includes('EXAM_STAFF')) scopeBadge = 'Exam Section Operations'
    else if (instRoles.includes('DEPT_COORDINATOR')) scopeBadge = staffUnit ? `Coord: ${staffUnit}` : 'Dept Operations'
    else if (instRoles.includes('FACULTY')) scopeBadge = staffUnit ? `Faculty · ${staffUnit}` : 'Faculty Workspace'
    else if (instRoles.includes('EVALUATOR')) scopeBadge = 'Blind Evaluation'
    else if (instRoles.includes('STUDENT')) scopeBadge = 'Student Self-Service'
    else scopeBadge = 'Operational User'
  }

  const canAccessRoute = (path: string): boolean => {
    if (path === '/') return true
    if (context === 'PLATFORM') {
      if (!isPlatformAdmin && platformRoles.length === 0) return false
      return ['/institutions', '/organizations', '/users', '/configuration', '/audit-logs'].includes(path)
    }

    if (effectiveTier === 'ALL') {
      return path !== '/organizations'
    }

    if (effectiveTier === 'MANAGEMENT') {
      return ['/front-office', '/academics', '/exams', '/audit-logs'].includes(path)
    }

    if (effectiveTier === 'LEAD_TEAM') {
      if (['/front-office', '/academics', '/exams', '/users'].includes(path)) return true
      if (isCoeOrExecutiveLead && ['/institutions', '/configuration', '/data-management', '/audit-logs'].includes(path)) {
        return true
      }
      return false
    }

    if (isPreviewMode) {
      return ['/front-office', '/academics', '/exams'].includes(path)
    }
    if (instRoles.includes('STUDENT')) {
      return ['/exams'].includes(path)
    }
    if (instRoles.includes('FINANCE_CLERK')) {
      return ['/front-office', '/exams'].includes(path)
    }
    if (instRoles.includes('EVALUATOR')) {
      return ['/exams'].includes(path)
    }
    return ['/front-office', '/academics', '/exams'].includes(path)
  }

  let allowedExamTabs: ExamTabId[] = ALL_EXAM_TABS
  let canManageCycles = false
  let canManageRegistrations = false
  let canManageBranding = false
  let canDecodeBundles = false
  let canPublishResults = false

  if (effectiveTier === 'ALL') {
    allowedExamTabs = ALL_EXAM_TABS
    canManageCycles = true
    canManageRegistrations = true
    canManageBranding = true
    canDecodeBundles = true
    canPublishResults = true
  } else if (effectiveTier === 'MANAGEMENT') {
    allowedExamTabs = ['cycles', 'appearing', 'results']
  } else if (effectiveTier === 'LEAD_TEAM') {
    if (isCoeOrExecutiveLead) {
      allowedExamTabs = ALL_EXAM_TABS
      canManageCycles = true
      canManageRegistrations = true
      canManageBranding = true
      canDecodeBundles = true
      canPublishResults = true
    } else {
      allowedExamTabs = ['cycles', 'registrations', 'timetable', 'appearing', 'forms-qpds', 'results']
      canManageRegistrations = true
    }
  } else {
    if (isPreviewMode) {
      allowedExamTabs = ['registrations', 'timetable', 'appearing', 'hall-tickets', 'forms-qpds', 'results']
      canManageRegistrations = true
    } else if (instRoles.includes('FINANCE_CLERK')) {
      allowedExamTabs = ['fees', 'registrations']
      canManageRegistrations = true
    } else if (instRoles.includes('EXAM_STAFF')) {
      allowedExamTabs = ['registrations', 'timetable', 'appearing', 'hall-tickets', 'allotments', 'forms-qpds']
      canManageRegistrations = true
    } else if (instRoles.includes('DEPT_COORDINATOR')) {
      allowedExamTabs = ['registrations', 'timetable', 'appearing', 'hall-tickets', 'forms-qpds']
      canManageRegistrations = true
    } else if (instRoles.includes('FACULTY')) {
      allowedExamTabs = ['timetable', 'appearing', 'forms-qpds', 'results']
      canManageRegistrations = true
    } else if (instRoles.includes('EVALUATOR')) {
      allowedExamTabs = ['results']
    } else {
      allowedExamTabs = ['timetable', 'hall-tickets', 'results']
    }
  }

  return {
    isPlatformAdmin,
    isFullAdmin,
    isCoeOrExecutiveLead,
    actualTiers,
    effectiveTier,
    isPreviewMode,
    scopeBadge,
    canAccessRoute,
    allowedExamTabs,
    examCapabilities: {
      canManageCycles,
      canManageRegistrations,
      canManageBranding,
      canDecodeBundles,
      canPublishResults,
    },
  }
}
