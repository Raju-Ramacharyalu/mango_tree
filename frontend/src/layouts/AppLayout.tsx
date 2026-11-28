import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
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
  BookOpen,
  Eye,
  Store,
  Landmark,
  KeyRound,
  Briefcase,
  Smartphone,
  UserCheck,
  TrendingUp,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess, TIER_LABELS } from '@/app/rbac'
import type { AdminPreviewTier } from '@/types/auth'
import { cn } from '@/utils/cn'

interface NavItemDef {
  to: string
  label: string
  icon: typeof LayoutDashboard
}

interface NavGroupDef {
  id: string
  title: string
  items: NavItemDef[]
}

const NAV_GROUPS: NavGroupDef[] = [
  {
    id: 'overview',
    title: 'Overview & Intelligence',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/analytics', label: 'Global Analytics', icon: TrendingUp },
    ],
  },
  {
    id: 'coe',
    title: 'COE · Examination Office',
    items: [
      { to: '/exams', label: 'Examinations', icon: ClipboardList },
      { to: '/operations', label: 'Duties & MIS', icon: Briefcase },
    ],
  },
  {
    id: 'academic',
    title: 'Department · BOS & BOE',
    items: [
      { to: '/academics', label: 'Academics', icon: GraduationCap },
      { to: '/governance', label: 'BOS & CIE', icon: Landmark },
      { to: '/qp-vault', label: 'BOE & QP Vault', icon: KeyRound },
    ],
  },
  {
    id: 'front-office',
    title: 'Front Office & Student Desk',
    items: [{ to: '/front-office', label: 'Front Office', icon: Store }],
  },
  {
    id: 'portals',
    title: 'Self-Service Portals',
    items: [
      { to: '/faculty-portal', label: 'Faculty Portal', icon: UserCheck },
      { to: '/student-portal', label: 'Student Portal', icon: Smartphone },
    ],
  },
  {
    id: 'system',
    title: 'Administration & System',
    items: [
      { to: '/institutions', label: 'Institutions', icon: Building2 },
      { to: '/organizations', label: 'Organizations', icon: Network },
      { to: '/users', label: 'Users and Access', icon: Users },
      { to: '/configuration', label: 'Configuration', icon: Sliders },
      { to: '/data-management', label: 'Data Management', icon: Database },
      { to: '/audit-logs', label: 'Audit Logs', icon: ShieldCheck },
    ],
  },
]

const DEFAULT_ACADEMIC_YEARS = ['2027-28', '2026-27', '2025-26', '2024-25']

const TIER_BADGE_STYLES: Record<AdminPreviewTier, string> = {
  ALL: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  MANAGEMENT: 'bg-amber-50 text-amber-800 border-amber-200',
  LEAD_TEAM: 'bg-blue-50 text-blue-800 border-blue-200',
  OPERATIONAL: 'bg-emerald-50 text-emerald-800 border-emerald-200',
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const {
    profile,
    platformRoles,
    memberships,
    context,
    activeInstitutionId,
    activeAcademicYear,
    activeTerm,
    previewTier,
    setContext,
    setActiveInstitution,
    setActiveAcademicTerm,
    setPreviewTier,
    signOut,
  } = useAppStore()

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

  useEffect(() => {
    if (!activeInstitutionId || !instAcademicDefaults?.ay) return
    const stored = window.localStorage.getItem(`mt_active_term_${activeInstitutionId}`)
    if (!stored) {
      setActiveAcademicTerm(instAcademicDefaults.ay, instAcademicDefaults.term ?? activeTerm)
    }
  }, [activeInstitutionId, instAcademicDefaults, activeTerm, setActiveAcademicTerm])

  const academicYearOptions = useMemo(() => {
    const set = new Set<string>([...DEFAULT_ACADEMIC_YEARS, activeAcademicYear])
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [activeAcademicYear])

  const hasPlatformAccess = platformRoles.length > 0
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const isStudentOnly =
    !hasPlatformAccess &&
    (activeMembership?.roles ?? []).length > 0 &&
    (activeMembership?.roles ?? []).every((r) => r === 'STUDENT')

  const access = resolveUserAccess({
    platformRoles,
    activeMembership,
    context,
    previewTier,
  })

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((item) => access.canAccessRoute(item.to)),
      })).filter((g) => g.items.length > 0),
    [access]
  )

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
              onChange={(e) => setActiveInstitution(e.target.value)}
              className="w-full rounded-md bg-slate-800 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {memberships.map((m) => (
                <option key={m.institution_id} value={m.institution_id}>
                  {m.institution.code} — {m.institution.name}
                </option>
              ))}
            </select>
          )}

          {context === 'INSTITUTION' && !isStudentOnly && (
            <div className="pt-1 space-y-1.5 rounded-md bg-indigo-950/60 border border-indigo-800/70 p-2">
              <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-indigo-200 font-semibold px-0.5">
                <BookOpen className="h-3 w-3 text-indigo-400" />
                Academic Term
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

        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {visibleGroups.map((group) => (
            <div key={group.id} className="space-y-1">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group.title}
              </p>
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition',
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
            </div>
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
              {context === 'INSTITUTION' && !isStudentOnly && (
                <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-medium shrink-0">
                  <BookOpen className="h-3 w-3 shrink-0" />
                  AY {activeAcademicYear} · {activeTerm}
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
