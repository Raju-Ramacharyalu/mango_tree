import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calendar, Receipt, Users, CheckCircle2, ClipboardList, Ticket } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import { ExamCyclesTab } from './ExamCyclesTab'
import { FeeRulesTab } from './FeeRulesTab'
import { RegistrationsTab } from './RegistrationsTab'
import { TimetableTab } from './TimetableTab'
import { AppearingListsTab } from './AppearingListsTab'
import { HallTicketsTab } from './HallTicketsTab'
import { cn } from '@/utils/cn'

type ExamTab = 'cycles' | 'fees' | 'registrations' | 'timetable' | 'appearing' | 'hall-tickets'

export function ExamsPage() {
  const [activeTab, setActiveTab] = useState<ExamTab>('cycles')
  const { context, activeInstitutionId, activeExamCycleId, setActiveExamCycle, platformRoles, memberships } =
    useAppStore()

  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const instRoles = activeMembership?.roles ?? []

  const isPlatformAdmin = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')
  const isInstAdmin = instRoles.some(
    (r) => r === 'INSTITUTION_ADMIN' || r === 'PRINCIPAL_DIRECTOR' || r === 'EXAM_CONTROLLER'
  )
  const canManageCycles = isPlatformAdmin || isInstAdmin
  const canManageRegistrations =
    canManageCycles || instRoles.some((r) => r === 'ACADEMIC_ADMIN' || r === 'DEPT_ADMIN')

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

  const { data: stats } = useQuery({
    queryKey: ['exam_cycle_stats', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id),
    queryFn: async () => {
      const [regRes, htRes] = await Promise.all([
        supabase
          .from('exam_registrations')
          .select('status, payment_status, total_fee')
          .eq('institution_id', activeInstitutionId!)
          .eq('exam_cycle_id', activeCycle!.id),
        supabase
          .from('hall_tickets')
          .select('status')
          .eq('institution_id', activeInstitutionId!)
          .eq('exam_cycle_id', activeCycle!.id),
      ])
      if (regRes.error) throw regRes.error
      if (htRes.error) throw htRes.error
      const rows = regRes.data ?? []
      const tickets = htRes.data ?? []
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
          Switch to <strong>Institution</strong> mode in the left sidebar to manage Examination Cycles, Fee Rules,
          Registrations, Appearing Lists, and Hall Tickets.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Examinations & Operations</h1>
          <p className="text-sm text-slate-500">
            Exam cycles, fee schedules, registrations, timetable, appearing lists, and A4 hall ticket issuance.
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
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.is_default_active ? '★ ' : ''}
                  {c.code} — {c.cycle_type} ({c.status.replace('_', ' ')})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* KPI Cards */}
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

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-6 text-sm overflow-x-auto">
        {(
          [
            { id: 'cycles', label: 'Exam Cycles' },
            { id: 'fees', label: 'Fee Rules' },
            { id: 'registrations', label: 'Registrations' },
            { id: 'timetable', label: 'Timetable' },
            { id: 'appearing', label: 'Appearing Lists' },
            { id: 'hall-tickets', label: 'Hall Tickets' },
          ] as const
        ).map((tab) => (
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
    </div>
  )
}
