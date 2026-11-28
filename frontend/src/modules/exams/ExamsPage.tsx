import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calendar, Receipt, Users, CheckCircle2, ClipboardList, Ticket } from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess, type ExamTabId } from '@/app/rbac'
import type { ExamCycle } from '@/types/exams'
import { ExamCyclesTab } from './ExamCyclesTab'
import { FeeRulesTab } from './FeeRulesTab'
import { RegistrationsTab } from './RegistrationsTab'
import { TimetableTab } from './TimetableTab'
import { AppearingListsTab } from './AppearingListsTab'
import { HallTicketsTab } from './HallTicketsTab'
import { RoomAllotmentsTab } from './RoomAllotmentsTab'
import { ExamDayFormsTab } from './ExamDayFormsTab'
import { BundlesDecodingTab } from './BundlesDecodingTab'
import { EvaluationDeskTab } from './EvaluationDeskTab'
import { ResultsProcessingTab } from './ResultsProcessingTab'
import { RevaluationEngineTab } from '@/modules/analytics/RevaluationEngineTab'
import { BrandingAssetsTab } from './BrandingAssetsTab'
import { cn } from '@/utils/cn'

const EXAM_TAB_DEFS: Array<{ id: ExamTabId; label: string }> = [
  { id: 'cycles', label: 'Exam Cycles' },
  { id: 'fees', label: 'Fee Rules' },
  { id: 'registrations', label: 'Registrations' },
  { id: 'timetable', label: 'Timetable' },
  { id: 'appearing', label: 'Appearing Lists' },
  { id: 'hall-tickets', label: 'Hall Tickets' },
  { id: 'allotments', label: 'Room Allotments' },
  { id: 'forms-qpds', label: 'A/B Forms & QPDS' },
  { id: 'bundles', label: 'Bundles & Decoding' },
  { id: 'eval-desk', label: 'Evaluation Desk' },
  { id: 'results', label: 'Marks & Results' },
  { id: 'revaluation', label: 'Revaluation Engine' },
  { id: 'branding', label: 'Branding & Photos' },
]

