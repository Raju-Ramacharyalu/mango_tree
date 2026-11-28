import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp,
  Building2,
  BarChart3,
  UserSearch,
  GraduationCap,
  Scale,
  Calendar,
  Archive,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess } from '@/app/rbac'
import type { ExamCycle } from '@/types/exams'
import { InstitutionalOverviewTab } from './InstitutionalOverviewTab'
import { CycleAnalyticsTab } from './CycleAnalyticsTab'
import { Student360Tab } from './Student360Tab'
import { FacultyPerformanceTab } from './FacultyPerformanceTab'
import { RevaluationEngineTab } from './RevaluationEngineTab'
import { cn } from '@/utils/cn'

type AnalyticsTab = 'overview' | 'cycle' | 'student360' | 'faculty' | 'reval'

function isArchivedCycle(cycle: ExamCycle): boolean {
  return cycle.status === 'ARCHIVED' || cycle.status === 'COMPLETED'
}

export function AnalyticsPage() {
  const {
    context,
    activeInstitutionId,
    activeExamCycleId,
    setActiveExamCycle,
    platformRoles,
    memberships,
    previewTier,
  } = useAppStore()
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  const canProcessReval =
    access.effectiveTier === 'ALL' || (access.effectiveTier === 'LEAD_TEAM' && access.isCoeOrExecutiveLead)

  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview')

  const { data: cycles = [] } = useQuery<ExamCycle[]>({
    queryKey: ['exam_cycles', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
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

  const activeCycle = cycles.find((c) => c.id === activeExamCycleId) ?? cycles[0] ?? null
  const activeCycles = useMemo(() => cycles.filter((c) => !isArchivedCycle(c)), [cycles])
  const archivedCycles = useMemo(() => cycles.filter((c) => isArchivedCycle(c)), [cycles])
  const isCycleArchived = Boolean(activeCycle && isArchivedCycle(activeCycle))

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <TrendingUp className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to open Global Analytics, Student 360°, and Revaluation.
        </p>
      </div>
    )
  }

  const tabs: Array<{ id: AnalyticsTab; label: string; icon: typeof Building2 }> = [
    { id: 'overview', label: 'Institutional Overview', icon: Building2 },
    { id: 'cycle', label: 'Exam Cycle Analytics', icon: BarChart3 },
    { id: 'student360', label: 'Student 360°', icon: UserSearch },
    { id: 'faculty', label: 'Faculty Performance', icon: GraduationCap },
    { id: 'reval', label: 'Revaluation Engine', icon: Scale },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Global Analytics, Student 360° &amp; Revaluation</h1>
          <p className="text-sm text-slate-500">
            Institutional intelligence hub, faculty pass-rate analyzer, and Favorable-Rule revaluation auditing (
            <strong>{activeCycle ? `${activeCycle.code} — ${activeCycle.name}` : 'No cycle selected'}</strong>).
          </p>
        </div>

        {cycles.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs font-medium text-slate-600 inline-flex items-center gap-1 whitespace-nowrap">
              {isCycleArchived ? (
                <Archive className="h-3.5 w-3.5 text-amber-600" />
              ) : (
                <Calendar className="h-3.5 w-3.5 text-indigo-600" />
              )}
              Working Cycle:
            </label>
            <select
              value={activeCycle?.id ?? ''}
              onChange={(e) => setActiveExamCycle(e.target.value || null)}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-xs font-medium bg-white max-w-xs sm:max-w-sm focus:outline-none focus:ring-2',
                isCycleArchived
                  ? 'border-amber-300 text-amber-900 focus:ring-amber-400'
                  : 'border-slate-300 text-slate-800 focus:ring-indigo-500'
              )}
            >
              {activeCycles.length > 0 && (
                <optgroup label={`Active Cycles (${activeCycles.length})`}>
                  {activeCycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.is_default_active ? '★ ' : ''}
                      {c.code} — {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {archivedCycles.length > 0 && (
                <optgroup label={`Archived / Historical (${archivedCycles.length})`}>
                  {archivedCycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      [Archived] {c.code} — {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
      </div>

      <div className="border-b border-slate-200 flex gap-6 text-sm overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'pb-2.5 font-medium border-b-2 transition whitespace-nowrap inline-flex items-center gap-1.5',
              activeTab === id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <InstitutionalOverviewTab institutionId={activeInstitutionId} />}
      {activeTab === 'cycle' && <CycleAnalyticsTab institutionId={activeInstitutionId} cycle={activeCycle} />}
      {activeTab === 'student360' && <Student360Tab institutionId={activeInstitutionId} />}
      {activeTab === 'faculty' && <FacultyPerformanceTab institutionId={activeInstitutionId} cycle={activeCycle} />}
      {activeTab === 'reval' && (
        <div className="space-y-3">
          {isCycleArchived && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-900">
              <strong>Read-Only Audit Mode:</strong> Revaluation updates are disabled while viewing archived cycle{' '}
              <strong>{activeCycle?.code}</strong>. Reopen the cycle in <strong>Examinations → Exam Cycles</strong> to
              process new revaluation marks.
            </div>
          )}
          <RevaluationEngineTab
            institutionId={activeInstitutionId}
            cycle={activeCycle}
            canProcess={canProcessReval && !isCycleArchived}
          />
        </div>
      )}
    </div>
  )
}
