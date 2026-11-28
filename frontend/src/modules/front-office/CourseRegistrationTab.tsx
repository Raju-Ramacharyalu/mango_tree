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
  Sparkles,
  Check,
  XCircle,
  Users,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
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
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  students: StudentFrontOfficeRecord[]
  canManage: boolean
  canApproveCreditOverride: boolean
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

interface SchemeCurriculumCourse {
  course_id: string
  is_elective: boolean
  credits: number
  scheme_batch: number | null
  curriculum_code: string
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
    if (item.summerRule === 'RULE_1') {
      perItemFees.push(5600)
    } else if (item.summerRule === 'RULE_2') {
      rule2Count += 1
      perItemFees.push(rule2Count === 1 ? 2000 : 1000)
    } else {
      perItemFees.push(600)
    }
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
  return {
    att1Count,
    att2Count,
    appFee,
    gradeCardFee,
    subjectFeeTotal,
    total: appFee + gradeCardFee + subjectFeeTotal,
  }
}

export function CourseRegistrationTab({
  institutionId,
  cycle,
  students,
  canManage,
  canApproveCreditOverride,
}: Props) {
  const queryClient = useQueryClient()
  const { session, activeAcademicYear, activeTerm, setActiveAcademicTerm } = useAppStore()
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const [mode, setMode] = useState<'PHASE1' | 'SUMMER' | 'ODE'>('PHASE1')
  const [targetId, setTargetId] = useState('')
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([])
  const [courseSearch, setCourseSearch] = useState('')
  const [showOutOfSchemeCatalog, setShowOutOfSchemeCatalog] = useState(false)
  const [minCreditsCap, setMinCreditsCap] = useState('12')
  const [maxCreditsCap, setMaxCreditsCap] = useState('28')
  const [allowPhase1Override, setAllowPhase1Override] = useState(false)
  const [showBulkCore, setShowBulkCore] = useState(false)
  const [bulkCoreBranch, setBulkCoreBranch] = useState('')
  const [bulkCoreSem, setBulkCoreSem] = useState('3')

  // Inline target Exam Cycle for Summer / ODE (independent of global sidebar)
  const [selectedSpecialCycleId, setSelectedSpecialCycleId] = useState<string>(cycle?.id ?? '')
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

  const { data: examCycles = [] } = useQuery<ExamCycle[]>({
    queryKey: ['exam_cycles', institutionId],
    enabled: Boolean(institutionId),
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

  // Auto-select matching SUMMER or ODE cycle when switching mode
  useEffect(() => {
    if (mode === 'PHASE1' || examCycles.length === 0) return
    const currentValid = examCycles.find((c) => c.id === selectedSpecialCycleId && c.cycle_type === mode)
    if (currentValid) return
    const preferred =
      examCycles.find((c) => c.cycle_type === mode && c.status !== 'ARCHIVED' && c.status !== 'COMPLETED') ??
      examCycles.find((c) => c.cycle_type === mode) ??
      cycle ??
      examCycles[0]
    if (preferred) setSelectedSpecialCycleId(preferred.id)
  }, [mode, examCycles, selectedSpecialCycleId, cycle])

  const activeSpecialCycle = useMemo(() => {
    return examCycles.find((c) => c.id === selectedSpecialCycleId) ?? cycle ?? null
  }, [examCycles, selectedSpecialCycleId, cycle])

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
          row.course_categories as
            | { code: string; is_online: boolean }
            | { code: string; is_online: boolean }[]
            | null
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

  // Resolve student's matched Scheme Curriculum courses (e.g. 26 Scheme for 1st Sem vs 25 Scheme for 3rd Sem)
  const { data: schemeCurriculum = [] } = useQuery<SchemeCurriculumCourse[]>({
    queryKey: [
      'student_scheme_curriculum',
      institutionId,
      activeStudent?.program_id,
      activeStudent?.current_period_id,
      activeStudent?.scheme_batch,
    ],
    enabled: Boolean(activeStudent?.program_id && activeStudent?.current_period_id),
    queryFn: async () => {
      const { data: curRows, error: cErr } = await supabase
        .from('curricula')
        .select('id, code, scheme_batch, version_number')
        .eq('institution_id', institutionId)
        .eq('program_id', activeStudent!.program_id!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('scheme_batch', { ascending: false })
        .order('version_number', { ascending: false })
      if (cErr) throw cErr
      if (!curRows || curRows.length === 0) return []

      const studentScheme = activeStudent!.scheme_batch
      const matched =
        (studentScheme !== null
          ? curRows.find((c) => Number(c.scheme_batch) === Number(studentScheme))
          : null) ?? curRows[0]

      const { data: ccRows, error: ccErr } = await supabase
        .from('curriculum_courses')
        .select('course_id, is_elective, credits')
        .eq('curriculum_id', matched.id)
        .eq('academic_period_id', activeStudent!.current_period_id!)
        .eq('is_active', true)
      if (ccErr) throw ccErr

      return (ccRows ?? []).map((r) => ({
        course_id: r.course_id as string,
        is_elective: Boolean(r.is_elective),
        credits: Number(r.credits ?? 3),
        scheme_batch: matched.scheme_batch !== null ? Number(matched.scheme_batch) : null,
        curriculum_code: matched.code as string,
      }))
    },
  })

  // Existing Phase 1 registrations for this student in activeAcademicYear + activeTerm
  const { data: existingPhase1CourseIds = [] } = useQuery<string[]>({
    queryKey: ['existing_phase1_regs', institutionId, activeAcademicYear, activeTerm, activeStudent?.id],
    enabled: Boolean(activeStudent?.id && mode === 'PHASE1'),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_course_registrations')
        .select('course_id')
        .eq('institution_id', institutionId)
        .eq('academic_year', activeAcademicYear)
        .eq('term', activeTerm)
        .eq('student_id', activeStudent!.id)
      if (error) throw error
      return (data ?? []).map((r) => r.course_id as string)
    },
  })

  // Canonical Latest-Attempt Status (Item #5 & #10): exact backlogs & already-passed course blocking
  const { data: latestAttempts = [] } = useQuery<LatestAttemptCourseRow[]>({
    queryKey: ['student_latest_course_status', institutionId, activeStudent?.id],
    enabled: Boolean(activeStudent?.id),
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

  // Auto-load student's already-registered Phase 1 courses into checkboxes when looking them up
  useEffect(() => {
    if (mode !== 'PHASE1' || !activeStudent) return
    if (existingPhase1CourseIds.length > 0) {
      setSelectedCourseIds(existingPhase1CourseIds)
    }
  }, [mode, activeStudent?.id, existingPhase1CourseIds])

  const passedCourseIds = useMemo(() => {
    const set = new Set<string>()
    for (const r of latestAttempts) {
      if (r.result_status === 'PASS' || r.result_status === 'EXEMPT') set.add(r.course_id)
    }
    return set
  }, [latestAttempts])

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

  const schemeCourseMap = useMemo(() => {
    const map = new Map<string, SchemeCurriculumCourse>()
    for (const sc of schemeCurriculum) map.set(sc.course_id, sc)
    return map
  }, [schemeCurriculum])

  const existingPhase1Set = useMemo(() => new Set(existingPhase1CourseIds), [existingPhase1CourseIds])

  const parityMismatch =
    Boolean(activeStudent) &&
    mode === 'PHASE1' &&
    ((activeStudent!.current_sem % 2 !== 0) !== (activeTerm === 'ODD'))

  const selectedPhase1Courses = useMemo(
    () => catalogCourses.filter((c) => selectedCourseIds.includes(c.id)),
    [catalogCourses, selectedCourseIds]
  )

  const phase1Credits = useMemo(
    () =>
      selectedPhase1Courses.reduce((sum, c) => {
        const sc = schemeCourseMap.get(c.id)
        return sum + (sc ? sc.credits : c.default_credits)
      }, 0),
    [selectedPhase1Courses, schemeCourseMap]
  )

  // Live 5-Rule Phase 1 Validation Engine
  const phase1Validation = useMemo(() => {
    const minC = Math.max(0, Number(minCreditsCap) || 0)
    const maxC = Math.max(1, Number(maxCreditsCap) || 28)
    const alreadyPassedPicked = selectedPhase1Courses.filter((c) => passedCourseIds.has(c.id))
    const outOfSchemePicked =
      schemeCurriculum.length > 0
        ? selectedPhase1Courses.filter((c) => !schemeCourseMap.has(c.id))
        : []
    const underMin = selectedPhase1Courses.length > 0 && phase1Credits < minC
    const overMax = phase1Credits > maxC
    const hardErrors: string[] = []
    if (parityMismatch) {
      hardErrors.push(`Term Parity: Active term is ${activeTerm}, but student is in Semester ${activeStudent?.current_sem}.`)
    }
    if (alreadyPassedPicked.length > 0) {
      hardErrors.push(
        `Already Cleared (Latest Attempt PASS): ${alreadyPassedPicked.map((c) => c.course_code).join(', ')}.`
      )
    }
    if (overMax && !(allowPhase1Override && canApproveCreditOverride)) {
      hardErrors.push(`Credit Cap Exceeded: ${phase1Credits} credits selected (Max ${maxC}).`)
    }
    const warnings: string[] = []
    if (underMin) warnings.push(`Below typical minimum credits (${phase1Credits} < ${minC}).`)
    if (outOfSchemePicked.length > 0) {
      warnings.push(
        `Out-of-Scheme courses selected (${outOfSchemePicked.map((c) => c.course_code).join(', ')}) — verify against ${activeStudent?.scheme_batch ?? 'active'} Scheme.`
      )
    }
    return {
      minC,
      maxC,
      alreadyPassedPicked,
      outOfSchemePicked,
      underMin,
      overMax,
      hardErrors,
      warnings,
      canSubmit: selectedPhase1Courses.length > 0 && hardErrors.length === 0,
    }
  }, [
    minCreditsCap,
    maxCreditsCap,
    selectedPhase1Courses,
    passedCourseIds,
    schemeCurriculum.length,
    schemeCourseMap,
    phase1Credits,
    parityMismatch,
    activeTerm,
    activeStudent,
    allowPhase1Override,
    canApproveCreditOverride,
  ])

  const visiblePhase1Courses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase()
    const base =
      schemeCurriculum.length > 0 && !showOutOfSchemeCatalog
        ? catalogCourses.filter((c) => schemeCourseMap.has(c.id) || selectedCourseIds.includes(c.id))
        : catalogCourses
    return base
      .filter((c) => !q || c.course_code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const aIn = schemeCourseMap.has(a.id) ? 0 : 1
        const bIn = schemeCourseMap.has(b.id) ? 0 : 1
        if (aIn !== bIn) return aIn - bIn
        return a.course_code.localeCompare(b.course_code)
      })
  }, [catalogCourses, schemeCurriculum.length, showOutOfSchemeCatalog, schemeCourseMap, selectedCourseIds, courseSearch])

  const toggleCourse = (id: string) => {
    setSelectedCourseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const autoSelectSchemeCore = () => {
    const coreIds = schemeCurriculum
      .filter((sc) => !sc.is_elective && !passedCourseIds.has(sc.course_id))
      .map((sc) => sc.course_id)
    setSelectedCourseIds(Array.from(new Set([...existingPhase1CourseIds, ...coreIds])))
  }

  const bulkCoreBranches = useMemo(
    () => Array.from(new Set(students.map((s) => s.program_code).filter(Boolean))).sort(),
    [students]
  )

  const bulkCoreCohortMutation = useMutation({
    mutationFn: async () => {
      const targetSem = Number(bulkCoreSem)
      if (!bulkCoreBranch || Number.isNaN(targetSem)) {
        throw new Error('Select a Branch and Semester.')
      }
      if ((targetSem % 2 !== 0) !== (activeTerm === 'ODD')) {
        throw new Error(`Term parity mismatch: Active term is ${activeTerm}, cannot bulk-register Sem ${targetSem}.`)
      }
      const cohortStudents = students.filter(
        (s) => s.program_code === bulkCoreBranch && s.current_sem === targetSem && s.program_id && s.current_period_id
      )
      if (cohortStudents.length === 0) {
        throw new Error(`No active students found in ${bulkCoreBranch} Semester ${targetSem}.`)
      }
      const programId = cohortStudents[0].program_id!
      const periodId = cohortStudents[0].current_period_id!
      const sampleScheme = cohortStudents.find((s) => s.scheme_batch != null)?.scheme_batch ?? null

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
      if (!matched) throw new Error(`No active curriculum found for ${bulkCoreBranch}. Configure it in Academics → Curricula first.`)

      const { data: ccRows, error: ccErr } = await supabase
        .from('curriculum_courses')
        .select('course_id, credits, is_elective')
        .eq('curriculum_id', matched.id)
        .eq('academic_period_id', periodId)
        .eq('is_active', true)
        .eq('is_elective', false)
      if (ccErr) throw ccErr
      if (!ccRows || ccRows.length === 0) {
        throw new Error(`No mandatory Core courses mapped in curriculum for ${bulkCoreBranch} Sem ${targetSem}.`)
      }

      const catalogById = new Map(catalogCourses.map((c) => [c.id, c]))
      const rows = cohortStudents.flatMap((stu) =>
        ccRows
          .map((cc) => {
            const cat = catalogById.get(cc.course_id as string)
            if (!cat) return null
            return {
              institution_id: institutionId,
              academic_year: activeAcademicYear.trim(),
              term: activeTerm,
              student_id: stu.id,
              program_id: stu.program_id!,
              academic_period_id: stu.current_period_id,
              semester_number: targetSem,
              course_id: cat.id,
              course_code: cat.course_code,
              course_type: cat.is_online ? 'ONLINE' : (cat.category_code ?? 'CORE'),
              credits: Number(cc.credits ?? cat.default_credits),
              registration_source: 'MANUAL',
              status: 'ACTIVE',
              created_by: session?.user.id ?? null,
              updated_by: session?.user.id ?? null,
            }
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
      )

      const dedupedMap = new Map<string, (typeof rows)[number]>()
      for (const r of rows) {
        dedupedMap.set(`${r.student_id}::${r.course_id}`, r)
      }
      const uniqueRows = Array.from(dedupedMap.values())

      const chunkSize = 400
      for (let i = 0; i < uniqueRows.length; i += chunkSize) {
        const { error } = await supabase
          .from('academic_course_registrations')
          .upsert(uniqueRows.slice(i, i + chunkSize), {
            onConflict: 'institution_id,academic_year,term,student_id,course_id',
          })
        if (error) throw error
      }
      return { studentsCount: cohortStudents.length, coreCount: ccRows.length, totalRows: uniqueRows.length }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setShowBulkCore(false)
      setNotice(
        `Bulk Core Registration complete: ${res.studentsCount} students in ${bulkCoreBranch} Sem ${bulkCoreSem} registered for ${res.coreCount} Core courses (${res.totalRows} rows saved to ${activeAcademicYear} ${activeTerm}).`
      )
    },
    onError: (err) => setErrorMsg(extractErrorMessage(err, 'Bulk Core registration failed')),
  })

  const savePhase1Mutation = useMutation({
    mutationFn: async () => {
      if (!activeStudent || !activeStudent.program_id) {
        throw new Error('Select a valid student with an active program enrollment.')
      }
      if (phase1Validation.hardErrors.length > 0) {
        throw new Error(phase1Validation.hardErrors[0])
      }
      if (selectedPhase1Courses.length === 0) throw new Error('Select at least one course.')

      const payload = selectedPhase1Courses.map((c) => {
        const sc = schemeCourseMap.get(c.id)
        return {
          institution_id: institutionId,
          academic_year: activeAcademicYear.trim(),
          term: activeTerm,
          student_id: activeStudent.id,
          program_id: activeStudent.program_id!,
          academic_period_id: activeStudent.current_period_id,
          semester_number: activeStudent.current_sem,
          course_id: c.id,
          course_code: c.course_code,
          course_type: c.is_online ? 'ONLINE' : (c.category_code ?? 'CORE'),
          credits: sc ? sc.credits : c.default_credits,
          registration_source: 'MANUAL',
          status: 'ACTIVE',
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        }
      })

      const { error } = await supabase
        .from('academic_course_registrations')
        .upsert(payload, { onConflict: 'institution_id,academic_year,term,student_id,course_id' })
      if (error) throw error
      return selectedPhase1Courses
    },
    onSuccess: (courses) => {
      setErrorMsg(null)
      setNotice(
        `Registered ${activeStudent?.registration_number} for ${courses.length} Phase 1 courses (${activeAcademicYear} ${activeTerm} · ${phase1Credits} credits).`
      )
      queryClient.invalidateQueries({
        queryKey: ['existing_phase1_regs', institutionId, activeAcademicYear, activeTerm, activeStudent?.id],
      })
    },
    onError: (err) => {
      setNotice(null)
      setErrorMsg(extractErrorMessage(err, 'Phase 1 registration failed'))
    },
  })

  const handleBulkPhase1Csv = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        try {
          const courseByCode = new Map(catalogCourses.map((c) => [c.course_code.trim().toUpperCase(), c]))
          const rows: Array<Record<string, unknown>> = []
          let skipped = 0
          let paritySkipped = 0

          for (const rec of parsed.data) {
            const usn = (rec.usn || rec.USN || rec.Registration_Number || '').trim().toUpperCase()
            const code = (rec.course_code || rec.Course_Code || rec.COURSE_CODE || '').trim().toUpperCase()
            const stu = studentByLookup.get(usn)
            const crs = courseByCode.get(code)
            if (!stu || !stu.program_id || !crs) {
              skipped += 1
              continue
            }
            if ((stu.current_sem % 2 !== 0) !== (activeTerm === 'ODD')) {
              paritySkipped += 1
              continue
            }
            rows.push({
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
              created_by: session?.user.id ?? null,
              updated_by: session?.user.id ?? null,
            })
          }

          const chunkSize = 400
          for (let i = 0; i < rows.length; i += chunkSize) {
            const { error } = await supabase
              .from('academic_course_registrations')
              .upsert(rows.slice(i, i + chunkSize), {
                onConflict: 'institution_id,academic_year,term,student_id,course_id',
              })
            if (error) throw error
          }
          setErrorMsg(null)
          setNotice(
            `Bulk CSV sync complete: ${rows.length} course rows saved` +
              (skipped ? ` · ${skipped} unmatched skipped` : '') +
              (paritySkipped ? ` · ${paritySkipped} term-parity mismatch skipped` : '') +
              '.'
          )
        } catch (err) {
          setErrorMsg(extractErrorMessage(err, 'Bulk CSV import failed'))
        }
      },
    })
  }

  const saveSpecialCycleMutation = useMutation({
    mutationFn: async () => {
      if (!activeSpecialCycle) throw new Error('Select a Target Exam Cycle for this Summer / ODE application.')
      if (!activeStudent || !activeStudent.program_id) throw new Error('Select a valid student first.')

      const chosen = failedCandidates.filter((c) => selectedCourseIds.includes(c.course_id))
      if (chosen.length === 0) throw new Error('Select at least one eligible failed course.')

      let appFee = 0
      let gradeCardFee = 0
      let subjectFeeTotal = 0
      let totalFee = 0
      let perCourseFees: number[] = []

      if (mode === 'SUMMER') {
        const rule1Credits = chosen
          .filter((c) => c.summerRule === 'RULE_1')
          .reduce((sum, c) => sum + c.credits, 0)
        const maxCredits = allowCreditOverride && canApproveCreditOverride ? 15 : 14
        if (rule1Credits > maxCredits) {
          throw new Error(
            `Rule 1 credit cap exceeded (${rule1Credits} credits selected; max ${maxCredits}).${
              !canApproveCreditOverride ? ' Principal / HOD approval required for 15-credit override.' : ''
            }`
          )
        }
        const sumBreakdown = computeSummerFeeBreakdown(chosen)
        appFee = sumBreakdown.baseFee
        gradeCardFee = 0
        subjectFeeTotal = sumBreakdown.subjectFeeTotal
        totalFee = sumBreakdown.total
        perCourseFees = sumBreakdown.perItemFees
      } else {
        const odeItems = chosen.map((c) => ({
          attemptNum: odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1),
        }))
        const odeBreak = computeOdeFeeBreakdown(odeItems)
        appFee = odeBreak.appFee
        gradeCardFee = odeBreak.gradeCardFee
        subjectFeeTotal = odeBreak.subjectFeeTotal
        totalFee = odeBreak.total
        perCourseFees = odeItems.map((i) => (i.attemptNum <= 1 ? 6000 : 3000))
      }

      // NOTE: total_fee is a PostgreSQL generated column (application_fee + grade_card_fee + subject_fee_total + late_fee)
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
              mode === 'SUMMER' && allowCreditOverride && canApproveCreditOverride
                ? (session?.user.id ?? null)
                : null,
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
        const att =
          mode === 'ODE'
            ? (odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1))
            : 1
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
            mode === 'SUMMER'
              ? c.summerRuleLabel
              : att === 1
                ? 'Attempt 1 (Rs 6000)'
                : 'Attempt 2+ (Rs 3000)',
          is_online_exempt: false,
          subject_fee: perCourseFees[idx] ?? 0,
          eligibility_status: 'ELIGIBLE',
          updated_by: session?.user.id ?? null,
        }
      })

      const { error: delErr } = await supabase
        .from('exam_registration_courses')
        .delete()
        .eq('registration_id', regRow.id)
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
      queryClient.invalidateQueries({ queryKey: ['exam_cycle_stats', institutionId, activeSpecialCycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_registrations', institutionId, activeSpecialCycle?.id] })
    },
    onError: (err) => {
      setNotice(null)
      setErrorMsg(extractErrorMessage(err, 'Failed to submit special cycle registration'))
    },
  })

  const printApplicationForm = async () => {
    if (!activeStudent) return
    const branding = await fetchInstitutionBranding(institutionId)
    const photoMap = await signStudentPhotosWithFallback(institutionId, [
      {
        key: activeStudent.id,
        photo_url: activeStudent.photo_url,
        registration_number: activeStudent.registration_number,
        admission_number: activeStudent.admission_number,
      },
    ])
    const photoSrc = photoMap.get(activeStudent.id) ?? null

    const badge =
      mode === 'PHASE1'
        ? `COURSE REGISTRATION FORM — ${activeTerm} SEMESTER ${activeAcademicYear}`
        : mode === 'SUMMER'
          ? `SUMMER SEMESTER APPLICATION FORM — ${activeSpecialCycle?.code ?? activeAcademicYear}`
          : `ON-DEMAND EXAMINATION (ODE) APPLICATION — ${activeSpecialCycle?.code ?? activeAcademicYear}`

    const photoCell = photoSrc
      ? `<img src="${escapeHtml(photoSrc)}" style="width:76px;height:94px;object-fit:cover;border:1px solid #475569" alt="Photo" />`
      : `<div style="border:1px dashed #64748b;padding:8px;font-size:9px;text-align:center;color:#475569">
           <strong>Photo Pending</strong><br/>
           Upload at Photo Booth<br/>
           ID: <strong>${escapeHtml(activeStudent.registration_number)}</strong><br/>
           PIN: <strong>${escapeHtml(activeStudent.photo_pin ?? 'Ask Office')}</strong><br/>
           <em>or Affix Physical Photo</em>
         </div>`

    let rowsHtml = ''
    let footerSummary = ''
    if (mode === 'PHASE1') {
      const picked = selectedPhase1Courses
      rowsHtml = picked
        .map((c, idx) => {
          const cr = schemeCourseMap.get(c.id)?.credits ?? c.default_credits
          return `<tr>
            <td style="text-align:center">${idx + 1}</td>
            <td style="font-family:monospace;font-weight:700">${escapeHtml(c.course_code)}</td>
            <td>${escapeHtml(c.title)}${c.is_online ? ' (ONLINE · CIE/SEE Exempt)' : ''}</td>
            <td style="text-align:center">${cr}</td>
            <td style="text-align:center">Registered</td>
          </tr>`
        })
        .join('')
      footerSummary = `<tr style="font-weight:700;background:#f8fafc"><td colspan="3" style="text-align:right">Total Credits</td><td style="text-align:center">${phase1Credits}</td><td></td></tr>`
    } else {
      const picked = failedCandidates.filter((c) => selectedCourseIds.includes(c.course_id))
      const feeTotal =
        mode === 'SUMMER'
          ? computeSummerFeeBreakdown(picked).total
          : computeOdeFeeBreakdown(
              picked.map((c) => ({
                attemptNum: odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1),
              }))
            ).total
      rowsHtml = picked
        .map((c, idx) => {
          const att = odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1)
          const ruleText =
            mode === 'SUMMER' ? c.summerRuleLabel : att === 1 ? 'Attempt 1 (₹6,000)' : 'Attempt 2+ (₹3,000)'
          return `<tr>
            <td style="text-align:center">${idx + 1}</td>
            <td style="font-family:monospace;font-weight:700">${escapeHtml(c.course_code)}</td>
            <td>${escapeHtml(c.course_title)}</td>
            <td>${escapeHtml(ruleText)}</td>
            <td style="text-align:center">Applied</td>
          </tr>`
        })
        .join('')
      footerSummary = `<tr style="font-weight:700;background:#f8fafc"><td colspan="3" style="text-align:right">Total Payable (incl. Base/App/Grade Card)</td><td colspan="2" style="text-align:center">₹${feeTotal.toLocaleString('en-IN')} ${utrRef.trim() ? `· UTR: ${escapeHtml(utrRef.trim().toUpperCase())}` : ''}</td></tr>`
    }

    openBrandedPrintWindow({
      title: `${activeStudent.registration_number}_${mode}_Application`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="border:1.5px solid #1e293b;padding:14px">
          ${renderBrandedHeaderHtml(branding, badge)}
          <table>
            <thead>
              <tr><th>USN / Admin No.</th><th>Student Name</th><th>Branch / Scheme</th><th>Sem</th><th style="width:110px;text-align:center">Photo</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-family:monospace;font-weight:700">${escapeHtml(activeStudent.registration_number)}</td>
                <td><strong>${escapeHtml(activeStudent.full_name)}</strong></td>
                <td>${escapeHtml(activeStudent.program_code)}${activeStudent.scheme_batch ? ` · ${activeStudent.scheme_batch} Scheme` : ''}${activeStudent.specialization_code !== 'GENERAL' ? ` (${escapeHtml(activeStudent.specialization_code)})` : ''}</td>
                <td style="text-align:center">${activeStudent.current_sem}</td>
                <td style="text-align:center">${photoCell}</td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr><th style="width:36px">Sl.</th><th style="width:100px">Course Code</th><th>Course Title</th><th>${mode === 'PHASE1' ? 'Credits' : 'Rule / Attempt'}</th><th style="width:76px;text-align:center">Status</th></tr>
            </thead>
            <tbody>${rowsHtml}${footerSummary}</tbody>
          </table>
          <p style="font-size:10px;color:#334155"><strong>Declaration:</strong> I hereby declare that the courses selected above are accurate and I will abide by institutional autonomy regulations.</p>
          <div class="signatures">
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Signature of Student</span></div>
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Department Coordinator / HOD</span></div>
          </div>
        </div>
      </section>`,
    })
  }

  const chosenFailed = failedCandidates.filter((c) => selectedCourseIds.includes(c.course_id))
  const summerRule1Credits = chosenFailed
    .filter((c) => c.summerRule === 'RULE_1')
    .reduce((sum, c) => sum + c.credits, 0)
  const summerBreakdown = computeSummerFeeBreakdown(chosenFailed)
  const odeSummary = computeOdeFeeBreakdown(
    chosenFailed.map((c) => ({
      attemptNum: odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1),
    }))
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          {(
            [
              { id: 'PHASE1', label: 'Phase 1: Regular Courses', icon: BookOpen },
              { id: 'SUMMER', label: 'Summer Rules 1–3', icon: Sun },
              { id: 'ODE', label: 'On-Demand (ODE)', icon: Zap },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id)
                setSelectedCourseIds([])
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

        {mode === 'PHASE1' && canManage && (
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
              <option value="ODD">ODD Semester</option>
              <option value="EVEN">EVEN Semester</option>
            </select>
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
              onClick={() => setShowBulkCore((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              <Users className="h-3.5 w-3.5" />
              Bulk Cohort Core Reg
            </button>
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-3.5 w-3.5" />
              Bulk CSV (usn, course_code)
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          {errorMsg}
        </div>
      )}

      {showBulkCore && mode === 'PHASE1' && canManage && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 flex flex-wrap items-end gap-3 text-xs">
          <div>
            <label className="block font-semibold text-indigo-950 mb-1">Branch</label>
            <select
              value={bulkCoreBranch}
              onChange={(e) => setBulkCoreBranch(e.target.value)}
              className="rounded border border-indigo-300 bg-white px-2.5 py-1.5"
            >
              <option value="">Select Branch...</option>
              {bulkCoreBranches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-indigo-950 mb-1">Semester</label>
            <select
              value={bulkCoreSem}
              onChange={(e) => setBulkCoreSem(e.target.value)}
              className="rounded border border-indigo-300 bg-white px-2.5 py-1.5"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <option key={s} value={String(s)}>Semester {s}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!bulkCoreBranch || bulkCoreCohortMutation.isPending}
            onClick={() => bulkCoreCohortMutation.mutate()}
            className="rounded-md bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {bulkCoreCohortMutation.isPending
              ? 'Registering Cohort...'
              : `Register All Core Courses (${activeAcademicYear} ${activeTerm})`}
          </button>
          <p className="text-[11px] text-indigo-900">
            Auto-attaches all non-elective Core courses from the cohort&apos;s matched Scheme curriculum; add Electives &amp;
            ONLINE courses via CSV or per student afterwards.
          </p>
        </div>
      )}

      {/* Student Lookup Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Enter Student USN or Admission Number
            </label>
            <input
              type="text"
              placeholder="e.g. 1AM25CS001"
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value.toUpperCase())
                setSelectedCourseIds([])
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
            />
          </div>
          {activeStudent && (
            <button
              type="button"
              disabled={selectedCourseIds.length === 0}
              onClick={printApplicationForm}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Branded A4 Form
            </button>
          )}
        </div>

        {activeStudent && (
          <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-900 flex flex-wrap items-center gap-3">
            <strong>{activeStudent.full_name}</strong>
            <span className="font-mono">{activeStudent.registration_number}</span>
            <span>Branch: {activeStudent.program_code} ({activeStudent.program_level})</span>
            <span>Sem: {activeStudent.current_sem}</span>
            {activeStudent.scheme_batch != null && (
              <span className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                {activeStudent.scheme_batch} Scheme
              </span>
            )}
            <span>Category: {activeStudent.student_category}</span>
            {activeStudent.specialization_code !== 'GENERAL' && (
              <span>Track: {activeStudent.specialization_code}</span>
            )}
            <span className={cn('font-semibold', failedCandidates.length > 0 ? 'text-red-700' : 'text-emerald-700')}>
              Active Backlogs (Latest): {failedCandidates.length}
            </span>
          </div>
        )}

        {parityMismatch && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            <strong>Term Parity Block:</strong> Active term is <strong>{activeTerm}</strong>, but student is in{' '}
            <strong>Semester {activeStudent?.current_sem}</strong>. Update the active term or promote the student before
            Phase 1 registration.
          </div>
        )}
      </div>

      {/* PHASE 1 COURSE PICKER + 5-RULE VALIDATION ENGINE */}
      {activeStudent && mode === 'PHASE1' && !parityMismatch && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Semester {activeStudent.current_sem} Courses ({selectedCourseIds.length} selected ·{' '}
                <strong>{phase1Credits}</strong> credits)
              </h3>
              <p className="text-[11px] text-slate-500">
                {schemeCurriculum.length > 0
                  ? `Matched ${schemeCurriculum[0].curriculum_code} (${schemeCurriculum[0].scheme_batch ?? activeStudent.scheme_batch ?? ''} Scheme): ${schemeCurriculum.length} curriculum courses mapped for Sem ${activeStudent.current_sem}.`
                  : `No scheme curriculum mapped yet for ${activeStudent.program_code} Sem ${activeStudent.current_sem} — showing full catalog.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {schemeCurriculum.length > 0 && (
                <button
                  type="button"
                  onClick={autoSelectSchemeCore}
                  className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Auto-Select Core
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  disabled={savePhase1Mutation.isPending || !phase1Validation.canSubmit}
                  onClick={() => savePhase1Mutation.mutate()}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {savePhase1Mutation.isPending ? 'Saving...' : 'Save Phase 1 Registration'}
                </button>
              )}
            </div>
          </div>

          {/* Configurable Credit Bounds + Search + Out-of-Scheme toggle */}
          <div className="flex flex-wrap items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-md p-2.5">
            <input
              type="text"
              placeholder="Filter courses by code or title..."
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              className="flex-1 min-w-[180px] rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
            />
            <label className="inline-flex items-center gap-1 text-slate-600">
              Min Cr:
              <input
                type="number"
                min={0}
                max={30}
                value={minCreditsCap}
                onChange={(e) => setMinCreditsCap(e.target.value)}
                className="w-14 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
              />
            </label>
            <label className="inline-flex items-center gap-1 text-slate-600">
              Max Cr:
              <input
                type="number"
                min={1}
                max={40}
                value={maxCreditsCap}
                onChange={(e) => setMaxCreditsCap(e.target.value)}
                className="w-14 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
              />
            </label>
            {schemeCurriculum.length > 0 && (
              <label className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={showOutOfSchemeCatalog}
                  onChange={(e) => setShowOutOfSchemeCatalog(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Show Full Catalog (Out-of-Scheme)
              </label>
            )}
          </div>

          {/* Live Validation Rules Summary */}
          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-[11px] space-y-1">
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                <Check className="h-3.5 w-3.5" /> Term Parity OK ({activeTerm} / Sem {activeStudent.current_sem})
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 font-semibold',
                  phase1Validation.alreadyPassedPicked.length > 0 ? 'text-red-700' : 'text-emerald-700'
                )}
              >
                {phase1Validation.alreadyPassedPicked.length > 0 ? (
                  <XCircle className="h-3.5 w-3.5" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Already-Passed Guard
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 font-semibold',
                  phase1Validation.overMax ? 'text-red-700' : 'text-emerald-700'
                )}
              >
                {phase1Validation.overMax ? <XCircle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                Credit Cap ({phase1Credits} / {phase1Validation.maxC})
              </span>
            </div>
            {phase1Validation.hardErrors.map((err, i) => (
              <p key={i} className="text-red-700 font-semibold">
                • Block: {err}
              </p>
            ))}
            {phase1Validation.warnings.map((w, i) => (
              <p key={i} className="text-amber-800">
                • Advisory: {w}
              </p>
            ))}
            {phase1Validation.overMax && canApproveCreditOverride && (
              <label className="inline-flex items-center gap-1.5 text-amber-900 font-semibold pt-1">
                <input
                  type="checkbox"
                  checked={allowPhase1Override}
                  onChange={(e) => setAllowPhase1Override(e.target.checked)}
                  className="rounded border-amber-400 text-amber-600"
                />
                HOD / Principal Credit Cap Override
              </label>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
            {visiblePhase1Courses.map((c) => {
              const sc = schemeCourseMap.get(c.id)
              const isPassed = passedCourseIds.has(c.id)
              const alreadySaved = existingPhase1Set.has(c.id)
              return (
                <label
                  key={c.id}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 text-xs',
                    isPassed ? 'bg-slate-50 opacity-60 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'
                  )}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="checkbox"
                      disabled={isPassed}
                      checked={selectedCourseIds.includes(c.id)}
                      onChange={() => toggleCourse(c.id)}
                      className="rounded border-slate-300 text-indigo-600 disabled:opacity-40"
                    />
                    <span className="font-mono font-semibold text-slate-900">{c.course_code}</span>
                    <span className="text-slate-700">{c.title}</span>
                    {sc && (
                      <span className="rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                        {sc.is_elective ? 'Scheme Elective' : 'Scheme Core'}
                      </span>
                    )}
                    {c.is_online && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        ONLINE · Exempt
                      </span>
                    )}
                    {alreadySaved && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                        Already Registered
                      </span>
                    )}
                    {isPassed && (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                        CLEARED (PASS)
                      </span>
                    )}
                  </span>
                  <span className="text-slate-500 shrink-0 ml-2">{sc ? sc.credits : c.default_credits} Cr</span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* SUMMER & ODE SPECIAL CYCLES (Inline Target Exam Cycle Picker) */}
      {activeStudent && (mode === 'SUMMER' || mode === 'ODE') && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {mode === 'SUMMER'
                  ? 'Eligible Unpassed Courses — Latest Attempt Verified (Summer Rules 1–3)'
                  : 'Eligible Unpassed Courses — Latest Attempt Verified (On-Demand Examination)'}
              </h3>
              <p className="text-xs text-slate-500">
                {mode === 'SUMMER'
                  ? 'Base ₹400 · Rule 1 (CIE Fail) ₹5,600 · Rule 2 (AB) ₹2,000 / ₹1,000 · Rule 3 (SEE Fail) ₹600'
                  : 'Attempt 1: ₹6,000/subj · Attempt 2+: ₹3,000/subj · + ₹100 App Fee + ₹600 Grade Card Fee'}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="font-semibold text-slate-600 whitespace-nowrap">Target {mode} Cycle:</label>
              <select
                value={activeSpecialCycle?.id ?? ''}
                onChange={(e) => setSelectedSpecialCycleId(e.target.value)}
                className="rounded-md border border-indigo-300 bg-indigo-50/40 px-2.5 py-1.5 text-xs font-semibold text-indigo-950 max-w-xs"
              >
                <option value="">Select exam cycle...</option>
                {examCycles.map((ec) => (
                  <option key={ec.id} value={ec.id}>
                    {ec.code} ({ec.cycle_type}) — {ec.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {failedCandidates.length === 0 ? (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
              Zero active backlogs based on canonical latest attempts for{' '}
              <strong>{activeStudent.registration_number}</strong>.
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
                          checked={selectedCourseIds.includes(c.course_id)}
                          onChange={() => toggleCourse(c.course_id)}
                          className="rounded border-slate-300 text-indigo-600"
                        />
                        <span className="font-mono font-semibold text-slate-900">{c.course_code}</span>
                        <span className="text-slate-700">{c.course_title}</span>
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                          {c.grade_code} · CIE {c.cie_marks} · {c.credits} Cr · {c.latestCycleCode}
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
                            setOdeAttemptChoice((prev) => ({
                              ...prev,
                              [c.course_id]: Number(e.target.value),
                            }))
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
                      Rule 1 Mandatory Class Credits: <strong>{summerRule1Credits} / {allowCreditOverride && canApproveCreditOverride ? 15 : 14}</strong>
                    </span>
                    <span className="text-sm font-bold text-indigo-700">
                      Total Payable: ₹{summerBreakdown.total.toLocaleString('en-IN')}
                    </span>
                  </div>
                  {canApproveCreditOverride ? (
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
                          placeholder="Approval note / memo ref..."
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          className="flex-1 min-w-[200px] rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                        />
                      )}
                    </div>
                  ) : (
                    summerRule1Credits > 14 && (
                      <p className="text-red-700 font-medium">
                        Exceeds 14-credit limit. Lead Team (Principal / HOD) role is required to grant the 15-credit override.
                      </p>
                    )
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
  )
}
