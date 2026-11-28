import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Book, BookOpen, UserCog, ClipboardCheck, Landmark, FileCheck2, Users } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess } from '@/app/rbac'
import type { ExamCycle } from '@/types/exams'
import type {
  GovernanceProgramRow,
  GovernanceStaffRow,
  GovernanceUnitRow,
  SectionAllocationRow,
} from '@/types/governance'
import type { BoeNominationRow, IaQpAllocationRow } from '@/types/qpVault'
import { CurriculumMasterTab } from './CurriculumMasterTab'
import { SectionAllocationsTab } from './SectionAllocationsTab'
import { Faculty360Tab } from './Faculty360Tab'
import { CieVerificationTab } from './CieVerificationTab'
import { IaVaultAllocationsTab } from '@/modules/qp-vault/IaVaultAllocationsTab'
import { BoeAppointmentsTab } from '@/modules/qp-vault/BoeAppointmentsTab'
import { cn } from '@/utils/cn'

type GovernanceTab = 'curriculum' | 'allocations' | 'ia-allocations' | 'boe-nominations' | 'faculty-360' | 'cie'

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function GovernancePage() {
  const [activeTab, setActiveTab] = useState<GovernanceTab>('curriculum')

  const {
    context,
    activeInstitutionId,
    activeAcademicYear: academicYear,
    activeTerm: term,
    setActiveAcademicTerm,
    activeExamCycleId,
    setActiveExamCycle,
    platformRoles,
    memberships,
    previewTier,
  } = useAppStore()

  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  const instRoles = activeMembership?.roles ?? []
  const isFirstYearDean = !access.isFullAdmin && instRoles.includes('DEAN_FIRST_YEAR')
  const isInstitutionWideLead =
    access.isFullAdmin ||
    instRoles.some((r) =>
      ['PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER', 'DEAN_ACADEMICS', 'ACADEMIC_ADVISOR', 'ACADEMIC_ADMIN'].includes(r)
    )
  const scopedUnitId =
    !isInstitutionWideLead && !isFirstYearDean
      ? (activeMembership?.staffScope?.academic_unit_id ?? null)
      : null

  const { data: units = [] } = useQuery<GovernanceUnitRow[]>({
    queryKey: ['governance_units', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_units')
        .select('id, code, name')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as GovernanceUnitRow[]
    },
  })

  const { data: programs = [] } = useQuery<GovernanceProgramRow[]>({
    queryKey: ['governance_programs', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('programs')
        .select('id, code, name, program_level, academic_unit_id')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .order('code')
      if (error) throw error
      return (data ?? []) as GovernanceProgramRow[]
    },
  })

  const { data: courses = [] } = useQuery<
    Array<{ id: string; course_code: string; title: string; default_credits: number; course_type: string }>
  >({
    queryKey: ['governance_courses', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_catalog')
        .select('id, course_code, title, default_credits, course_categories(code)')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('course_code')
      if (error) throw error
      return (data ?? []).map((c) => {
        const cat = unwrap(c.course_categories as { code: string } | { code: string }[] | null)
        return {
          id: c.id as string,
          course_code: c.course_code as string,
          title: c.title as string,
          default_credits: Number(c.default_credits ?? 0),
          course_type: cat?.code ?? 'THEORY',
        }
      })
    },
  })

  const { data: staff = [] } = useQuery<GovernanceStaffRow[]>({
    queryKey: ['governance_staff', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select(`
          id, employee_code, full_name, email, phone, designation,
          academic_unit_id, department_label, branch_label, is_evaluator, is_active,
          academic_units (code, name)
        `)
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .order('full_name')
      if (error) throw error
      return (data ?? []).map((s) => {
        const u = unwrap(s.academic_units as { code: string; name: string } | { code: string; name: string }[] | null)
        return {
          id: s.id as string,
          employee_code: s.employee_code as string,
          full_name: s.full_name as string,
          email: (s.email as string | null) ?? null,
          phone: (s.phone as string | null) ?? null,
          designation: s.designation as string,
          academic_unit_id: (s.academic_unit_id as string | null) ?? null,
          department_label: (s.department_label as string | null) ?? null,
          branch_label: (s.branch_label as string | null) ?? null,
          is_evaluator: Boolean(s.is_evaluator),
          is_active: Boolean(s.is_active),
          unit_code: u?.code ?? null,
          unit_name: u?.name ?? null,
        }
      })
    },
  })

  const { data: allocations = [] } = useQuery<SectionAllocationRow[]>({
    queryKey: ['governance_allocations', activeInstitutionId, academicYear, term],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_section_allocations')
        .select(`
          id, institution_id, exam_cycle_id, academic_year, term, program_id,
          semester_number, section_name, course_id, course_code, staff_profile_id, faculty_code,
          programs (code),
          course_catalog (title),
          staff_profiles (full_name)
        `)
        .eq('institution_id', activeInstitutionId!)
        .eq('academic_year', academicYear)
        .eq('term', term)
        .order('semester_number', { ascending: true })
        .order('course_code', { ascending: true })
      if (error) throw error
      return (data ?? []).map((row) => {
        const p = unwrap(row.programs as { code: string } | { code: string }[] | null)
        const c = unwrap(row.course_catalog as { title: string } | { title: string }[] | null)
        const st = unwrap(row.staff_profiles as { full_name: string } | { full_name: string }[] | null)
        return {
          id: row.id as string,
          institution_id: row.institution_id as string,
          exam_cycle_id: (row.exam_cycle_id as string | null) ?? null,
          academic_year: row.academic_year as string,
          term: row.term as 'ODD' | 'EVEN' | 'SUMMER',
          program_id: row.program_id as string,
          program_code: p?.code ?? 'GEN',
          semester_number: Number(row.semester_number),
          section_name: row.section_name as string,
          course_id: row.course_id as string,
          course_code: row.course_code as string,
          course_title: c?.title ?? 'Course',
          staff_profile_id: row.staff_profile_id as string,
          faculty_code: row.faculty_code as string,
          faculty_name: st?.full_name ?? (row.faculty_code as string),
        }
      })
    },
  })

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

  const sectionTeacherMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const row of allocations) {
      const list = map.get(row.course_code) ?? []
      if (!list.includes(row.staff_profile_id)) list.push(row.staff_profile_id)
      map.set(row.course_code, list)
    }
    return map
  }, [allocations])

  const { data: iaAllocations = [] } = useQuery<IaQpAllocationRow[]>({
    queryKey: ['ia_qp_allocations', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id && activeTab === 'ia-allocations'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ia_qp_allocations')
        .select(`
          id, institution_id, exam_cycle_id, course_id, course_code, staff_profile_id, faculty_code,
          ia_number, num_sets, qp_pattern, max_marks, duration_minutes, qp_content, status, updated_at,
          course_catalog (title, course_categories(code)),
          staff_profiles (full_name)
        `)
        .eq('institution_id', activeInstitutionId!)
        .eq('exam_cycle_id', activeCycle!.id)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => {
        const cc = unwrap(
          row.course_catalog as
            | { title: string; course_categories: { code: string } | { code: string }[] | null }
            | { title: string; course_categories: { code: string } | { code: string }[] | null }[]
            | null
        )
        const cat = cc ? unwrap(cc.course_categories) : null
        const st = unwrap(row.staff_profiles as { full_name: string } | { full_name: string }[] | null)
        return {
          id: row.id as string,
          institution_id: row.institution_id as string,
          exam_cycle_id: row.exam_cycle_id as string,
          course_id: row.course_id as string,
          course_code: row.course_code as string,
          course_title: cc?.title ?? (row.course_code as string),
          course_type: cat?.code ?? 'THEORY',
          staff_profile_id: row.staff_profile_id as string,
          faculty_code: row.faculty_code as string,
          faculty_name: st?.full_name ?? (row.faculty_code as string),
          ia_number: Number(row.ia_number) as 1 | 2 | 3,
          num_sets: Number(row.num_sets ?? 1),
          qp_pattern: row.qp_pattern as 'DESCRIPTIVE' | 'OMR_50' | 'OMR_25',
          max_marks: Number(row.max_marks ?? 50),
          duration_minutes: Number(row.duration_minutes ?? 90),
          qp_content: (row.qp_content as string | null) ?? null,
          status: row.status as 'DRAFT' | 'SUBMITTED',
          updated_at: row.updated_at as string,
        }
      })
    },
  })

  const { data: boeNominations = [] } = useQuery<BoeNominationRow[]>({
    queryKey: ['boe_nominations', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id && activeTab === 'boe-nominations'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('boe_nominations')
        .select('*')
        .eq('institution_id', activeInstitutionId!)
        .eq('exam_cycle_id', activeCycle!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BoeNominationRow[]
    },
  })

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <Landmark className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to manage BOS Curriculum, Section &amp; IA Allocations, BOE
          Nominations, Faculty 360, and Verified CIE Marks.
        </p>
      </div>
    )
  }

  const instName = activeMembership?.institution.name ?? 'Institution'
  const isLeadOrAdmin = access.effectiveTier === 'ALL' || access.effectiveTier === 'LEAD_TEAM'
  const canEnterCie = access.effectiveTier !== 'MANAGEMENT'
  const showCyclePicker = activeTab === 'ia-allocations' || activeTab === 'boe-nominations' || activeTab === 'cie'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">BOS, BOE &amp; CIE Governance</h1>
          <p className="text-sm text-slate-500">
            Department academic hub: Syllabus &amp; CO-PO, Section &amp; IA QP Allocations, BOE Setter Nominations,
            Faculty 360, and Verified CIE ({access.scopeBadge}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={academicYear}
            onChange={(e) => setActiveAcademicTerm(e.target.value, term)}
            className="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
          />
          <select
            value={term}
            onChange={(e) => setActiveAcademicTerm(academicYear, e.target.value as 'ODD' | 'EVEN')}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
          >
            <option value="ODD">ODD Term</option>
            <option value="EVEN">EVEN Term</option>
          </select>
          {showCyclePicker && cycles.length > 0 && (
            <select
              value={activeCycle?.id ?? ''}
              onChange={(e) => setActiveExamCycle(e.target.value || null)}
              className="rounded-md border border-indigo-300 bg-indigo-50/40 px-2.5 py-1.5 text-xs font-medium text-indigo-950 max-w-xs"
              title="Linked Exam Cycle"
            >
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  Cycle: {c.code} ({c.cycle_type})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="border-b border-slate-200 flex gap-5 text-sm overflow-x-auto">
        {(
          [
            { id: 'curriculum', label: 'BOS Curriculum', icon: Book },
            { id: 'allocations', label: 'Section Allocations', icon: BookOpen },
            { id: 'ia-allocations', label: 'IA QP Allocations', icon: FileCheck2 },
            { id: 'boe-nominations', label: 'BOE Nominations', icon: Users },
            { id: 'faculty-360', label: 'Faculty 360 & Leaves', icon: UserCog },
            { id: 'cie', label: 'Verified CIE Marks', icon: ClipboardCheck },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
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

      {activeTab === 'curriculum' && (
        <CurriculumMasterTab
          institutionId={activeInstitutionId}
          academicYear={academicYear}
          term={term}
          courses={courses}
          canEdit={isLeadOrAdmin}
        />
      )}
      {activeTab === 'allocations' && (
        <SectionAllocationsTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          academicYear={academicYear}
          term={term}
          programs={programs}
          courses={courses}
          staff={staff}
          allocations={allocations}
          isFirstYearDean={isFirstYearDean}
          scopedUnitId={scopedUnitId}
          canManage={isLeadOrAdmin}
        />
      )}
      {activeTab === 'ia-allocations' && (
        <IaVaultAllocationsTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          cycle={activeCycle}
          courses={courses}
          staff={staff}
          sectionTeacherMap={sectionTeacherMap}
          allocations={iaAllocations}
          coePrivateKeyPem=""
          canManage={isLeadOrAdmin}
          mode="ALLOCATE"
        />
      )}
      {activeTab === 'boe-nominations' && (
        <BoeAppointmentsTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          cycle={activeCycle}
          courses={courses}
          staff={staff}
          nominations={boeNominations}
          canNominate={isLeadOrAdmin}
          canCoeApprove={false}
        />
      )}
      {activeTab === 'faculty-360' && (
        <Faculty360Tab
          institutionId={activeInstitutionId}
          staff={staff}
          units={units}
          allocations={allocations}
          scopedUnitId={scopedUnitId}
          canManage={isLeadOrAdmin}
        />
      )}
      {activeTab === 'cie' && (
        <CieVerificationTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          academicYear={academicYear}
          term={term}
          programs={programs}
          allocations={allocations}
          isFirstYearDean={isFirstYearDean}
          scopedUnitId={scopedUnitId}
          canEnterCie={canEnterCie}
          canApproveCie={isLeadOrAdmin}
        />
      )}
    </div>
  )
}
