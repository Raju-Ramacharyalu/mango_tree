import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, UserPlus, Calendar, FileCheck2, BarChart3 } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess } from '@/app/rbac'
import type { ExamCycle } from '@/types/exams'
import type { DutyNominationRow } from '@/types/operations'
import { DutyNominationsTab } from './DutyNominationsTab'
import { InvigilationDutiesTab } from './InvigilationDutiesTab'
import { EvaluationDutiesTab } from './EvaluationDutiesTab'
import { MisComplianceTab } from './MisComplianceTab'
import { cn } from '@/utils/cn'

type OpsTab = 'nominations' | 'invigilation' | 'evaluation' | 'mis'

export function OperationsPage() {
  const {
    context,
    activeInstitutionId,
    activeExamCycleId,
    platformRoles,
    memberships,
    previewTier,
  } = useAppStore()

  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  const isManagementOnly = access.effectiveTier === 'MANAGEMENT'
  const canCoeDuties =
    access.effectiveTier === 'ALL' ||
    access.isCoeOrExecutiveLead ||
    (activeMembership?.roles.includes('EXAM_STAFF') ?? false)
  const canNominate =
    !isManagementOnly &&
    (access.effectiveTier === 'ALL' ||
      access.effectiveTier === 'LEAD_TEAM' ||
      (activeMembership?.roles.some((r) => r === 'DEPT_COORDINATOR' || r === 'EXAM_STAFF') ?? false))

  const visibleTabs = useMemo(() => {
    const list: Array<{ id: OpsTab; label: string; icon: typeof UserPlus }> = []
    if (!isManagementOnly) list.push({ id: 'nominations', label: 'Duty Nominations', icon: UserPlus })
    if (canCoeDuties) {
      list.push({ id: 'invigilation', label: 'Invigilation Roster', icon: Calendar })
      list.push({ id: 'evaluation', label: 'FIFO Evaluation', icon: FileCheck2 })
    }
    list.push({ id: 'mis', label: '4-Tab MIS Compliance', icon: BarChart3 })
    return list
  }, [isManagementOnly, canCoeDuties])

  const [activeTab, setActiveTab] = useState<OpsTab>('mis')

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

  const { data: staff = [] } = useQuery({
    queryKey: ['ops_staff', activeInstitutionId],
    enabled: Boolean(activeInstitutionId && !isManagementOnly),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, employee_code, full_name, designation, department_label, branch_label, academic_unit_id')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: courses = [] } = useQuery({
    queryKey: ['ops_courses', activeInstitutionId],
    enabled: Boolean(activeInstitutionId && !isManagementOnly),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_catalog')
        .select('id, course_code, title')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('course_code')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: leaves = [] } = useQuery({
    queryKey: ['ops_faculty_leaves', activeInstitutionId],
    enabled: Boolean(activeInstitutionId && !isManagementOnly),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('faculty_leave_logs')
        .select('staff_profile_id, start_date, end_date, leave_type')
        .eq('institution_id', activeInstitutionId!)
        .neq('status', 'CANCELLED')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: nominations = [] } = useQuery<DutyNominationRow[]>({
    queryKey: ['exam_duty_nominations', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id && !isManagementOnly),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_duty_nominations')
        .select('*')
        .eq('institution_id', activeInstitutionId!)
        .eq('exam_cycle_id', activeCycle!.id)
        .order('nominated_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as DutyNominationRow[]
    },
  })

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <Briefcase className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to manage Exam Duties and 4-Tab MIS Compliance.
        </p>
      </div>
    )
  }

  const instName = activeMembership?.institution.name ?? 'Institution'
  const scopedUnitId =
    !access.isFullAdmin && !access.isCoeOrExecutiveLead
      ? (activeMembership?.staffScope?.academic_unit_id ?? null)
      : null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Exam Duties &amp; MIS Compliance</h1>
        <p className="text-sm text-slate-500">
          Invigilation room-duty scheduling, FIFO course evaluation assignments, and 4-tab institutional compliance
          telemetry ({activeCycle?.code ?? 'Select Cycle'}).
        </p>
      </div>

      <div className="border-b border-slate-200 flex gap-6 text-sm overflow-x-auto">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
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

      {activeTab === 'nominations' && (
        <DutyNominationsTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          staff={staff}
          courses={courses}
          leaves={leaves}
          nominations={nominations}
          scopedUnitId={scopedUnitId}
          canNominate={canNominate}
        />
      )}
      {activeTab === 'invigilation' && (
        <InvigilationDutiesTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          cycle={activeCycle}
          nominations={nominations}
          leaves={leaves}
          canManage={canCoeDuties}
        />
      )}
      {activeTab === 'evaluation' && (
        <EvaluationDutiesTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          cycle={activeCycle}
          nominations={nominations}
          canManage={canCoeDuties}
        />
      )}
      {activeTab === 'mis' && (
        <MisComplianceTab institutionId={activeInstitutionId} cycle={activeCycle} />
      )}
    </div>
  )
}
