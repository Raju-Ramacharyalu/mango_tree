import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Building2,
  Network,
  Users,
  GraduationCap,
  ClipboardList,
  Sliders,
  Database,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Globe,
  Calendar,
  BookOpen,
  Eye,
  Store,
  Landmark,
  KeyRound,
  Briefcase,
  Smartphone,
  UserCheck,
  TrendingUp,
  Archive,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess, TIER_LABELS } from '@/app/rbac'
import type { AdminPreviewTier } from '@/types/auth'
import type { ExamCycle } from '@/types/exams'
import { cn } from '@/utils/cn'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/institutions', label: 'Institutions', icon: Building2 },
  { to: '/organizations', label: 'Organizations', icon: Network },
  { to: '/users', label: 'Users and Access', icon: Users },
  { to: '/academics', label: 'Academics', icon: GraduationCap },
  { to: '/governance', label: 'BOS & CIE', icon: Landmark },
  { to: '/qp-vault', label: 'BOE & QP Vault', icon: KeyRound },
  { to: '/operations', label: 'Duties & MIS', icon: Briefcase },
  { to: '/analytics', label: 'Analytics & Reval', icon: TrendingUp },
  { to: '/faculty-portal', label: 'Faculty Portal', icon: UserCheck },
  { to: '/student-portal', label: 'Student Portal', icon: Smartphone },
  { to: '/front-office', label: 'Front Office', icon: Store },
  { to: '/exams', label: 'Examinations', icon: ClipboardList },
  { to: '/configuration', label: 'Configuration', icon: Sliders },
  { to: '/data-management', label: 'Data Management', icon: Database },
  { to: '/audit-logs', label: 'Audit Logs', icon: ShieldCheck },
]

const EXAM_ROUTES = ['/exams', '/analytics', '/operations', '/qp-vault']
const ACADEMIC_ROUTES = ['/academics', '/governance', '/faculty-portal', '/front-office']
const DEFAULT_ACADEMIC_YEARS = ['2027-28', '2026-27', '2025-26', '2024-25']

const TIER_BADGE_STYLES: Record<AdminPreviewTier, string> = {
  ALL: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  MANAGEMENT: 'bg-amber-50 text-amber-800 border-amber-200',
  LEAD_TEAM: 'bg-blue-50 text-blue-800 border-blue-200',
  OPERATIONAL: 'bg-emerald-50 text-emerald-800 border-emerald-200',
}

function getCycleYear(cycle: ExamCycle): string {
  const yr = (cycle as ExamCycle & { academic_year?: string | null }).academic_year
  return yr && yr.trim() ? yr.trim() : 'Unspecified'
}

function isArchivedCycle(cycle: ExamCycle): boolean {
  return cycle.status === 'ARCHIVED' || cycle.status === 'COMPLETED'
}

