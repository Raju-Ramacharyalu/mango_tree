import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  Users,
  Receipt,
  Ticket,
  Award,
  Camera,
  ClipboardCheck,
  ShieldCheck,
  ArrowRight,
  Store,
  BookOpen,
  Building2,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess, TIER_LABELS } from '@/app/rbac'

interface InstitutionRow {
  id: string
  status: string
  institution_categories: { name: string } | { name: string }[] | null
}

interface MigrationJobRow {
  id: string
  entity_type: string
  status: string
  file_name: string | null
  imported_rows: number
  error_rows: number
  created_at: string
}

interface AuditLogRow {
  id: string
  table_name: string
  action: string
  created_at: string
}

export function DashboardPage() {
  const {
    profile,
    platformRoles,
    memberships,
    context,
    activeInstitutionId,
    activeExamCycleId,
    previewTier,
  } = useAppStore()

  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  const { data: platformData, isLoading: loadingPlatform } = useQuery({
    queryKey: ['dashboard-platform', context],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const [instRes, usersRes, jobsRes, auditRes] = await Promise.all([
        supabase.from('institutions').select('id, status, institution_categories(name)').is('deleted_at', null),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
        supabase
          .from('migration_jobs')
          .select('id, entity_type, status, file_name, imported_rows, error_rows, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('audit_logs')
          .select('id, table_name, action, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
      ])

      const institutions = (instRes.data ?? []) as unknown as InstitutionRow[]
      const categoryCounts: Record<string, number> = {}
      for (const inst of institutions) {
        const cat = Array.isArray(inst.institution_categories)
          ? inst.institution_categories[0]?.name
          : inst.institution_categories?.name
        const label = cat ?? 'Uncategorized'
        categoryCounts[label] = (categoryCounts[label] ?? 0) + 1
      }

      return {
        totalInstitutions: institutions.length,
        activeInstitutions: institutions.filter((i) => i.status === 'ACTIVE').length,
        inactiveInstitutions: institutions.filter((i) => i.status !== 'ACTIVE').length,
        totalUsers: usersRes.count ?? 0,
        categoryDistribution: Object.entries(categoryCounts).map(([name, count]) => ({ name, count })),
        recentJobs: (jobsRes.data ?? []) as MigrationJobRow[],
        recentAudit: (auditRes.data ?? []) as AuditLogRow[],
      }
    },
  })

  const { data: instData, isLoading: loadingInst } = useQuery({
    queryKey: ['dashboard-institution', activeInstitutionId, activeExamCycleId],
    enabled: context === 'INSTITUTION' && Boolean(activeInstitutionId),
    queryFn: async () => {
      const [
        totalStudentsRes,
        photosLinkedRes,
        staffCountRes,
        programsRes,
        cyclesRes,
        regsRes,
        ticketsRes,
        semResultsRes,
        auditRes,
      ] = await Promise.all([
        supabase
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', activeInstitutionId!)
          .is('deleted_at', null),
        supabase
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', activeInstitutionId!)
          .is('deleted_at', null)
          .not('photo_url', 'is', null),
        supabase
          .from('staff_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('institution_id', activeInstitutionId!)
          .is('deleted_at', null)
          .eq('is_active', true),
        supabase
          .from('programs')
          .select('id, code, name')
          .eq('institution_id', activeInstitutionId!)
          .is('deleted_at', null)
          .order('code'),
        supabase
          .from('exam_cycles')
          .select('id, code, name, cycle_type, status, is_default_active')
          .eq('institution_id', activeInstitutionId!)
          .is('deleted_at', null)
          .order('is_default_active', { ascending: false })
          .order('created_at', { ascending: false }),
        activeExamCycleId
          ? supabase
              .from('exam_registrations')
              .select('status, payment_status, total_fee, program_id')
              .eq('institution_id', activeInstitutionId!)
              .eq('exam_cycle_id', activeExamCycleId)
          : Promise.resolve({ data: [], error: null }),
        activeExamCycleId
          ? supabase
              .from('hall_tickets')
              .select('status')
              .eq('institution_id', activeInstitutionId!)
              .eq('exam_cycle_id', activeExamCycleId)
          : Promise.resolve({ data: [], error: null }),
        activeExamCycleId
          ? supabase
              .from('exam_semester_results')
              .select('overall_status, sgpa, is_published')
              .eq('institution_id', activeInstitutionId!)
              .eq('exam_cycle_id', activeExamCycleId)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('audit_logs')
          .select('id, table_name, action, created_at')
          .eq('institution_id', activeInstitutionId!)
          .order('created_at', { ascending: false })
          .limit(6),
      ])

      const totalStudents = totalStudentsRes.count ?? 0
      const photosLinked = photosLinkedRes.count ?? 0
      const regs = regsRes.data ?? []
      const tickets = ticketsRes.data ?? []
      const semResults = semResultsRes.data ?? []
      const programs = programsRes.data ?? []

      const programLookup = new Map(programs.map((p) => [p.id as string, p.code as string]))
      const regsByProgram: Record<string, number> = {}
      for (const r of regs) {
        const code = programLookup.get(r.program_id as string) ?? 'Other'
        regsByProgram[code] = (regsByProgram[code] ?? 0) + 1
      }

      const feeCollected = regs
        .filter((r) => r.payment_status === 'PAID')
        .reduce((sum, r) => sum + Number(r.total_fee ?? 0), 0)

      const passedSem = semResults.filter((r) => r.overall_status === 'PASS').length
      const avgSgpa =
        semResults.length > 0
          ? semResults.reduce((s, r) => s + Number(r.sgpa ?? 0), 0) / semResults.length
          : 0

      return {
        totalStudents,
        photosLinked,
        photoPct: totalStudents > 0 ? Math.round((photosLinked / totalStudents) * 100) : 0,
        staffCount: staffCountRes.count ?? 0,
        programCount: programs.length,
        cycles: cyclesRes.data ?? [],
        totalRegs: regs.length,
        pendingRegs: regs.filter((r) => r.status !== 'APPROVED').length,
        approvedRegs: regs.filter((r) => r.status === 'APPROVED').length,
        paidRegs: regs.filter((r) => r.payment_status === 'PAID').length,
        feeCollected,
        ticketsIssued: tickets.filter((t) => t.status === 'ISSUED').length,
        ticketsWithheld: tickets.filter((t) => t.status === 'WITHHELD').length,
        semResultsCount: semResults.length,
        passRatePct: semResults.length > 0 ? Math.round((passedSem / semResults.length) * 100) : 0,
        avgSgpa: Number(avgSgpa.toFixed(2)),
        publishedResultsCount: semResults.filter((r) => r.is_published).length,
        regsChart: Object.entries(regsByProgram).map(([branch, count]) => ({ branch, count })),
        recentAudit: (auditRes.data ?? []) as AuditLogRow[],
      }
    },
  })

  if (context === 'PLATFORM') {
    if (loadingPlatform) {
      return <div className="text-sm text-slate-500">Loading platform telemetry...</div>
    }
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Command Center</h1>
          <p className="text-sm text-slate-500">Centralized overview across all registered institutions.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Institutions', value: platformData?.totalInstitutions ?? 0 },
            { label: 'Active Institutions', value: platformData?.activeInstitutions ?? 0 },
            { label: 'Inactive / Suspended', value: platformData?.inactiveInstitutions ?? 0 },
            { label: 'Visible Users', value: platformData?.totalUsers ?? 0 },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{kpi.label}</p>
              <p className="text-3xl font-bold text-slate-900 mt-1">{kpi.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Institution Category Distribution</h2>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platformData?.categoryDistribution ?? []}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Recent Administrative Activity</h2>
            {platformData?.recentAudit.length === 0 ? (
              <p className="text-xs text-slate-500">No administrative audit entries recorded yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-xs">
                {platformData?.recentAudit.map((log) => (
                  <li key={log.id} className="py-2 flex items-center justify-between">
                    <span className="font-medium text-slate-800">
                      {log.action} · <span className="font-mono text-slate-600">{log.table_name}</span>
                    </span>
                    <span className="text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}

            <h2 className="text-sm font-semibold text-slate-900 pt-2 border-t border-slate-100">
              Recent Imports &amp; Migration Jobs
            </h2>
            {platformData?.recentJobs.length === 0 ? (
              <p className="text-xs text-slate-500">No migration jobs executed yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-xs">
                {platformData?.recentJobs.map((job) => (
                  <li key={job.id} className="py-2 flex items-center justify-between">
                    <span className="font-medium text-slate-800">
                      {job.entity_type} ({job.imported_rows} imported / {job.error_rows} errors)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">{job.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (loadingInst) {
    return <div className="text-sm text-slate-500">Loading institution workspace...</div>
  }

  const instName = activeMembership?.institution.name ?? 'Institution'
  const activeCycle = instData?.cycles.find((c) => c.id === activeExamCycleId) ?? instData?.cycles[0] ?? null

  if (access.effectiveTier === 'MANAGEMENT') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-block rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-[11px] font-semibold">
              Tier 1 · Management Team (Executive Oversight)
            </span>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">{instName} — Executive Snapshot</h1>
            <p className="text-sm text-slate-500">
              Read-only institutional KPIs across enrollments, fee collections, photo readiness, and examination outcomes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/front-office"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cash Book &amp; Photos
            </Link>
            <Link
              to="/exams"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              View Exam Reports <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Active Students</span>
              <Users className="h-4 w-4 text-indigo-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900 mt-2">
              {(instData?.totalStudents ?? 0).toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {instData?.programCount ?? 0} programs · {instData?.staffCount ?? 0} active staff
            </p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Cycle Fee Collections</span>
              <Receipt className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900 mt-2">
              ₹{(instData?.feeCollected ?? 0).toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {instData?.paidRegs ?? 0} paid / {instData?.totalRegs ?? 0} registrations
            </p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Student Photo Coverage</span>
              <Camera className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900 mt-2">{instData?.photoPct ?? 0}%</p>
            <p className="text-xs text-slate-500 mt-1">
              {instData?.photosLinked ?? 0} / {instData?.totalStudents ?? 0} photos linked
            </p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Pass Rate &amp; Avg SGPA</span>
              <Award className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900 mt-2">
              {instData?.semResultsCount ? `${instData.passRatePct}%` : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {instData?.semResultsCount
                ? `Avg SGPA ${instData.avgSgpa.toFixed(2)} (${instData.publishedResultsCount} published)`
                : 'Awaiting cycle result processing'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              Exam Registrations by Branch {activeCycle ? `(${activeCycle.code})` : ''}
            </h2>
            {instData?.regsChart.length === 0 ? (
              <p className="text-xs text-slate-500 py-12 text-center">
                No registrations recorded for the active exam cycle yet.
              </p>
            ) : (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={instData?.regsChart ?? []}>
                    <XAxis dataKey="branch" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#d97706" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Institutional Audit Trail</h2>
              <Link to="/audit-logs" className="text-xs text-indigo-600 font-medium hover:underline">
                Full Audit Log
              </Link>
            </div>
            {instData?.recentAudit.length === 0 ? (
              <p className="text-xs text-slate-500">No audit entries logged yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-xs">
                {instData?.recentAudit.map((log) => (
                  <li key={log.id} className="py-2 flex items-center justify-between">
                    <span className="font-medium text-slate-800">
                      {log.action} · <span className="font-mono text-slate-600">{log.table_name}</span>
                    </span>
                    <span className="text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (access.effectiveTier === 'OPERATIONAL') {
    return (
      <div className="space-y-6">
        <div>
          <span className="inline-block rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px] font-semibold">
            Tier 3 · Operational Workspace ({access.scopeBadge})
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Welcome, {profile?.full_name ?? 'User'}
          </h1>
          <p className="text-sm text-slate-500">
            {instName} {activeCycle ? `· Working Cycle: ${activeCycle.code} (${activeCycle.cycle_type})` : ''}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {access.canAccessRoute('/front-office') && (
            <Link
              to="/front-office"
              className="bg-white rounded-lg border border-slate-200 p-5 hover:border-indigo-300 transition space-y-2"
            >
              <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Store className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">Front Office &amp; Student Desk</h2>
              <p className="text-xs text-slate-500">
                Desk Cash Book (UTR), Phase 1 / Summer / ODE Registrations, Photo Booth, and A4 3×4 Temp IDs.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 pt-1">
                Open Front Office <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          )}

          <Link
            to="/exams"
            className="bg-white rounded-lg border border-slate-200 p-5 hover:border-indigo-300 transition space-y-2"
          >
            <div className="h-9 w-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-slate-900">Examination Operations</h2>
            <p className="text-xs text-slate-500">
              Access your assigned exam tasks ({access.allowedExamTabs.length} authorized tabs in{' '}
              {activeCycle?.code ?? 'active cycle'}).
            </p>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 pt-1">
              Open Workspace <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          {access.canAccessRoute('/academics') && (
            <Link
              to="/academics"
              className="bg-white rounded-lg border border-slate-200 p-5 hover:border-indigo-300 transition space-y-2"
            >
              <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <BookOpen className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-semibold text-slate-900">Academic Programs &amp; Courses</h2>
              <p className="text-xs text-slate-500">
                Review course schemes, sections, and student enrollments for your department.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 pt-1">
                Browse Academics <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="inline-block rounded-full bg-blue-100 text-blue-800 px-2.5 py-0.5 text-[11px] font-semibold">
            {access.effectiveTier === 'ALL' ? 'Full Command Access' : `Tier 2 · ${TIER_LABELS.LEAD_TEAM}`} ·{' '}
            {access.scopeBadge}
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{instName} — Governance Hub</h1>
          <p className="text-sm text-slate-500">
            {activeCycle
              ? `Active Cycle: ${activeCycle.name} (${activeCycle.code}) · ${activeCycle.status.replace('_', ' ')}`
              : 'No active exam cycle configured yet — open Examinations to create one.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/front-office"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Front Office Desk
          </Link>
          <Link
            to="/exams"
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Examinations Command Center <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Students &amp; Photos</span>
            <Users className="h-4 w-4 text-indigo-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">
            {(instData?.totalStudents ?? 0).toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {instData?.photosLinked ?? 0} photos linked ({instData?.photoPct ?? 0}%)
          </p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Registration Approvals</span>
            <ClipboardCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{instData?.approvedRegs ?? 0}</p>
          <p className="text-xs text-slate-500 mt-1">
            {instData?.pendingRegs ? `${instData.pendingRegs} pending approval` : 'All cycle registrations verified'}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Hall Tickets</span>
            <Ticket className="h-4 w-4 text-purple-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{instData?.ticketsIssued ?? 0}</p>
          <p className="text-xs text-slate-500 mt-1">
            {instData?.ticketsWithheld ? `${instData.ticketsWithheld} withheld by COE` : 'Issued & printable'}
          </p>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Fees Collected</span>
            <Receipt className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">
            ₹{(instData?.feeCollected ?? 0).toLocaleString('en-IN')}
          </p>
          <p className="text-xs text-slate-500 mt-1">{instData?.paidRegs ?? 0} paid candidates</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Lead Team Governance Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              to="/exams"
              className="rounded-md border border-slate-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
            >
              <p className="text-xs font-semibold text-slate-900">Examinations &amp; Branding</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {access.examCapabilities.canDecodeBundles
                  ? 'Full COE access: Hall Tickets, Seating, Decoding & Logos'
                  : 'Timetable, Appearing Lists, Form B/A & CIE Ledger'}
              </p>
            </Link>
            <Link
              to="/front-office"
              className="rounded-md border border-slate-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
            >
              <p className="text-xs font-semibold text-slate-900">Front Office &amp; Overrides</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Cash Book, Summer 15-Credit Override, ODE, Photo Booth &amp; Temp IDs
              </p>
            </Link>
            <Link
              to="/users"
              className="rounded-md border border-slate-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
            >
              <p className="text-xs font-semibold text-slate-900">3-Tier Roles &amp; Staff Directory</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {instData?.staffCount ?? 0} active staff · assign Management, Lead Team &amp; User roles
              </p>
            </Link>
            {access.canAccessRoute('/data-management') ? (
              <Link
                to="/data-management"
                className="rounded-md border border-slate-200 p-3 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
              >
                <p className="text-xs font-semibold text-slate-900">Bulk CSV Imports</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Migrate students, courses, staff &amp; sections cleanly in batches
                </p>
              </Link>
            ) : (
              <div className="rounded-md border border-dashed border-slate-200 p-3 bg-slate-50">
                <p className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> COE Vault Isolated
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Bundle decoding &amp; private COE signatures remain locked to COE / Admin.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-slate-400" />
              Recent Institution Activity
            </h2>
            {access.canAccessRoute('/audit-logs') && (
              <Link to="/audit-logs" className="text-xs text-indigo-600 font-medium hover:underline">
                View All
              </Link>
            )}
          </div>
          {instData?.recentAudit.length === 0 ? (
            <p className="text-xs text-slate-500">No recent audit records for this institution.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {instData?.recentAudit.map((log) => (
                <li key={log.id} className="py-2 flex items-center justify-between">
                  <span className="font-medium text-slate-800">
                    {log.action} · <span className="font-mono text-slate-600">{log.table_name}</span>
                  </span>
                  <span className="text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