export function ExamsPage() {
  const [activeTab, setActiveTab] = useState<ExamTabId>('cycles')
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

  const visibleTabs = EXAM_TAB_DEFS.filter((t) => access.allowedExamTabs.includes(t.id))
  const {
    canManageCycles,
    canManageRegistrations,
    canManageBranding,
    canDecodeBundles,
    canPublishResults,
  } = access.examCapabilities

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id)
    }
  }, [visibleTabs, activeTab])

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
  const activeCyclesGroup = useMemo(
    () => cycles.filter((c) => c.status !== 'ARCHIVED' && c.status !== 'COMPLETED'),
    [cycles]
  )
  const archivedCyclesGroup = useMemo(
    () => cycles.filter((c) => c.status === 'ARCHIVED' || c.status === 'COMPLETED'),
    [cycles]
  )

  const { data: stats } = useQuery({
    queryKey: ['exam_cycle_stats', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id),
    queryFn: async () => {
      type RegStatRow = { status: string; payment_status: string; total_fee: number | null }
      type TicketStatRow = { status: string }
      const [rows, tickets] = await Promise.all([
        fetchAllRows<RegStatRow>((from, to) =>
          supabase
            .from('exam_registrations')
            .select('status, payment_status, total_fee')
            .eq('institution_id', activeInstitutionId!)
            .eq('exam_cycle_id', activeCycle!.id)
            .order('id', { ascending: true })
            .range(from, to)
        ),
        fetchAllRows<TicketStatRow>((from, to) =>
          supabase
            .from('hall_tickets')
            .select('status')
            .eq('institution_id', activeInstitutionId!)
            .eq('exam_cycle_id', activeCycle!.id)
            .order('id', { ascending: true })
            .range(from, to)
        ),
      ])
      return {
        total: rows.length,
        approved: rows.filter((r) => r.status === 'APPROVED').length,
        paid: rows.filter((r) => r.payment_status === 'PAID').length,
        feeCollected: rows
          .filter((r) => r.payment_status === 'PAID')
          .reduce((sum, r) => sum + Number(r.total_fee ?? 0), 0),
        ticketsIssued: tickets.filter((t) => t.status === 'ISSUED').length,
        ticketsWithheld: tickets.filter((t) => t.status === 'WITHHELD').length,
      }
    },
  })

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <ClipboardList className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode in the left sidebar to manage Examination Cycles, Registrations,
          Hall Tickets, Room Allotments, Bundle Decoding, and Results.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Examinations &amp; Operations</h1>
          <p className="text-sm text-slate-500">
            Role-scoped autonomous examination workspace ({access.scopeBadge}).
          </p>
        </div>

        {cycles.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Working Cycle:</label>
            <select
              value={activeCycle?.id ?? ''}
              onChange={(e) => setActiveExamCycle(e.target.value || null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
            >
              {activeCyclesGroup.length > 0 && (
                <optgroup label={`Active Cycles (${activeCyclesGroup.length})`}>
                  {activeCyclesGroup.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.is_default_active ? '★ ' : ''}
                      {c.code} — {c.name} ({c.status.replace('_', ' ')})
                    </option>
                  ))}
                </optgroup>
              )}
              {archivedCyclesGroup.length > 0 && (
                <optgroup label={`Archived / Historical (${archivedCyclesGroup.length})`}>
                  {archivedCyclesGroup.map((c) => (
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Exam Cycles</span>
            <Calendar className="h-4 w-4 text-indigo-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{cycles.length}</p>
          <p className="text-[11px] text-slate-500 truncate mt-0.5">
            {activeCycle ? `Active: ${activeCycle.code}` : 'No cycle active'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Registrations</span>
            <Users className="h-4 w-4 text-blue-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{stats?.total ?? 0}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">In selected cycle</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>COE Approved</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{stats?.approved ?? 0}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Verified candidates</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Hall Tickets</span>
            <Ticket className="h-4 w-4 text-purple-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{stats?.ticketsIssued ?? 0}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {stats?.ticketsWithheld ? `${stats.ticketsWithheld} withheld` : 'Issued & printable'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Fees Collected</span>
            <Receipt className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            ₹{(stats?.feeCollected ?? 0).toLocaleString('en-IN')}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">{stats?.paid ?? 0} paid registrations</p>
        </div>
      </div>

      <div className="border-b border-slate-200 flex gap-5 text-sm overflow-x-auto">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'pb-2.5 font-medium border-b-2 transition whitespace-nowrap',
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'cycles' && (
        <ExamCyclesTab institutionId={activeInstitutionId} cycles={cycles} canManage={canManageCycles} />
      )}
      {activeTab === 'fees' && (
        <FeeRulesTab institutionId={activeInstitutionId} cycles={cycles} canManage={canManageCycles} />
      )}
      {activeTab === 'registrations' && (
        <RegistrationsTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          canManage={canManageRegistrations}
          canDelete={canManageCycles}
        />
      )}
      {activeTab === 'timetable' && (
        <TimetableTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          canManage={canManageRegistrations}
          canDelete={canManageCycles}
        />
      )}
      {activeTab === 'appearing' && (
        <AppearingListsTab
          institutionId={activeInstitutionId}
          institutionName={activeMembership?.institution.name ?? 'Institution'}
          cycle={activeCycle}
        />
      )}
      {activeTab === 'hall-tickets' && (
        <HallTicketsTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          canIssue={canManageCycles}
          canPrint={canManageRegistrations}
        />
      )}
      {activeTab === 'allotments' && (
        <RoomAllotmentsTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          canManage={canManageRegistrations}
          canDelete={canManageCycles}
        />
      )}
      {activeTab === 'forms-qpds' && (
        <ExamDayFormsTab
          institutionId={activeInstitutionId}
          institutionName={activeMembership?.institution.name ?? 'Institution'}
          cycle={activeCycle}
          canManage={canManageRegistrations}
        />
      )}
      {activeTab === 'bundles' && (
        <BundlesDecodingTab
          institutionId={activeInstitutionId}
          institutionName={activeMembership?.institution.name ?? 'Institution'}
          cycle={activeCycle}
          canDecode={canDecodeBundles}
        />
      )}
      {activeTab === 'eval-desk' && (
        <EvaluationDeskTab
          institutionId={activeInstitutionId}
          institutionName={activeMembership?.institution.name ?? 'Institution'}
          cycle={activeCycle}
          canConfigurePatterns={canDecodeBundles}
        />
      )}
      {activeTab === 'results' && (
        <ResultsProcessingTab
          institutionId={activeInstitutionId}
          institutionName={activeMembership?.institution.name ?? 'Institution'}
          cycle={activeCycle}
          canEnterCie={canManageRegistrations}
          canPublish={canPublishResults}
        />
      )}
      {activeTab === 'revaluation' && (
        <div className="space-y-3">
          {activeCycle && (activeCycle.status === 'ARCHIVED' || activeCycle.status === 'COMPLETED') && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-900">
              <strong>Archived Cycle (Read-Only):</strong> Revaluation updates are locked for{' '}
              <strong>{activeCycle.code}</strong>. Reopen the cycle in <strong>Exam Cycles</strong> to process new revaluation entries.
            </div>
          )}
          <RevaluationEngineTab
            institutionId={activeInstitutionId}
            cycle={activeCycle}
            canProcess={
              canPublishResults &&
              !(activeCycle && (activeCycle.status === 'ARCHIVED' || activeCycle.status === 'COMPLETED'))
            }
          />
        </div>
      )}
      {activeTab === 'branding' && (
        <BrandingAssetsTab
          institutionId={activeInstitutionId}
          canManageBranding={canManageBranding}
          canManagePhotos={canManageRegistrations}
        />
      )}
    </div>
  )
}