export function AppLayout() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [selectedCycleAy, setSelectedCycleAy] = useState<string>('ALL')
  const {
    profile,
    platformRoles,
    memberships,
    context,
    activeInstitutionId,
    activeAcademicYear,
    activeTerm,
    activeExamCycleId,
    previewTier,
    setContext,
    setActiveInstitution,
    setActiveAcademicTerm,
    setActiveExamCycle,
    setPreviewTier,
    signOut,
  } = useAppStore()

  const pathname = location.pathname
  const isDashboardRoute = pathname === '/'
  const isExamRoute = EXAM_ROUTES.some((r) => pathname.startsWith(r))
  const isAcademicRoute = ACADEMIC_ROUTES.some((r) => pathname.startsWith(r))
  const showAcademicContext = isAcademicRoute || isDashboardRoute || (!isExamRoute)
  const showExamContext = isExamRoute || isDashboardRoute

  const { data: instAcademicDefaults } = useQuery({
    queryKey: ['institution_academic_defaults', activeInstitutionId],
    enabled: context === 'INSTITUTION' && Boolean(activeInstitutionId),
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_settings')
        .select('setting_key, setting_value')
        .eq('institution_id', activeInstitutionId!)
        .in('setting_key', ['active_academic_year', 'active_term'])
      if (error) throw error
      const map = new Map((data ?? []).map((r) => [r.setting_key as string, r.setting_value]))
      const ay = typeof map.get('active_academic_year') === 'string' ? (map.get('active_academic_year') as string) : null
      const termRaw = typeof map.get('active_term') === 'string' ? String(map.get('active_term')).toUpperCase() : null
      const term: 'ODD' | 'EVEN' | null = termRaw === 'EVEN' ? 'EVEN' : termRaw === 'ODD' ? 'ODD' : null
      return { ay, term }
    },
  })

  // Hydrate institution default AY/Term only if user has not saved a custom selection yet
  useEffect(() => {
    if (!activeInstitutionId || !instAcademicDefaults?.ay) return
    const stored = window.localStorage.getItem(`mt_active_term_${activeInstitutionId}`)
    if (!stored) {
      setActiveAcademicTerm(instAcademicDefaults.ay, instAcademicDefaults.term ?? activeTerm)
    }
  }, [activeInstitutionId, instAcademicDefaults, activeTerm, setActiveAcademicTerm])

  const { data: examCycles = [] } = useQuery<ExamCycle[]>({
    queryKey: ['exam_cycles', activeInstitutionId],
    enabled: context === 'INSTITUTION' && Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_cycles')
        .select('*')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .order('is_default_active', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ExamCycle[]
    },
  })

  useEffect(() => {
    if (context !== 'INSTITUTION' || !activeInstitutionId) return
    if (examCycles.length === 0) {
      if (activeExamCycleId !== null) setActiveExamCycle(null)
      return
    }
    const stillValid = examCycles.some((c) => c.id === activeExamCycleId)
    if (!stillValid) {
      const preferred =
        examCycles.find((c) => c.is_default_active) ??
        examCycles.find((c) => !isArchivedCycle(c)) ??
        examCycles[0]
      setActiveExamCycle(preferred.id)
    }
  }, [context, activeInstitutionId, examCycles, activeExamCycleId, setActiveExamCycle])

  const cycleAcademicYears = useMemo(() => {
    const yrs = Array.from(new Set(examCycles.map(getCycleYear)))
    return yrs.sort((a, b) => b.localeCompare(a))
  }, [examCycles])

  const academicYearOptions = useMemo(() => {
    const set = new Set<string>([...DEFAULT_ACADEMIC_YEARS, activeAcademicYear, ...cycleAcademicYears.filter((y) => y !== 'Unspecified')])
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [activeAcademicYear, cycleAcademicYears])

  const activeCycle = examCycles.find((c) => c.id === activeExamCycleId) ?? null
  const defaultLiveCycle = useMemo(
    () =>
      examCycles.find((c) => c.is_default_active && !isArchivedCycle(c)) ??
      examCycles.find((c) => !isArchivedCycle(c)) ??
      null,
    [examCycles]
  )

  useEffect(() => {
    if (!activeCycle || selectedCycleAy === 'ALL') return
    const cycleYear = getCycleYear(activeCycle)
    if (cycleYear !== selectedCycleAy) {
      setSelectedCycleAy(cycleYear)
    }
  }, [activeCycle, selectedCycleAy])

  const filteredCycles = useMemo(() => {
    if (selectedCycleAy === 'ALL') return examCycles
    return examCycles.filter((c) => getCycleYear(c) === selectedCycleAy)
  }, [examCycles, selectedCycleAy])

  const activeCycleGroup = useMemo(
    () => filteredCycles.filter((c) => !isArchivedCycle(c)),
    [filteredCycles]
  )
  const archivedCycleGroup = useMemo(
    () => filteredCycles.filter((c) => isArchivedCycle(c)),
    [filteredCycles]
  )

  const handleCycleAyChange = (nextYear: string) => {
    setSelectedCycleAy(nextYear)
    if (nextYear === 'ALL') return
    if (activeCycle && getCycleYear(activeCycle) === nextYear) return
    const inYear = examCycles.filter((c) => getCycleYear(c) === nextYear)
    const nextCycle =
      inYear.find((c) => c.is_default_active) ??
      inYear.find((c) => !isArchivedCycle(c)) ??
      inYear[0]
    if (nextCycle) setActiveExamCycle(nextCycle.id)
  }

  const hasPlatformAccess = platformRoles.length > 0
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const activeCycleIsArchived = Boolean(activeCycle && isArchivedCycle(activeCycle))

  const access = resolveUserAccess({
    platformRoles,
    activeMembership,
    context,
    previewTier,
  })

  const visibleNav = navItems.filter((item) => access.canAccessRoute(item.to))

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-100 flex flex-col transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800">
          <div>
            <p className="text-sm font-semibold tracking-wide text-white">Mango Tree ERP</p>
            <p className="text-xs text-slate-400">Multi-Tenant 3-Tier Suite</p>
          </div>
          <button
            type="button"
            className="lg:hidden p-1 text-slate-400 hover:text-white"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="grid grid-cols-2 gap-1 bg-slate-800 p-1 rounded-md text-xs">
            <button
              type="button"
              disabled={!hasPlatformAccess}
              onClick={() => setContext('PLATFORM')}
              className={cn(
                'py-1.5 px-2 rounded font-medium flex items-center justify-center gap-1 transition',
                context === 'PLATFORM'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:text-white disabled:opacity-40'
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              Platform
            </button>
            <button
              type="button"
              disabled={memberships.length === 0}
              onClick={() => setContext('INSTITUTION')}
              className={cn(
                'py-1.5 px-2 rounded font-medium flex items-center justify-center gap-1 transition',
                context === 'INSTITUTION'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:text-white disabled:opacity-40'
              )}
            >
              <Building2 className="h-3.5 w-3.5" />
              Institution
            </button>
          </div>

          {context === 'INSTITUTION' && memberships.length > 0 && (
            <select
              value={activeInstitutionId ?? ''}
              onChange={(e) => {
                setSelectedCycleAy('ALL')
                setActiveInstitution(e.target.value)
              }}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {memberships.map((m) => (
                <option key={m.institution_id} value={m.institution_id}>
                  {m.institution.code} — {m.institution.name}
                </option>
              ))}
            </select>
          )}

          {/* ACADEMIC TERM CONTEXT: AY + ODD/EVEN (Academics, BOS, Allocations, CIE, Front Office, Dashboard) */}
          {context === 'INSTITUTION' && showAcademicContext && (
            <div className="pt-1 space-y-1.5 rounded-md bg-indigo-950/60 border border-indigo-800/70 p-2">
              <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-indigo-200 font-semibold px-0.5">
                <BookOpen className="h-3 w-3 text-indigo-400" />
                Academic Term Context
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                <select
                  aria-label="Academic Year"
                  value={activeAcademicYear}
                  onChange={(e) => setActiveAcademicTerm(e.target.value, activeTerm)}
                  className="col-span-3 rounded-md bg-slate-900 border border-indigo-700/70 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  {academicYearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      AY {yr}
                    </option>
                  ))}
                </select>
                <div className="col-span-2 grid grid-cols-2 rounded-md bg-slate-900 border border-indigo-700/70 p-0.5 text-[10px] font-semibold">
                  {(['ODD', 'EVEN'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setActiveAcademicTerm(activeAcademicYear, t)}
                      className={cn(
                        'rounded py-0.5 transition',
                        activeTerm === t ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-indigo-300/80 px-0.5">
                Governs BOS, Allocations, CIE &amp; Course Reg
              </p>
            </div>
          )}

          {/* EXAMINATION CYCLE CONTEXT: Strictly for Examination routes + Dashboard */}
          {context === 'INSTITUTION' && showExamContext && examCycles.length > 0 && (
            <div className="pt-1 space-y-1.5 rounded-md bg-slate-800/60 border border-slate-700/80 p-2">
              <div className="flex items-center justify-between px-0.5">
                <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-300 font-semibold">
                  <Calendar className="h-3 w-3 text-emerald-400" />
                  Exam Cycle Context
                </label>
                {cycleAcademicYears.length > 1 && (
                  <select
                    aria-label="Filter Exam Cycles by Academic Year"
                    value={selectedCycleAy}
                    onChange={(e) => handleCycleAyChange(e.target.value)}
                    className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="ALL">All AY</option>
                    {cycleAcademicYears.map((yr) => (
                      <option key={yr} value={yr}>
                        AY {yr}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <select
                aria-label="Working Exam Cycle"
                value={activeExamCycleId ?? ''}
                onChange={(e) => setActiveExamCycle(e.target.value || null)}
                className={cn(
                  'w-full rounded-md bg-slate-900 border px-2 py-1.5 text-xs focus:outline-none focus:ring-1',
                  activeCycleIsArchived
                    ? 'border-amber-500/60 text-amber-200 focus:ring-amber-400'
                    : 'border-slate-700 text-emerald-100 focus:ring-emerald-500'
                )}
              >
                {activeCycleGroup.length > 0 && (
                  <optgroup label={`Active Cycles (${activeCycleGroup.length})`}>
                    {activeCycleGroup.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.is_default_active ? '★ ' : ''}
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {archivedCycleGroup.length > 0 && (
                  <optgroup label={`Archived / Historical (${archivedCycleGroup.length})`}>
                    {archivedCycleGroup.map((c) => (
                      <option key={c.id} value={c.id}>
                        [Archived] {c.code} — {c.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>

              {activeCycle && (
                <div className="flex items-center justify-between gap-1 text-[10px] px-0.5">
                  <span className="text-slate-400 truncate">
                    AY {getCycleYear(activeCycle)} · {activeCycle.cycle_type}
                  </span>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded font-semibold shrink-0',
                      activeCycleIsArchived
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    )}
                  >
                    {activeCycleIsArchived ? 'READ-ONLY' : activeCycle.status.replace('_', ' ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {context === 'INSTITUTION' && access.isFullAdmin && (
            <div className="pt-1">
              <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-300 mb-1 px-0.5">
                <Eye className="h-3 w-3" />
                Admin Workspace View
              </label>
              <select
                value={previewTier}
                onChange={(e) => setPreviewTier(e.target.value as AdminPreviewTier)}
                className="w-full rounded-md bg-slate-800 border border-amber-500/40 px-2.5 py-1.5 text-xs text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
              >
                <option value="ALL">All Access (Admin)</option>
                <option value="MANAGEMENT">1. Management Team</option>
                <option value="LEAD_TEAM">2. Lead Team (HOD/COE/Dean)</option>
                <option value="OPERATIONAL">3. Operational User</option>
              </select>
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition',
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate">{profile?.full_name ?? 'Admin'}</p>
            <p className="text-[11px] text-slate-400 truncate">{profile?.email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            title="Sign out"
            className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {access.isPreviewMode && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 lg:px-6 py-1.5 flex items-center justify-between text-xs text-amber-900">
            <span>
              <strong>Tier Preview Active:</strong> Viewing navigation, dashboard, and exam tabs as{' '}
              <strong>{TIER_LABELS[access.effectiveTier]}</strong>.
            </span>
            <button
              type="button"
              onClick={() => setPreviewTier('ALL')}
              className="font-semibold underline hover:text-amber-700"
            >
              Return to Full Admin
            </button>
          </div>
        )}

        {/* Archived banner ONLY on Examination routes */}
        {context === 'INSTITUTION' && isExamRoute && activeCycle && activeCycleIsArchived && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 lg:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
            <span className="inline-flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5 text-amber-700 shrink-0" />
              <strong>Archived Exam Cycle (Read-Only):</strong> Viewing{' '}
              <strong>
                {activeCycle.code} — {activeCycle.name}
              </strong>{' '}
              (AY {getCycleYear(activeCycle)}). Reopen in Examinations → Exam Cycles to modify records.
            </span>
            {defaultLiveCycle && (
              <button
                type="button"
                onClick={() => setActiveExamCycle(defaultLiveCycle.id)}
                className="font-semibold underline hover:text-amber-700 shrink-0"
              >
                Switch to {defaultLiveCycle.code}
              </button>
            )}
          </div>
        )}

        <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="lg:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span
                className={cn(
                  'px-2 py-0.5 rounded border font-medium text-xs shrink-0',
                  context === 'PLATFORM'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : TIER_BADGE_STYLES[access.effectiveTier]
                )}
              >
                {context === 'PLATFORM' ? 'Platform Admin' : TIER_LABELS[access.effectiveTier]}
              </span>
              {context === 'INSTITUTION' && activeMembership && (
                <span className="text-slate-700 font-semibold truncate">
                  {activeMembership.institution.name}
                </span>
              )}
              {context === 'INSTITUTION' && showAcademicContext && (
                <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-medium shrink-0">
                  <BookOpen className="h-3 w-3 shrink-0" />
                  AY {activeAcademicYear} · {activeTerm}
                </span>
              )}
              {context === 'INSTITUTION' && showExamContext && activeCycle && (
                <span
                  title={`${activeCycle.code} — ${activeCycle.name}`}
                  className={cn(
                    'hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium max-w-xs truncate',
                    activeCycleIsArchived
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  )}
                >
                  {activeCycleIsArchived ? (
                    <Archive className="h-3 w-3 shrink-0" />
                  ) : (
                    <Calendar className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">
                    {activeCycle.code} · {activeCycle.name}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 shrink-0">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
              {access.scopeBadge}
            </span>
            <span className="hidden xl:inline text-slate-400">
              {context === 'PLATFORM' ? platformRoles.join(', ') : activeMembership?.roles.join(', ')}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
