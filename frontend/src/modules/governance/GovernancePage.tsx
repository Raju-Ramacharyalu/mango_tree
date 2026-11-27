import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Book, BookOpen, UserCog, ClipboardCheck, Landmark } from 'lucide-react'
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
import { CurriculumMasterTab } from './CurriculumMasterTab'
import { SectionAllocationsTab } from './SectionAllocationsTab'
import { Faculty360Tab } from './Faculty360Tab'
import { CieVerificationTab } from './CieVerificationTab'
import { cn } from '@/utils/cn'

type GovernanceTab = 'curriculum' | 'allocations' | 'faculty-360' | 'cie'

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function GovernancePage() {
  const [activeTab, setActiveTab] = useState<GovernanceTab>('curriculum')
  const [academicYear, setAcademicYear] = useState('2026-27')
  const [term, setTerm] = useState<'ODD' | 'EVEN'>('ODD')

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
    Array<{ id: string; course_code: string; title: string; default_credits: number }>
  >({
    queryKey: ['governance_courses', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_catalog')
        .select('id, course_code, title, default_credits')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('course_code')
      if (error) throw error
      return (data ?? []).map((c) => ({
        id: c.id as string,
        course_code: c.course_code as string,
        title: c.title as string,
        default_credits: Number(c.default_credits ?? 0),
      }))
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

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <Landmark className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to manage BOS Curriculum, Section Allocations, Faculty 360, and
          Verified CIE Marks.
        </p>
      </div>
    )
  }

  const activeCycle = cycles.find((c) => c.id === activeExamCycleId) ?? cycles[0] ?? null
  const isLeadOrAdmin = access.effectiveTier === 'ALL' || access.effectiveTier === 'LEAD_TEAM'
  const canEnterCie = access.effectiveTier !== 'MANAGEMENT'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">BOS Governance, Allocations &amp; CIE</h1>
          <p className="text-sm text-slate-500">
            Curriculum Master (Syllabus, CO-PO &amp; Rubrics), Section Allocations, Faculty 360 HR, and Verified CIE
            Pipeline ({access.scopeBadge}).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            className="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
          />
          <select
            value={term}
            onChange={(e) => setTerm(e.target.value as 'ODD' | 'EVEN')}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
          >
            <option value="ODD">ODD Term</option>
            <option value="EVEN">EVEN Term</option>
          </select>
        </div>
      </div>

      <div className="border-b border-slate-200 flex gap-6 text-sm overflow-x-auto">
        {(
          [
            { id: 'curriculum', label: 'BOS Curriculum Master', icon: Book },
            { id: 'allocations', label: 'Section Allocations', icon: BookOpen },
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
