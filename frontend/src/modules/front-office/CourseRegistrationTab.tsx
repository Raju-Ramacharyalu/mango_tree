import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  BookOpen,
  Sun,
  Zap,
  Printer,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Users,
  CalendarClock,
  Download,
  Lock,
  Unlock,
  Plus,
  Sparkles,
} from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { CourseCatalogOption, ExamCycle } from '@/types/exams'
import type { StudentFrontOfficeRecord } from '@/types/frontOffice'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderWatermarkHtml,
  signStudentPhotosWithFallback,
} from '@/modules/exams/printBranding'
import { printOfficialCourseRegistrationForms } from './courseRegPrint'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  students: StudentFrontOfficeRecord[]
  canManage: boolean
  canApproveCreditOverride: boolean
}

interface CourseRegWindowRow {
  id: string
  institution_id: string
  title: string
  academic_year: string
  term: 'ODD' | 'EVEN'
  program_level: string
  scheme_batch: number | null
  target_semesters: number[]
  status: 'OPEN' | 'CLOSED'
  opens_at: string
  closes_at: string | null
  allow_student_self_reg: boolean
  instructions: string | null
  created_at: string
}

interface AcademicRegRow {
  id: string
  student_id: string
  course_id: string
  course_code: string
  course_type: string
  credits: number
  semester_number: number
  registration_source: string
  submitted_by_student: boolean
  submitted_at: string | null
}

interface LatestAttemptCourseRow {
  course_id: string
  course_code: string
  course_title: string
  credits: number
  semester_number: number
  cie_marks: number | null
  see_marks: number | null
  total_marks: number | null
  grade_code: string | null
  grade_point: number | null
  result_status: string
  attempt_number: number
  attempt_count: number
  is_reattempt: boolean
  latest_cycle_code: string
}

interface FailedCourseCandidate {
  course_id: string
  course_code: string
  course_title: string
  credits: number
  cie_marks: number
  grade_code: string
  summerRule: 'RULE_1' | 'RULE_2' | 'RULE_3'
  summerRuleLabel: string
  priorOdeAttempts: number
  latestCycleCode: string
}

interface StudentRegContextResponse {
  found: boolean
  active_window: CourseRegWindowRow | null
  curriculum: { id: string; code: string; name: string; scheme_batch: number | null } | null
  has_submitted: boolean
  submitted_at: string | null
  submitted_by_student: boolean
  mandatory_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string; is_online: boolean }>
  lateral_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string }>
  pe_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string }>
  oe_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string; branch_code: string }>
  submitted_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string; registration_source: string }>
}

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    const e = err as { message: string; details?: string; code?: string }
    return [e.code ? `[${e.code}]` : '', e.message, e.details || ''].filter(Boolean).join(' ')
  }
  return fallback
}

function computeSummerFeeBreakdown(items: Array<{ summerRule: 'RULE_1' | 'RULE_2' | 'RULE_3' }>): {
  baseFee: number
  subjectFeeTotal: number
  total: number
  perItemFees: number[]
} {
  if (items.length === 0) return { baseFee: 0, subjectFeeTotal: 0, total: 0, perItemFees: [] }
  const baseFee = 400
  let rule2Count = 0
  const perItemFees: number[] = []
  for (const item of items) {
    if (item.summerRule === 'RULE_1') perItemFees.push(5600)
    else if (item.summerRule === 'RULE_2') {
      rule2Count += 1
      perItemFees.push(rule2Count === 1 ? 2000 : 1000)
    } else perItemFees.push(600)
  }
  const subjectFeeTotal = perItemFees.reduce((s, f) => s + f, 0)
  return { baseFee, subjectFeeTotal, total: baseFee + subjectFeeTotal, perItemFees }
}

function computeOdeFeeBreakdown(items: Array<{ attemptNum: number }>): {
  att1Count: number
  att2Count: number
  appFee: number
  gradeCardFee: number
  subjectFeeTotal: number
  total: number
} {
  if (items.length === 0) {
    return { att1Count: 0, att2Count: 0, appFee: 0, gradeCardFee: 0, subjectFeeTotal: 0, total: 0 }
  }
  const att1Count = items.filter((i) => i.attemptNum <= 1).length
  const att2Count = items.filter((i) => i.attemptNum > 1).length
  const appFee = 100
  const gradeCardFee = 600
  const subjectFeeTotal = att1Count * 6000 + att2Count * 3000
  return { att1Count, att2Count, appFee, gradeCardFee, subjectFeeTotal, total: appFee + gradeCardFee + subjectFeeTotal }
}

