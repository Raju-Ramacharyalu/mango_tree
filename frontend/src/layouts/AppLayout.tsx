import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  Network,
  Users,
  GraduationCap,
  Sliders,
  Database,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Globe,
} from 'lucide-react'
import { useAppStore } from '@/app/useAppStore'
import { cn } from '@/utils/cn'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, platformOnly: false },
  { to: '/institutions', label: 'Institutions', icon: Building2, platformOnly: false },
  { to: '/organizations', label: 'Organizations', icon: Network, platformOnly: true },
  { to: '/users', label: 'Users and Access', icon: Users, platformOnly: false },
  { to: '/academics', label: 'Academics', icon: GraduationCap, platformOnly: false },
  { to: '/configuration', label: 'Configuration', icon: Sliders, platformOnly: false },
  { to: '/data-management', label: 'Data Management', icon: Database, platformOnly: false },
  { to: '/audit-logs', label: 'Audit Logs', icon: ShieldCheck, platformOnly: false },
]

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const {
    profile,
    platformRoles,
    memberships,
    context,
    activeInstitutionId,
    setContext,
    setActiveInstitution,
    signOut,
  } = useAppStore()

  const hasPlatformAccess = platformRoles.length > 0
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const visibleNav = navItems.filter((item) => !item.platformOnly || (hasPlatformAccess && context === 'PLATFORM'))

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
            <p className="text-sm font-semibold tracking-wide text-white">Command Center</p>
            <p className="text-xs text-slate-400">Multi-Institution ERP</p>
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
        <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="lg:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium text-xs">
                {context === 'PLATFORM' ? 'Platform Administration' : 'Institution Administration'}
              </span>
              {context === 'INSTITUTION' && activeMembership && (
                <span className="text-slate-700 font-semibold truncate">
                  {activeMembership.institution.name}
                </span>
              )}
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            {context === 'PLATFORM' ? platformRoles.join(', ') : activeMembership?.roles.join(', ')}
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