export function CourseRegistrationTab({
  institutionId,
  cycle,
  students,
  canManage,
  canApproveCreditOverride,
}: Props) {
  const queryClient = useQueryClient()
  const {
    session,
    activeAcademicYear,
    activeTerm,
    setActiveAcademicTerm,
    platformRoles,
    memberships,
    activeInstitutionId,
  } = useAppStore()
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const canTriggerWindows =
    platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN') ||
    (activeMembership?.roles ?? []).some((r) =>
      ['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER', 'ACADEMIC_ADMIN'].includes(r)
    )

  const [mode, setMode] = useState<'TRACKER' | 'SINGLE' | 'SUMMER' | 'ODE'>('TRACKER')

  // COE Window Creator Form
  const [showWindowForm, setShowWindowForm] = useState(false)
  const [winTitle, setWinTitle] = useState('')
  const [winLevel, setWinLevel] = useState<'UG' | 'PG' | 'ALL'>('UG')
  const [winScheme, setWinScheme] = useState('')
  const [winSems, setWinSems] = useState(activeTerm === 'ODD' ? '1, 3, 5, 7' : '2, 4, 6, 8')
  const [winClosesAt, setWinClosesAt] = useState('')
  const [winInstructions, setWinInstructions] = useState(
    'Verify your auto-selected Core courses, choose your approved Professional/Open Electives if applicable, and submit to avoid Exam Application delays.'
  )

  // Compliance Tracker & Bulk Print Filters
  const [filterBranch, setFilterBranch] = useState('ALL')
  const [filterSem, setFilterSem] = useState(activeTerm === 'ODD' ? '3' : '2')
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'UG' | 'PG'>('ALL')
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'SUBMITTED' | 'PENDING'>('ALL')
  const [printingBulk, setPrintingBulk] = useState(false)

  // Single Student Desk Mode
  const [targetId, setTargetId] = useState('')
  const [pickedPeId, setPickedPeId] = useState('')
  const [pickedOeId, setPickedOeId] = useState('')
  const [extraManualIds, setExtraManualIds] = useState<string[]>([])
  const [editDeskOverride, setEditDeskOverride] = useState(false)

  // Summer / ODE state
  const [selectedSpecialCycleId, setSelectedSpecialCycleId] = useState<string>(cycle?.id ?? '')
  const [selectedFailedIds, setSelectedFailedIds] = useState<string[]>([])
  const [utrRef, setUtrRef] = useState('')
  const [allowCreditOverride, setAllowCreditOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [odeAttemptChoice, setOdeAttemptChoice] = useState<Record<string, number>>({})

  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const studentByLookup = useMemo(() => {
    const map = new Map<string, StudentFrontOfficeRecord>()
    for (const s of students) {
      map.set(s.registration_number.trim().toUpperCase(), s)
      if (s.admission_number) map.set(s.admission_number.trim().toUpperCase(), s)
    }
    return map
  }, [students])

  const activeStudent = useMemo(() => {
    const clean = targetId.trim().toUpperCase()
    return clean ? (studentByLookup.get(clean) ?? null) : null
  }, [targetId, studentByLookup])

  const branches = useMemo(
    () => Array.from(new Set(students.map((s) => s.program_code).filter(Boolean))).sort(),
    [students]
  )

  // 1. Fetch COE Course Registration Windows
  const { data: windows = [] } = useQuery<CourseRegWindowRow[]>({
    queryKey: ['course_registration_windows', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_registration_windows')
        .select('*')
        .eq('institution_id', institutionId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CourseRegWindowRow[]
    },
  })

  const cleanAy = activeAcademicYear.trim()

  // 2. Fetch ALL Phase 1 academic_course_registrations for current AY + Term
  const { data: termRegs = [], isLoading: loadingRegs, error: termRegsError } = useQuery<AcademicRegRow[]>({
    queryKey: ['term_academic_course_regs', institutionId, cleanAy, activeTerm],
    queryFn: async () => {
      return fetchAllRows<AcademicRegRow>((from, to) =>
        supabase
          .from('academic_course_registrations')
          .select('*')
          .eq('institution_id', institutionId)
          .eq('academic_year', cleanAy)
          .eq('term', activeTerm)
          .eq('status', 'ACTIVE')
          .order('created_at', { ascending: true })
          .range(from, to)
      )
    },
  })

  // 3. Course catalog
  const { data: catalogCourses = [] } = useQuery<CourseCatalogOption[]>({
    queryKey: ['front_office_course_catalog', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_catalog')
        .select('id, course_code, title, default_credits, course_categories(code, is_online)')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('course_code')
      if (error) throw error
      return (data ?? []).map((row) => {
        const cat = unwrap(
          row.course_categories as { code: string; is_online: boolean } | { code: string; is_online: boolean }[] | null
        )
        return {
          id: row.id as string,
          course_code: row.course_code as string,
          title: row.title as string,
          default_credits: Number(row.default_credits ?? 0),
          is_online: Boolean(cat?.is_online),
          category_code: cat?.code ?? null,
        }
      })
    },
  })

  const catalogById = useMemo(() => new Map(catalogCourses.map((c) => [c.id, c])), [catalogCourses])
  const catalogByCode = useMemo(
    () => new Map(catalogCourses.map((c) => [c.course_code.trim().toUpperCase(), c])),
    [catalogCourses]
  )

  // 4. Single-Student Desk Context (same canonical RPC used by Student Portal!)
  const { data: singleCtx } = useQuery<StudentRegContextResponse>({
    queryKey: ['desk_student_reg_ctx', institutionId, activeStudent?.registration_number, activeAcademicYear, activeTerm],
    enabled: Boolean(mode === 'SINGLE' && activeStudent?.registration_number),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_student_course_reg_context', {
        p_institution_id: institutionId,
        p_preview_usn: activeStudent!.registration_number,
      })
      if (error) throw error
      return data as StudentRegContextResponse
    },
  })

  // 5. Exam cycles & latest attempts for Summer / ODE modes
  const { data: examCycles = [] } = useQuery<ExamCycle[]>({
    queryKey: ['exam_cycles', institutionId],
    enabled: mode === 'SUMMER' || mode === 'ODE',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_cycles')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('is_default_active', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ExamCycle[]
    },
  })

  useEffect(() => {
    if ((mode !== 'SUMMER' && mode !== 'ODE') || examCycles.length === 0) return
    const currentValid = examCycles.find((c) => c.id === selectedSpecialCycleId && c.cycle_type === mode)
    if (currentValid) return
    const preferred =
      examCycles.find((c) => c.cycle_type === mode && c.status !== 'ARCHIVED' && c.status !== 'COMPLETED') ??
      examCycles.find((c) => c.cycle_type === mode) ??
      cycle ??
      examCycles[0]
    if (preferred) setSelectedSpecialCycleId(preferred.id)
  }, [mode, examCycles, selectedSpecialCycleId, cycle])

  const activeSpecialCycle = useMemo(
    () => examCycles.find((c) => c.id === selectedSpecialCycleId) ?? cycle ?? null,
    [examCycles, selectedSpecialCycleId, cycle]
  )

  const { data: latestAttempts = [] } = useQuery<LatestAttemptCourseRow[]>({
    queryKey: ['student_latest_course_status', institutionId, activeStudent?.id],
    enabled: Boolean(activeStudent?.id && (mode === 'SUMMER' || mode === 'ODE')),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_student_latest_course_status', {
        p_institution_id: institutionId,
        p_student_id: activeStudent!.id,
        p_published_only: false,
      })
      if (error) throw error
      return (data ?? []) as LatestAttemptCourseRow[]
    },
  })

  const { data: priorOdeCounts = new Map<string, number>() } = useQuery({
    queryKey: ['student_prior_ode_counts', institutionId, activeStudent?.id, activeSpecialCycle?.id],
    enabled: Boolean(activeStudent?.id && mode === 'ODE'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_registration_courses')
        .select('course_id, exam_cycle_id, registration_category')
        .eq('institution_id', institutionId)
        .eq('student_id', activeStudent!.id)
      if (error) throw error
      const map = new Map<string, number>()
      for (const row of data ?? []) {
        if (row.exam_cycle_id === activeSpecialCycle?.id) continue
        if (String(row.registration_category ?? '').toUpperCase().includes('ODE')) {
          map.set(row.course_id as string, (map.get(row.course_id as string) ?? 0) + 1)
        }
      }
      return map
    },
  })

  const failedCandidates = useMemo<FailedCourseCandidate[]>(() => {
    if (!activeStudent) return []
    const cieThreshold = activeStudent.program_level.toUpperCase() === 'PG' ? 25 : 20
    const out: FailedCourseCandidate[] = []
    for (const r of latestAttempts) {
      if (!['FAIL', 'ABSENT', 'MALPRACTICE'].includes(r.result_status)) continue
      const cie = Number(r.cie_marks ?? 0)
      const grade = String(r.grade_code ?? (r.result_status === 'ABSENT' ? 'AB' : 'F')).toUpperCase()
      let summerRule: 'RULE_1' | 'RULE_2' | 'RULE_3' = 'RULE_3'
      let summerRuleLabel = 'Rule 3: Exam Only (SEE Fail / MP)'
      if (cie < cieThreshold) {
        summerRule = 'RULE_1'
        summerRuleLabel = 'Rule 1: Mandatory Classes (CIE Fail)'
      } else if (grade === 'AB' || r.result_status === 'ABSENT') {
        summerRule = 'RULE_2'
        summerRuleLabel = 'Rule 2: Exam Only (Absent)'
      }
      out.push({
        course_id: r.course_id,
        course_code: r.course_code,
        course_title: r.course_title,
        credits: Number(r.credits ?? 3),
        cie_marks: cie,
        grade_code: grade,
        summerRule,
        summerRuleLabel,
        priorOdeAttempts: priorOdeCounts.get(r.course_id) ?? 0,
        latestCycleCode: r.latest_cycle_code,
      })
    }
    return out.sort((a, b) => a.course_code.localeCompare(b.course_code))
  }, [activeStudent, latestAttempts, priorOdeCounts])

  // Index termRegs by student_id for Live Compliance Tracker
  const regsByStudent = useMemo(() => {
    const map = new Map<string, AcademicRegRow[]>()
    for (const r of termRegs) {
      const list = map.get(r.student_id) ?? []
      list.push(r)
      map.set(r.student_id, list)
    }
    return map
  }, [termRegs])

  const trackerCohort = useMemo(() => {
    const targetSemNum = filterSem === 'ALL' ? null : Number(filterSem)
    return students
      .filter((s) => {
        if (filterBranch !== 'ALL' && s.program_code !== filterBranch) return false
        if (filterLevel !== 'ALL' && s.program_level !== filterLevel) return false
        if (targetSemNum !== null && s.current_sem !== targetSemNum) return false
        return true
      })
      .map((s) => {
        const list = regsByStudent.get(s.id) ?? []
        const submitted = list.length > 0
        const byStudent = list.some((r) => r.submitted_by_student || r.registration_source === 'STUDENT_PORTAL')
        const totalCredits = list.reduce((sum, r) => sum + Number(r.credits || 0), 0)
        return { student: s, courses: list, submitted, byStudent, totalCredits }
      })
      .sort((a, b) => a.student.registration_number.localeCompare(b.student.registration_number, undefined, { numeric: true }))
  }, [students, filterBranch, filterLevel, filterSem, regsByStudent])

  const visibleTrackerRows = useMemo(() => {
    if (filterStatus === 'SUBMITTED') return trackerCohort.filter((r) => r.submitted)
    if (filterStatus === 'PENDING') return trackerCohort.filter((r) => !r.submitted)
    return trackerCohort
  }, [trackerCohort, filterStatus])

  const trackerStats = useMemo(() => {
    const total = trackerCohort.length
    const submitted = trackerCohort.filter((r) => r.submitted).length
    const byPortal = trackerCohort.filter((r) => r.submitted && r.byStudent).length
    const pending = total - submitted
    return { total, submitted, byPortal, byDesk: submitted - byPortal, pending }
  }, [trackerCohort])

  // Mutations: COE Window Create & Toggle
  const createWindowMutation = useMutation({
    mutationFn: async () => {
      const sems = winSems
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 8)
      if (sems.length === 0) throw new Error('Enter at least one valid semester number (e.g. 1, 3, 5).')
      const title =
        winTitle.trim() ||
        `${activeTerm} Semester ${activeAcademicYear} · ${winLevel}${winScheme ? ` (${winScheme} Scheme)` : ''} · Sem ${sems.join(', ')}`

      const { error } = await supabase.from('course_registration_windows').insert({
        institution_id: institutionId,
        title,
        academic_year: activeAcademicYear,
        term: activeTerm,
        program_level: winLevel,
        scheme_batch: winScheme.trim() ? Number(winScheme) : null,
        target_semesters: sems,
        status: 'OPEN',
        closes_at: winClosesAt ? new Date(`${winClosesAt}T23:59:59+05:30`).toISOString() : null,
        allow_student_self_reg: true,
        instructions: winInstructions.trim() || null,
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      })
      if (error) throw error
      return title
    },
    onSuccess: (title) => {
      setErrorMsg(null)
      setShowWindowForm(false)
      setWinTitle('')
      setNotice(`Triggered Course Registration Window: "${title}". Eligible students now see a high-priority banner in Student Portal.`)
      queryClient.invalidateQueries({ queryKey: ['course_registration_windows', institutionId] })
    },
    onError: (err) => setErrorMsg(extractErrorMessage(err, 'Failed to open registration window')),
  })

  const toggleWindowStatusMutation = useMutation({
    mutationFn: async ({ id, nextStatus }: { id: string; nextStatus: 'OPEN' | 'CLOSED' }) => {
      const { error } = await supabase
        .from('course_registration_windows')
        .update({ status: nextStatus, updated_by: session?.user.id ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course_registration_windows', institutionId] })
    },
  })

  // Pure-Core Auto-Registration for Pending Students in Selected Branch + Sem
  const autoRegisterPureCoreMutation = useMutation({
    mutationFn: async () => {
      if (filterBranch === 'ALL' || filterSem === 'ALL') {
        throw new Error('Select a specific Branch and Semester in the tracker filter above before auto-registering.')
      }
      const targetSem = Number(filterSem)
      if ((targetSem % 2 !== 0) !== (activeTerm === 'ODD')) {
        throw new Error(`Term parity mismatch: Active term is ${activeTerm}, cannot register Sem ${targetSem}.`)
      }
      const pendingStudents = trackerCohort.filter((r) => !r.submitted).map((r) => r.student)
      if (pendingStudents.length === 0) {
        throw new Error(`All ${trackerCohort.length} students in ${filterBranch} Sem ${targetSem} are already registered!`)
      }

      const programId = pendingStudents[0].program_id
      const periodId = pendingStudents[0].current_period_id
      if (!programId || !periodId) throw new Error('Students are missing program/semester enrollment mapping.')
      const sampleScheme = pendingStudents.find((s) => s.scheme_batch != null)?.scheme_batch ?? null

      const { data: curRows, error: cErr } = await supabase
        .from('curricula')
        .select('id, scheme_batch, version_number')
        .eq('institution_id', institutionId)
        .eq('program_id', programId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('scheme_batch', { ascending: false })
        .order('version_number', { ascending: false })
      if (cErr) throw cErr
      const matched =
        (sampleScheme !== null ? (curRows ?? []).find((c) => Number(c.scheme_batch) === Number(sampleScheme)) : null) ??
        (curRows ?? [])[0]
      if (!matched) throw new Error(`No active curriculum found for ${filterBranch}. Configure it in Academics → Curricula.`)

      const { data: ccRows, error: ccErr } = await supabase
        .from('curriculum_courses')
        .select('course_id, credits, is_elective, course_categories(code, is_online)')
        .eq('curriculum_id', matched.id)
        .eq('academic_period_id', periodId)
        .eq('is_active', true)
      if (ccErr) throw ccErr

      const allMapped = ccRows ?? []
      const hasElectives = allMapped.some((r) => {
        const cat = unwrap(r.course_categories as { code: string } | { code: string }[] | null)
        return Boolean(r.is_elective) || ['PE', 'OE'].includes(String(cat?.code ?? '').toUpperCase())
      })
      if (hasElectives) {
        const proceed = window.confirm(
          `${filterBranch} Sem ${targetSem} has PE/OE electives mapped. Auto-Register will assign ONLY Mandatory Core + Lateral courses to ${pendingStudents.length} pending student(s) (students can still pick PE/OE in Student Portal, or upload Electives via CSV). Continue?`
        )
        if (!proceed) return null
      }

      const coreRows = allMapped.filter((r) => {
        const cat = unwrap(r.course_categories as { code: string } | { code: string }[] | null)
        const code = String(cat?.code ?? 'CORE').toUpperCase()
        return !r.is_elective && !['PE', 'OE', 'LATERAL'].includes(code)
      })
      const lateralRows = allMapped.filter((r) => {
        const cat = unwrap(r.course_categories as { code: string } | { code: string }[] | null)
        return String(cat?.code ?? '').toUpperCase() === 'LATERAL'
      })
      if (coreRows.length === 0) throw new Error(`No mandatory Core courses mapped for ${filterBranch} Sem ${targetSem}.`)

      const payloadMap = new Map<string, Record<string, unknown>>()
      for (const stu of pendingStudents) {
        const isLat = String(stu.student_category ?? '').toUpperCase() === 'LATERAL'
        const assigned = isLat ? [...coreRows, ...lateralRows] : coreRows
        for (const cc of assigned) {
          const catObj = catalogById.get(cc.course_id as string)
          if (!catObj) continue
          const cCat = unwrap(cc.course_categories as { code: string; is_online: boolean } | { code: string; is_online: boolean }[] | null)
          payloadMap.set(`${stu.id}::${catObj.id}`, {
            institution_id: institutionId,
            academic_year: activeAcademicYear.trim(),
            term: activeTerm,
            student_id: stu.id,
            program_id: stu.program_id!,
            academic_period_id: stu.current_period_id,
            semester_number: targetSem,
            course_id: catObj.id,
            course_code: catObj.course_code,
            course_type: cCat?.is_online || catObj.is_online ? 'ONLINE' : (cCat?.code ?? catObj.category_code ?? 'CORE'),
            credits: Number(cc.credits ?? catObj.default_credits),
            registration_source: 'MANUAL',
            status: 'ACTIVE',
            submitted_by_student: false,
            submitted_at: new Date().toISOString(),
            created_by: session?.user.id ?? null,
            updated_by: session?.user.id ?? null,
          })
        }
      }

      const uniqueRows = Array.from(payloadMap.values())
      const chunkSize = 400
      for (let i = 0; i < uniqueRows.length; i += chunkSize) {
        const { error } = await supabase
          .from('academic_course_registrations')
          .upsert(uniqueRows.slice(i, i + chunkSize), {
            onConflict: 'institution_id,academic_year,term,student_id,course_id',
          })
        if (error) throw error
      }
      return { studentsCount: pendingStudents.length, rowCount: uniqueRows.length }
    },
    onSuccess: (res) => {
      if (!res) return
      setErrorMsg(null)
      setNotice(
        `Auto-registered ${res.studentsCount} pending student(s) in ${filterBranch} Sem ${filterSem} (${res.rowCount} course entries saved). You can now Bulk Print Official Copies.`
      )
      queryClient.invalidateQueries({ queryKey: ['term_academic_course_regs', institutionId, cleanAy, activeTerm] })
      queryClient.refetchQueries({ queryKey: ['term_academic_course_regs', institutionId, cleanAy, activeTerm] })
    },
    onError: (err) => setErrorMsg(extractErrorMessage(err, 'Auto-registration failed')),
  })

  // Desk Single-Student Save (Core + Lateral + PE/OE dropdowns)
  const saveSingleDeskMutation = useMutation({
    mutationFn: async () => {
      if (!activeStudent || !activeStudent.program_id) throw new Error('Select a valid student.')
      if ((activeStudent.current_sem % 2 !== 0) !== (activeTerm === 'ODD')) {
        throw new Error(`Term parity mismatch: Active term is ${activeTerm}, student is in Sem ${activeStudent.current_sem}.`)
      }

      const allIds = new Set<string>()
      for (const m of singleCtx?.mandatory_courses ?? []) allIds.add(m.course_id)
      for (const l of singleCtx?.lateral_courses ?? []) allIds.add(l.course_id)
      if (pickedPeId) allIds.add(pickedPeId)
      if (pickedOeId) allIds.add(pickedOeId)
      for (const x of extraManualIds) allIds.add(x)

      if (allIds.size === 0) throw new Error('No courses selected to register.')

      const rows = Array.from(allIds)
        .map((cid) => {
          const cat = catalogById.get(cid)
          if (!cat) return null
          const cType =
            cid === pickedPeId
              ? 'PE'
              : cid === pickedOeId
                ? 'OE'
                : cat.is_online
                  ? 'ONLINE'
                  : (cat.category_code ?? 'CORE')
          return {
            institution_id: institutionId,
            academic_year: activeAcademicYear.trim(),
            term: activeTerm,
            student_id: activeStudent.id,
            program_id: activeStudent.program_id!,
            academic_period_id: activeStudent.current_period_id,
            semester_number: activeStudent.current_sem,
            course_id: cat.id,
            course_code: cat.course_code,
            course_type: cType,
            credits: cat.default_credits,
            registration_source: 'MANUAL',
            status: 'ACTIVE',
            submitted_by_student: false,
            submitted_at: new Date().toISOString(),
            created_by: session?.user.id ?? null,
            updated_by: session?.user.id ?? null,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      const { error: delErr } = await supabase
        .from('academic_course_registrations')
        .delete()
        .eq('institution_id', institutionId)
        .eq('academic_year', activeAcademicYear.trim())
        .eq('term', activeTerm)
        .eq('student_id', activeStudent.id)
        .eq('semester_number', activeStudent.current_sem)
      if (delErr) throw delErr

      const { error: insErr } = await supabase.from('academic_course_registrations').insert(rows)
      if (insErr) throw insErr
      return rows
    },
    onSuccess: (rows) => {
      setErrorMsg(null)
      setEditDeskOverride(false)
      setNotice(`Saved ${rows.length} courses for ${activeStudent?.registration_number} (${activeAcademicYear} ${activeTerm}).`)
      queryClient.invalidateQueries({ queryKey: ['term_academic_course_regs', institutionId, cleanAy, activeTerm] })
      queryClient.refetchQueries({ queryKey: ['term_academic_course_regs', institutionId, cleanAy, activeTerm] })
      queryClient.invalidateQueries({ queryKey: ['desk_student_reg_ctx', institutionId, activeStudent?.registration_number] })
    },
    onError: (err) => setErrorMsg(extractErrorMessage(err, 'Single student registration failed')),
  })

  // Bulk CSV Upload (usn, course_code)
  const handleBulkPhase1Csv = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        try {
          const payloadMap = new Map<string, Record<string, unknown>>()
          let skipped = 0
          let paritySkipped = 0

          for (const rec of parsed.data) {
            const usn = (rec.usn || rec.USN || rec.Registration_Number || '').trim().toUpperCase()
            const code = (rec.course_code || rec.Course_Code || rec.COURSE_CODE || '').trim().toUpperCase()
            const stu = studentByLookup.get(usn)
            const crs = catalogByCode.get(code)
            if (!stu || !stu.program_id || !crs) {
              skipped += 1
              continue
            }
            if ((stu.current_sem % 2 !== 0) !== (activeTerm === 'ODD')) {
              paritySkipped += 1
              continue
            }
            payloadMap.set(`${stu.id}::${crs.id}`, {
              institution_id: institutionId,
              academic_year: activeAcademicYear.trim(),
              term: activeTerm,
              student_id: stu.id,
              program_id: stu.program_id,
              academic_period_id: stu.current_period_id,
              semester_number: stu.current_sem,
              course_id: crs.id,
              course_code: crs.course_code,
              course_type: crs.is_online ? 'ONLINE' : (crs.category_code ?? 'CORE'),
              credits: crs.default_credits,
              registration_source: 'CSV_ELECTIVE',
              status: 'ACTIVE',
              submitted_by_student: false,
              submitted_at: new Date().toISOString(),
              created_by: session?.user.id ?? null,
              updated_by: session?.user.id ?? null,
            })
          }

          const uniqueRows = Array.from(payloadMap.values())
          const chunkSize = 400
          for (let i = 0; i < uniqueRows.length; i += chunkSize) {
            const { error } = await supabase
              .from('academic_course_registrations')
              .upsert(uniqueRows.slice(i, i + chunkSize), {
                onConflict: 'institution_id,academic_year,term,student_id,course_id',
              })
            if (error) throw error
          }
          setErrorMsg(null)
          setNotice(
            `Bulk CSV sync complete: ${uniqueRows.length} course rows saved` +
              (skipped ? ` · ${skipped} unmatched skipped` : '') +
              (paritySkipped ? ` · ${paritySkipped} parity mismatch skipped` : '') +
              '.'
          )
          queryClient.invalidateQueries({ queryKey: ['term_academic_course_regs', institutionId, cleanAy, activeTerm] })
      queryClient.refetchQueries({ queryKey: ['term_academic_course_regs', institutionId, cleanAy, activeTerm] })
        } catch (err) {
          setErrorMsg(extractErrorMessage(err, 'Bulk CSV import failed'))
        }
      },
    })
  }

  // Summer & ODE Submit
  const saveSpecialCycleMutation = useMutation({
    mutationFn: async () => {
      if (!activeSpecialCycle) throw new Error('Select a Target Exam Cycle for this Summer / ODE application.')
      if (!activeStudent || !activeStudent.program_id) throw new Error('Select a valid student first.')

      const chosen = failedCandidates.filter((c) => selectedFailedIds.includes(c.course_id))
      if (chosen.length === 0) throw new Error('Select at least one eligible failed course.')

      let appFee = 0
      let gradeCardFee = 0
      let subjectFeeTotal = 0
      let totalFee = 0
      let perCourseFees: number[] = []

      if (mode === 'SUMMER') {
        const rule1Credits = chosen.filter((c) => c.summerRule === 'RULE_1').reduce((s, c) => s + c.credits, 0)
        const maxCredits = allowCreditOverride && canApproveCreditOverride ? 15 : 14
        if (rule1Credits > maxCredits) {
          throw new Error(`Rule 1 credit cap exceeded (${rule1Credits} credits selected; max ${maxCredits}).`)
        }
        const sumB = computeSummerFeeBreakdown(chosen)
        appFee = sumB.baseFee
        subjectFeeTotal = sumB.subjectFeeTotal
        totalFee = sumB.total
        perCourseFees = sumB.perItemFees
      } else {
        const odeItems = chosen.map((c) => ({
          attemptNum: odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1),
        }))
        const odeB = computeOdeFeeBreakdown(odeItems)
        appFee = odeB.appFee
        gradeCardFee = odeB.gradeCardFee
        subjectFeeTotal = odeB.subjectFeeTotal
        totalFee = odeB.total
        perCourseFees = odeItems.map((i) => (i.attemptNum <= 1 ? 6000 : 3000))
      }

      const { data: regRow, error: regErr } = await supabase
        .from('exam_registrations')
        .upsert(
          {
            institution_id: institutionId,
            exam_cycle_id: activeSpecialCycle.id,
            student_id: activeStudent.id,
            program_id: activeStudent.program_id,
            academic_period_id: activeStudent.current_period_id,
            registration_type: mode === 'SUMMER' ? 'SUMMER' : 'ODE',
            status: 'SUBMITTED',
            payment_status: utrRef.trim() ? 'PAID' : 'PENDING',
            payment_reference: utrRef.trim().toUpperCase() || null,
            application_fee: appFee,
            grade_card_fee: gradeCardFee,
            subject_fee_total: subjectFeeTotal,
            late_fee: 0,
            credit_override_approved: mode === 'SUMMER' && allowCreditOverride && canApproveCreditOverride,
            credit_override_by:
              mode === 'SUMMER' && allowCreditOverride && canApproveCreditOverride ? (session?.user.id ?? null) : null,
            credit_override_reason:
              mode === 'SUMMER' && allowCreditOverride && canApproveCreditOverride
                ? (overrideReason.trim() || 'Principal/HOD 15-Credit Override')
                : null,
            updated_by: session?.user.id ?? null,
          },
          { onConflict: 'exam_cycle_id,student_id' }
        )
        .select('id')
        .single()
      if (regErr) throw regErr

      const coursePayloads = chosen.map((c, idx) => {
        const att = mode === 'ODE' ? (odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1)) : 1
        return {
          institution_id: institutionId,
          exam_cycle_id: activeSpecialCycle.id,
          registration_id: regRow.id as string,
          student_id: activeStudent.id,
          course_id: c.course_id,
          academic_period_id: activeStudent.current_period_id,
          attempt_number: att,
          registration_category: mode === 'SUMMER' ? 'SUMMER' : 'ODE',
          rule_category:
            mode === 'SUMMER' ? c.summerRuleLabel : att === 1 ? 'Attempt 1 (Rs 6000)' : 'Attempt 2+ (Rs 3000)',
          is_online_exempt: false,
          subject_fee: perCourseFees[idx] ?? 0,
          eligibility_status: 'ELIGIBLE',
          updated_by: session?.user.id ?? null,
        }
      })

      const { error: delErr } = await supabase.from('exam_registration_courses').delete().eq('registration_id', regRow.id)
      if (delErr) throw delErr
      const { error: insErr } = await supabase.from('exam_registration_courses').insert(coursePayloads)
      if (insErr) throw insErr

      return { count: chosen.length, totalFee, cycleCode: activeSpecialCycle.code }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setNotice(
        `Saved ${mode} application for ${activeStudent?.registration_number} (${res.count} courses · ₹${res.totalFee.toLocaleString('en-IN')}) directly to ${res.cycleCode}.`
      )
      queryClient.invalidateQueries({ queryKey: ['exam_registrations', institutionId, activeSpecialCycle?.id] })
    },
    onError: (err) => setErrorMsg(extractErrorMessage(err, 'Failed to submit special cycle registration')),
  })

  // Bulk Print Official A4 Course Registration Forms for All Submitted Students in Current Tracker Filter
  const handleBulkPrintSubmitted = async () => {
    const submittedBatch = trackerCohort.filter((r) => r.submitted)
    if (submittedBatch.length === 0) {
      setErrorMsg('No submitted course registrations in this filter to print.')
      return
    }
    setPrintingBulk(true)
    setErrorMsg(null)
    try {
      await printOfficialCourseRegistrationForms({
        institutionId,
        institutionName: activeMembership?.institution.name,
        academicYear: activeAcademicYear,
        term: activeTerm,
        items: submittedBatch.map((item) => ({
          student: item.student,
          courses: item.courses.map((c) => ({
            course_code: c.course_code,
            course_title: catalogById.get(c.course_id)?.title ?? catalogByCode.get(c.course_code.toUpperCase())?.title ?? c.course_code,
            credits: Number(c.credits || 0),
            course_type: c.course_type,
          })),
        })),
        documentTitle: `Course_Registrations_${filterBranch}_Sem${filterSem}_${activeAcademicYear}_${activeTerm}`,
      })
    } finally {
      setPrintingBulk(false)
    }
  }

  const handleExportPendingCsv = () => {
    const pending = trackerCohort.filter((r) => !r.submitted)
    if (pending.length === 0) return
    const lines = [
      'USN,Student_Name,Branch,Level,Semester,Scheme,Category',
      ...pending.map(
        (r) =>
          `"${r.student.registration_number}","${r.student.full_name.replace(/"/g, '""')}","${r.student.program_code}","${r.student.program_level}",${r.student.current_sem},"${r.student.scheme_batch ?? ''}","${r.student.student_category}"`
      ),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Pending_Course_Registrations_${filterBranch}_Sem${filterSem}_${activeAcademicYear}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printSpecialCycleForm = async () => {
    if (!activeStudent) return
    const picked = failedCandidates.filter((c) => selectedFailedIds.includes(c.course_id))
    if (picked.length === 0) return
    const branding = await fetchInstitutionBranding(institutionId, activeMembership?.institution.name)
    const photoMap = await signStudentPhotosWithFallback(institutionId, [
      {
        key: activeStudent.id,
        photo_url: activeStudent.photo_url,
        registration_number: activeStudent.registration_number,
        admission_number: activeStudent.admission_number,
      },
    ])
    const photoSrc = photoMap.get(activeStudent.id) ?? null
    const feeTotal =
      mode === 'SUMMER'
        ? computeSummerFeeBreakdown(picked).total
        : computeOdeFeeBreakdown(
            picked.map((c) => ({ attemptNum: odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1) }))
          ).total

    const rowsHtml = picked
      .map((c, idx) => {
        const att = odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1)
        const ruleText = mode === 'SUMMER' ? c.summerRuleLabel : att === 1 ? 'Attempt 1 (₹6,000)' : 'Attempt 2+ (₹3,000)'
        return `<tr>
          <td style="text-align:center">${idx + 1}</td>
          <td style="font-family:monospace;font-weight:700">${escapeHtml(c.course_code)}</td>
          <td>${escapeHtml(c.course_title)}</td>
          <td>${escapeHtml(ruleText)}</td>
          <td style="text-align:center">Applied</td>
        </tr>`
      })
      .join('')

    openBrandedPrintWindow({
      title: `${activeStudent.registration_number}_${mode}_Application`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="border:1.5px solid #1e293b;padding:14px">
          ${renderBrandedHeaderHtml(
            branding,
            mode === 'SUMMER'
              ? `SUMMER SEMESTER APPLICATION FORM — ${activeSpecialCycle?.code ?? activeAcademicYear}`
              : `ON-DEMAND EXAMINATION (ODE) APPLICATION — ${activeSpecialCycle?.code ?? activeAcademicYear}`
          )}
          <table>
            <thead><tr><th>USN</th><th>Student Name</th><th>Branch / Sem</th><th style="width:95px;text-align:center">Photo</th></tr></thead>
            <tbody>
              <tr>
                <td style="font-family:monospace;font-weight:700">${escapeHtml(activeStudent.registration_number)}</td>
                <td><strong>${escapeHtml(activeStudent.full_name)}</strong></td>
                <td>${escapeHtml(activeStudent.program_code)} · Sem ${activeStudent.current_sem}</td>
                <td style="text-align:center">${photoSrc ? `<img src="${escapeHtml(photoSrc)}" style="width:66px;height:82px;object-fit:cover" alt="" />` : 'Photo Pending'}</td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead><tr><th style="width:36px">Sl.</th><th style="width:100px">Course Code</th><th>Course Title</th><th>Rule / Attempt</th><th style="width:76px;text-align:center">Status</th></tr></thead>
            <tbody>
              ${rowsHtml}
              <tr style="font-weight:700;background:#f8fafc"><td colspan="3" style="text-align:right">Total Payable</td><td colspan="2" style="text-align:center">₹${feeTotal.toLocaleString('en-IN')}${utrRef.trim() ? ` · UTR: ${escapeHtml(utrRef.trim().toUpperCase())}` : ''}</td></tr>
            </tbody>
          </table>
          <div class="signatures" style="margin-top:34px">
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Signature of Student</span></div>
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Department Coordinator / HOD</span></div>
          </div>
        </div>
      </section>`,
    })
  }

  const chosenFailed = failedCandidates.filter((c) => selectedFailedIds.includes(c.course_id))
  const summerRule1Credits = chosenFailed.filter((c) => c.summerRule === 'RULE_1').reduce((s, c) => s + c.credits, 0)
  const summerBreakdown = computeSummerFeeBreakdown(chosenFailed)
  const odeSummary = computeOdeFeeBreakdown(
    chosenFailed.map((c) => ({ attemptNum: odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1) }))
  )

  return (
    <div className="space-y-4">
      {/* Top Mode Switcher + Term Selector + Bulk CSV */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          {(
            [
              { id: 'TRACKER', label: 'COE Windows & Compliance', icon: CalendarClock },
              { id: 'SINGLE', label: 'Single Student Desk', icon: BookOpen },
              { id: 'SUMMER', label: 'Summer Rules 1–3', icon: Sun },
              { id: 'ODE', label: 'On-Demand (ODE)', icon: Zap },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id)
                setNotice(null)
                setErrorMsg(null)
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition',
                mode === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {(mode === 'TRACKER' || mode === 'SINGLE') && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={activeAcademicYear}
              onChange={(e) => setActiveAcademicTerm(e.target.value, activeTerm)}
              className="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
              placeholder="2026-27"
            />
            <select
              value={activeTerm}
              onChange={(e) => setActiveAcademicTerm(activeAcademicYear, e.target.value as 'ODD' | 'EVEN')}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
            >
              <option value="ODD">ODD Term</option>
              <option value="EVEN">EVEN Term</option>
            </select>
            {canManage && (
              <>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleBulkPhase1Csv(f)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Bulk CSV (usn, course_code)
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> {notice}
        </div>
      )}
      {(errorMsg || termRegsError) && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />{' '}
          {errorMsg || extractErrorMessage(termRegsError, 'Failed to read academic_course_registrations')}
        </div>
      )}

      {/* ===================================================================
          MODE 1: COE REGISTRATION WINDOWS + LIVE COMPLIANCE & BULK PRINT DESK
          =================================================================== */}
      {mode === 'TRACKER' && (
        <div className="space-y-4">
          {/* COE Triggered Course Registration Windows Panel */}
          <div className="rounded-lg border border-indigo-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4 text-indigo-600" />
                  COE-Triggered Course Registration Windows ({windows.filter((w) => w.status === 'OPEN').length} Open)
                </h3>
                <p className="text-xs text-slate-500">
                  Opening a window pins a <strong>High-Priority Course Registration Banner</strong> inside the Student
                  Portal for matching UG/PG, Scheme Year, and Semester students. Core courses auto-select; PE/OE appear
                  as dropdowns.
                </p>
              </div>
              {canTriggerWindows && (
                <button
                  type="button"
                  onClick={() => setShowWindowForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Trigger Registration Window
                </button>
              )}
            </div>

            {showWindowForm && canTriggerWindows && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3.5 space-y-3 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5">
                  <div className="md:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Window Title (Optional)</label>
                    <input
                      placeholder={`e.g. ${activeTerm} ${activeAcademicYear} UG Sem 3 Reg`}
                      value={winTitle}
                      onChange={(e) => setWinTitle(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Program Level</label>
                    <select
                      value={winLevel}
                      onChange={(e) => setWinLevel(e.target.value as 'UG' | 'PG' | 'ALL')}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    >
                      <option value="UG">UG</option>
                      <option value="PG">PG</option>
                      <option value="ALL">UG &amp; PG (ALL)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Scheme Year</label>
                    <input
                      type="number"
                      placeholder="All (or 25 / 26)"
                      value={winScheme}
                      onChange={(e) => setWinScheme(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Target Semesters *</label>
                    <input
                      value={winSems}
                      onChange={(e) => setWinSems(e.target.value)}
                      placeholder="1, 3, 5, 7"
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Closes On</label>
                    <input
                      type="date"
                      value={winClosesAt}
                      onChange={(e) => setWinClosesAt(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <input
                    value={winInstructions}
                    onChange={(e) => setWinInstructions(e.target.value)}
                    placeholder="Instructions shown to students..."
                    className="flex-1 min-w-[260px] rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  />
                  <button
                    type="button"
                    disabled={createWindowMutation.isPending}
                    onClick={() => createWindowMutation.mutate()}
                    className="rounded-md bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {createWindowMutation.isPending ? 'Opening...' : 'Open Window Now'}
                  </button>
                </div>
              </div>
            )}

            {windows.length === 0 ? (
              <p className="text-xs text-slate-500 bg-slate-50 rounded-md px-3 py-2">
                No Course Registration Windows triggered yet. COE / Admin can click <strong>Trigger Registration Window</strong> above to broadcast to Student Portals.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {windows.slice(0, 6).map((w) => (
                  <div
                    key={w.id}
                    className={cn(
                      'rounded-lg border p-3 flex items-center justify-between gap-3 text-xs',
                      w.status === 'OPEN' ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50/70'
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            w.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                          )}
                        >
                          {w.status}
                        </span>
                        <span className="font-bold text-slate-900 truncate">{w.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1">
                        AY {w.academic_year} ({w.term}) · {w.program_level} ·{' '}
                        {w.scheme_batch ? `${w.scheme_batch} Scheme` : 'All Schemes'} · Sem{' '}
                        {w.target_semesters.join(', ')}
                        {w.closes_at ? ` · Closes ${w.closes_at.slice(0, 10)}` : ''}
                      </p>
                    </div>
                    {canTriggerWindows && (
                      <button
                        type="button"
                        onClick={() =>
                          toggleWindowStatusMutation.mutate({
                            id: w.id,
                            nextStatus: w.status === 'OPEN' ? 'CLOSED' : 'OPEN',
                          })
                        }
                        className={cn(
                          'shrink-0 inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-semibold',
                          w.status === 'OPEN'
                            ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                            : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        )}
                      >
                        {w.status === 'OPEN' ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        {w.status === 'OPEN' ? 'Close' : 'Reopen'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Compliance Tracker + Bulk Print / Pure-Core Auto-Registration */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p className="text-[10px] font-bold uppercase text-slate-500">Cohort Active</p>
                <p className="text-xl font-extrabold text-slate-900">{trackerStats.total}</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Total Submitted</p>
                <p className="text-xl font-extrabold text-emerald-900">{trackerStats.submitted}</p>
              </div>
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-2.5">
                <p className="text-[10px] font-bold uppercase text-indigo-700">Via Student Portal</p>
                <p className="text-xl font-extrabold text-indigo-900">{trackerStats.byPortal}</p>
              </div>
              <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-2.5">
                <p className="text-[10px] font-bold uppercase text-sky-700">Via Front Office</p>
                <p className="text-xl font-extrabold text-sky-900">{trackerStats.byDesk}</p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50/70 p-2.5">
                <p className="text-[10px] font-bold uppercase text-red-700">Pending / Delayed</p>
                <p className="text-xl font-extrabold text-red-700">{trackerStats.pending}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterLevel}
                  onChange={(e) => setFilterLevel(e.target.value as 'ALL' | 'UG' | 'PG')}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="ALL">All Levels (UG &amp; PG)</option>
                  <option value="UG">UG Only</option>
                  <option value="PG">PG Only</option>
                </select>
                <select
                  value={filterBranch}
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium"
                >
                  <option value="ALL">All Branches ({branches.length})</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <select
                  value={filterSem}
                  onChange={(e) => setFilterSem(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium"
                >
                  <option value="ALL">All Semesters</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={String(s)}>Semester {s}</option>
                  ))}
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as 'ALL' | 'SUBMITTED' | 'PENDING')}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="SUBMITTED">Submitted ({trackerStats.submitted})</option>
                  <option value="PENDING">Pending / Delayed ({trackerStats.pending})</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canManage && trackerStats.pending > 0 && (
                  <button
                    type="button"
                    disabled={autoRegisterPureCoreMutation.isPending}
                    onClick={() => autoRegisterPureCoreMutation.mutate()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    <Users className="h-3.5 w-3.5" />
                    {autoRegisterPureCoreMutation.isPending
                      ? 'Auto-Registering...'
                      : `Auto-Register Pending Core (${trackerStats.pending})`}
                  </button>
                )}
                <button
                  type="button"
                  disabled={trackerStats.submitted === 0 || printingBulk}
                  onClick={handleBulkPrintSubmitted}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  <Printer className="h-3.5 w-3.5" />
                  {printingBulk
                    ? 'Preparing PDFs...'
                    : `Bulk Print Official Copies (${trackerStats.submitted})`}
                </button>
                <button
                  type="button"
                  disabled={trackerStats.pending === 0}
                  onClick={handleExportPendingCsv}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  Pending USNs CSV ({trackerStats.pending})
                </button>
              </div>
            </div>

            {/* Cohort Status Table */}
            <div className="overflow-x-auto max-h-96 border border-slate-200 rounded-md">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-2">USN &amp; Student</th>
                    <th className="px-3 py-2">Branch / Sem / Scheme</th>
                    <th className="px-3 py-2">Status &amp; Source</th>
                    <th className="px-3 py-2 text-center">Subjects / Credits</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingRegs ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading registrations...</td></tr>
                  ) : visibleTrackerRows.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No students match the selected filter.</td></tr>
                  ) : (
                    visibleTrackerRows.slice(0, 250).map((row) => (
                      <tr key={row.student.id} className={cn('hover:bg-slate-50', !row.submitted && 'bg-red-50/20')}>
                        <td className="px-3 py-2">
                          <span className="font-mono font-bold text-slate-900">{row.student.registration_number}</span>
                          <p className="text-slate-600">{row.student.full_name}</p>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <span className="font-semibold text-slate-800">{row.student.program_code}</span> · Sem{' '}
                          {row.student.current_sem}
                          {row.student.scheme_batch != null && (
                            <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                              {row.student.scheme_batch}S
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.submitted ? (
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-bold',
                                row.byStudent ? 'bg-indigo-100 text-indigo-800' : 'bg-emerald-100 text-emerald-800'
                              )}
                            >
                              {row.byStudent ? 'Student Portal Submitted' : 'Front Office Registered'}
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-[10px] font-bold">
                              PENDING
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center font-mono">
                          {row.submitted ? `${row.courses.length} subj · ${row.totalCredits} Cr` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {row.submitted && (
                              <button
                                type="button"
                                onClick={() =>
                                  printOfficialCourseRegistrationForms({
                                    institutionId,
                                    institutionName: activeMembership?.institution.name,
                                    academicYear: activeAcademicYear,
                                    term: activeTerm,
                                    items: [
                                      {
                                        student: row.student,
                                        courses: row.courses.map((c) => ({
                                          course_code: c.course_code,
                                          course_title: catalogById.get(c.course_id)?.title ?? c.course_code,
                                          credits: Number(c.credits || 0),
                                          course_type: c.course_type,
                                        })),
                                      },
                                    ],
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                              >
                                <Printer className="h-3 w-3" /> Print Copy
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setTargetId(row.student.registration_number)
                                setEditDeskOverride(!row.submitted)
                                setPickedPeId('')
                                setPickedOeId('')
                                setExtraManualIds([])
                                setMode('SINGLE')
                              }}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                            >
                              {row.submitted ? 'Inspect / Edit' : 'Register'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {visibleTrackerRows.length > 250 && (
                <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 text-center">
                  Showing first 250 of {visibleTrackerRows.length} students. Narrow by Branch/Semester or use Bulk Print / CSV above.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODE 2: SINGLE STUDENT DESK (Fetch Submitted Copy OR Core+PE/OE Register)
          =================================================================== */}
      {mode === 'SINGLE' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Enter Student USN or Admission Number
            </label>
            <input
              type="text"
              placeholder="e.g. 1AM25CS001"
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value.toUpperCase())
                setEditDeskOverride(false)
                setPickedPeId('')
                setPickedOeId('')
                setExtraManualIds([])
              }}
              className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
            />

            {activeStudent && (
              <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-900 flex flex-wrap items-center gap-3">
                <strong>{activeStudent.full_name}</strong>
                <span className="font-mono">{activeStudent.registration_number}</span>
                <span>{activeStudent.program_code} ({activeStudent.program_level})</span>
                <span>Sem {activeStudent.current_sem}</span>
                {activeStudent.scheme_batch != null && (
                  <span className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    {activeStudent.scheme_batch} Scheme
                  </span>
                )}
                <span>Category: {activeStudent.student_category}</span>
                {activeStudent.specialization_code !== 'GENERAL' && (
                  <span>Track: {activeStudent.specialization_code}</span>
                )}
              </div>
            )}
          </div>

          {activeStudent && singleCtx?.found && (
            singleCtx.has_submitted && !editDeskOverride ? (
              <div className="rounded-lg border border-emerald-200 bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />
                      Already Registered for {activeAcademicYear} {activeTerm} (Sem {activeStudent.current_sem})
                    </p>
                    <p className="text-xs text-slate-500">
                      Source: {singleCtx.submitted_by_student ? 'Submitted by Student via Student Portal' : 'Front Office Desk'}
                      {singleCtx.submitted_at ? ` · ${new Date(singleCtx.submitted_at).toLocaleString('en-IN')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        printOfficialCourseRegistrationForms({
                          institutionId,
                          institutionName: activeMembership?.institution.name,
                          academicYear: activeAcademicYear,
                          term: activeTerm,
                          items: [{ student: activeStudent, courses: singleCtx.submitted_courses }],
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <Printer className="h-3.5 w-3.5" /> Re-Download Official A4 PDF
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setEditDeskOverride(true)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Modify / Override
                      </button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-md text-xs">
                  {singleCtx.submitted_courses.map((c) => (
                    <div key={c.course_id} className="px-3 py-2 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-bold text-slate-900">{c.course_code}</span>
                        <span className="ml-2 text-slate-700">{c.course_title}</span>
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          {c.course_type}
                        </span>
                      </div>
                      <span className="font-mono text-slate-600">{c.credits} Cr</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      1. Auto-Selected Mandatory Courses ({singleCtx.curriculum?.code ?? 'Curriculum'})
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Core, Lab, Project, OMR, Online &amp; Non-Credit courses are auto-assigned by Scheme &amp; Semester.
                    </p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      disabled={saveSingleDeskMutation.isPending}
                      onClick={() => saveSingleDeskMutation.mutate()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {saveSingleDeskMutation.isPending ? 'Saving...' : 'Submit Registration & Enable PDF'}
                    </button>
                  )}
                </div>

                {singleCtx.mandatory_courses.length === 0 ? (
                  <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2.5">
                    No curriculum courses mapped yet for {activeStudent.program_code} Sem {activeStudent.current_sem} ({activeStudent.scheme_batch ?? ''} Scheme). Map courses in <strong>Academics → Curricula</strong> first.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                    {singleCtx.mandatory_courses.map((c) => (
                      <div key={c.course_id} className="px-3 py-2 flex items-center justify-between bg-emerald-50/30">
                        <div>
                          <span className="font-mono font-bold text-slate-900">{c.course_code}</span>
                          <span className="ml-2 text-slate-700">{c.course_title}</span>
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Auto · {c.course_type}
                          </span>
                        </div>
                        <span className="font-mono text-slate-600">{c.credits} Cr</span>
                      </div>
                    ))}
                  </div>
                )}

                {singleCtx.lateral_courses.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="font-bold text-indigo-900">Additional Lateral Entry Subjects (Auto-Assigned)</h4>
                    <div className="divide-y divide-slate-100 border border-indigo-200 rounded-md">
                      {singleCtx.lateral_courses.map((c) => (
                        <div key={c.course_id} className="px-3 py-2 flex items-center justify-between bg-indigo-50/40">
                          <span>
                            <strong className="font-mono">{c.course_code}</strong> — {c.course_title}
                          </span>
                          <span className="font-mono text-slate-600">{c.credits} Cr</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(singleCtx.pe_courses.length > 0 || singleCtx.oe_courses.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {singleCtx.pe_courses.length > 0 && (
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">2A. Professional Elective (PE)</label>
                        <select
                          value={pickedPeId}
                          onChange={(e) => setPickedPeId(e.target.value)}
                          className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                        >
                          <option value="">-- Select Approved PE --</option>
                          {singleCtx.pe_courses.map((p) => (
                            <option key={p.course_id} value={p.course_id}>
                              {p.course_code} — {p.course_title} ({p.credits} Cr)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {singleCtx.oe_courses.length > 0 && (
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">2B. Open Elective (OE)</label>
                        <select
                          value={pickedOeId}
                          onChange={(e) => setPickedOeId(e.target.value)}
                          className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                        >
                          <option value="">-- Select Approved OE --</option>
                          {singleCtx.oe_courses.map((o) => (
                            <option key={o.course_id} value={o.course_id}>
                              {o.course_code} [{o.branch_code}] — {o.course_title} ({o.credits} Cr)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* ===================================================================
          MODES 3 & 4: SUMMER RULES 1-3 & ON-DEMAND (ODE)
          =================================================================== */}
      {(mode === 'SUMMER' || mode === 'ODE') && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Enter Student USN for {mode} Registration
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1AM25EC008"
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value.toUpperCase())
                    setSelectedFailedIds([])
                  }}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label className="font-semibold text-slate-600">Target {mode} Cycle:</label>
                <select
                  value={activeSpecialCycle?.id ?? ''}
                  onChange={(e) => setSelectedSpecialCycleId(e.target.value)}
                  className="rounded-md border border-indigo-300 bg-indigo-50/40 px-2.5 py-1.5 font-semibold text-indigo-950 max-w-xs"
                >
                  <option value="">Select cycle...</option>
                  {examCycles.map((ec) => (
                    <option key={ec.id} value={ec.id}>
                      {ec.code} ({ec.cycle_type}) — {ec.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {activeStudent && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {activeStudent.full_name} ({activeStudent.registration_number}) — Eligible Unpassed Courses (Latest Attempts)
                  </h3>
                  <p className="text-xs text-slate-500">
                    {mode === 'SUMMER'
                      ? 'Base ₹400 · Rule 1 (CIE Fail) ₹5,600 · Rule 2 (AB) ₹2,000 / ₹1,000 · Rule 3 (SEE Fail) ₹600'
                      : 'Attempt 1: ₹6,000/subj · Attempt 2+: ₹3,000/subj · + ₹100 App Fee + ₹600 Grade Card Fee'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={chosenFailed.length === 0}
                  onClick={printSpecialCycleForm}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Printer className="h-3.5 w-3.5" /> Print Form
                </button>
              </div>

              {failedCandidates.length === 0 ? (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
                  Zero active backlogs based on canonical latest attempts for <strong>{activeStudent.registration_number}</strong>.
                </p>
              ) : (
                <>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                    {failedCandidates.map((c) => {
                      const defaultAttempt = c.priorOdeAttempts >= 1 ? 2 : 1
                      const pickedAttempt = odeAttemptChoice[c.course_id] ?? defaultAttempt
                      return (
                        <div key={c.course_id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-xs">
                          <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-[220px]">
                            <input
                              type="checkbox"
                              checked={selectedFailedIds.includes(c.course_id)}
                              onChange={() =>
                                setSelectedFailedIds((prev) =>
                                  prev.includes(c.course_id) ? prev.filter((x) => x !== c.course_id) : [...prev, c.course_id]
                                )
                              }
                              className="rounded border-slate-300 text-indigo-600"
                            />
                            <span className="font-mono font-semibold text-slate-900">{c.course_code}</span>
                            <span className="text-slate-700">{c.course_title}</span>
                            <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                              {c.grade_code} · CIE {c.cie_marks} · {c.credits} Cr
                            </span>
                          </label>
                          {mode === 'SUMMER' ? (
                            <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                              {c.summerRuleLabel}
                            </span>
                          ) : (
                            <select
                              value={pickedAttempt}
                              onChange={(e) =>
                                setOdeAttemptChoice((prev) => ({ ...prev, [c.course_id]: Number(e.target.value) }))
                              }
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value={1}>Attempt 1 (₹6,000)</option>
                              <option value={2}>Attempt 2+ (₹3,000)</option>
                            </select>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {mode === 'SUMMER' && (
                    <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          Rule 1 Credits: <strong>{summerRule1Credits} / {allowCreditOverride && canApproveCreditOverride ? 15 : 14}</strong>
                        </span>
                        <span className="text-sm font-bold text-indigo-700">
                          Total Payable: ₹{summerBreakdown.total.toLocaleString('en-IN')}
                        </span>
                      </div>
                      {canApproveCreditOverride && (
                        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-200">
                          <label className="inline-flex items-center gap-1.5 font-medium text-amber-900">
                            <input
                              type="checkbox"
                              checked={allowCreditOverride}
                              onChange={(e) => setAllowCreditOverride(e.target.checked)}
                              className="rounded border-amber-400 text-amber-600"
                            />
                            <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                            Principal / HOD Override: Allow 15 Credits
                          </label>
                          {allowCreditOverride && (
                            <input
                              type="text"
                              placeholder="Approval note..."
                              value={overrideReason}
                              onChange={(e) => setOverrideReason(e.target.value)}
                              className="flex-1 min-w-[180px] rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {mode === 'ODE' && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="rounded bg-slate-50 border border-slate-200 p-2.5">
                        <p className="text-slate-500">Attempt 1 ({odeSummary.att1Count} × ₹6,000)</p>
                        <p className="text-base font-bold text-slate-900">₹{(odeSummary.att1Count * 6000).toLocaleString('en-IN')}</p>
                      </div>
                      <div className="rounded bg-slate-50 border border-slate-200 p-2.5">
                        <p className="text-slate-500">Attempt 2+ ({odeSummary.att2Count} × ₹3,000)</p>
                        <p className="text-base font-bold text-slate-900">₹{(odeSummary.att2Count * 3000).toLocaleString('en-IN')}</p>
                      </div>
                      <div className="rounded bg-slate-50 border border-slate-200 p-2.5">
                        <p className="text-slate-500">App (₹100) + Grade Card (₹600)</p>
                        <p className="text-base font-bold text-slate-900">₹{chosenFailed.length > 0 ? '700' : '0'}</p>
                      </div>
                      <div className="rounded bg-indigo-50 border border-indigo-200 p-2.5">
                        <p className="text-indigo-700 font-medium">Total ODE Payable</p>
                        <p className="text-base font-bold text-indigo-900">₹{odeSummary.total.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <input
                      type="text"
                      placeholder="Optional UTR / Payment Reference"
                      value={utrRef}
                      onChange={(e) => setUtrRef(e.target.value.toUpperCase())}
                      className="flex-1 min-w-[220px] rounded-md border border-slate-300 px-3 py-1.5 text-xs font-mono uppercase"
                    />
                    {canManage && (
                      <button
                        type="button"
                        disabled={saveSpecialCycleMutation.isPending || chosenFailed.length === 0 || !activeSpecialCycle}
                        onClick={() => saveSpecialCycleMutation.mutate()}
                        className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {saveSpecialCycleMutation.isPending ? 'Submitting...' : `Submit ${mode} Application to COE`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
