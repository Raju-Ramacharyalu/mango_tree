import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  CheckCircle2,
  CreditCard,
  Trash2,
  Eye,
  X,
  Users,
  BookOpen,
  AlertCircle,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  CourseCatalogOption,
  ExamCycle,
  ExamFeeRule,
  ExamRegistrationCourseItem,
  ExamRegistrationItem,
  PaymentStatus,
  ProgramLevel,
  RegistrationCourseCategory,
  RegistrationStatus,
} from '@/types/exams'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  canManage: boolean
  canDelete: boolean
}

interface ProgramOption {
  id: string
  code: string
  name: string
  program_level: ProgramLevel
}

interface PeriodOption {
  id: string
  code: string
  name: string
  sequence_number: number
}

interface StudentCandidate {
  id: string
  registration_number: string
  full_name: string
  enrollment_id: string | null
  program_id: string | null
  program_code: string | null
  program_level: ProgramLevel | null
  current_period_id: string | null
  period_name: string | null
}

interface DraftCourseSelection {
  course: CourseCatalogOption
  attempt_number: number
  registration_category: RegistrationCourseCategory
}

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function resolveFeeRule(
  rules: ExamFeeRule[],
  cycle: ExamCycle,
  programLevel: ProgramLevel | null
): ExamFeeRule | null {
  const active = rules.filter((r) => r.is_active)
  return (
    active.find((r) => r.exam_cycle_id === cycle.id && r.program_level === programLevel) ??
    active.find((r) => r.exam_cycle_id === cycle.id && r.program_level === null) ??
    active.find((r) => r.exam_cycle_id === null && r.cycle_type === cycle.cycle_type && r.program_level === programLevel) ??
    active.find((r) => r.exam_cycle_id === null && r.cycle_type === cycle.cycle_type && r.program_level === null) ??
    null
  )
}

function computeCourseFee(course: CourseCatalogOption, attemptNumber: number, rule: ExamFeeRule | null): number {
  if (!rule) return 0
  if (course.is_online) return Number(rule.online_course_fee || 0)
  return attemptNumber <= 1
    ? Number(rule.first_attempt_subject_fee || 0)
    : Number(rule.subsequent_attempt_subject_fee || 0)
}

function mapCycleToCourseCategory(cycleType: ExamCycle['cycle_type']): RegistrationCourseCategory {
  if (cycleType === 'ODE') return 'ODE'
  if (cycleType === 'SUMMER') return 'SUMMER'
  if (cycleType === 'ARREAR' || cycleType === 'SUPPLEMENTARY' || cycleType === 'MAKEUP') return 'ARREAR'
  return 'REGULAR'
}

const REG_STATUS_STYLES: Record<RegistrationStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SUBMITTED: 'bg-blue-50 text-blue-700',
  APPROVED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-200 text-slate-500',
}

const PAY_STATUS_STYLES: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  WAIVED: 'bg-indigo-50 text-indigo-700',
  REFUNDED: 'bg-slate-100 text-slate-600',
}

export function RegistrationsTab({ institutionId, cycle, canManage, canDelete }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [paymentFilter, setPaymentFilter] = useState<string>('ALL')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Individual registration modal state
  const [showNewModal, setShowNewModal] = useState(false)
  const [studentTerm, setStudentTerm] = useState('')
  const [selectedStudent, setSelectedStudent] = useState<StudentCandidate | null>(null)
  const [courseSearch, setCourseSearch] = useState('')
  const [selectedCourses, setSelectedCourses] = useState<DraftCourseSelection[]>([])
  const [appFeeOverride, setAppFeeOverride] = useState<string>('')
  const [gradeCardFeeOverride, setGradeCardFeeOverride] = useState<string>('')
  const [lateFeeOverride, setLateFeeOverride] = useState<string>('')
  const [remarks, setRemarks] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  // Bulk regular cohort generator modal state
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkProgramId, setBulkProgramId] = useState('')
  const [bulkPeriodId, setBulkPeriodId] = useState('')
  const [bulkNotice, setBulkNotice] = useState<string | null>(null)

  const { data: feeRules = [] } = useQuery<ExamFeeRule[]>({
    queryKey: ['exam_fee_rules', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_fee_rules')
        .select('*')
        .eq('institution_id', institutionId)
      if (error) throw error
      return (data ?? []) as ExamFeeRule[]
    },
  })

  const { data: programs = [] } = useQuery<ProgramOption[]>({
    queryKey: ['exam_programs', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('programs')
        .select('id, code, name, program_level')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('code')
      if (error) throw error
      return (data ?? []) as ProgramOption[]
    },
  })

  const { data: periods = [] } = useQuery<PeriodOption[]>({
    queryKey: ['exam_periods', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_periods')
        .select('id, code, name, sequence_number')
        .eq('institution_id', institutionId)
        .eq('is_active', true)
        .order('sequence_number')
      if (error) throw error
      return (data ?? []) as PeriodOption[]
    },
  })

  const { data: coursesCatalog = [] } = useQuery<CourseCatalogOption[]>({
    queryKey: ['exam_course_catalog', institutionId],
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
        const cat = unwrap(row.course_categories as { code: string; is_online: boolean } | { code: string; is_online: boolean }[] | null)
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

  const { data: registrations = [], isLoading: isLoadingRegs } = useQuery<ExamRegistrationItem[]>({
    queryKey: ['exam_registrations', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_registrations')
        .select(`
          id, institution_id, exam_cycle_id, student_id, enrollment_id, program_id, academic_period_id,
          registration_type, status, application_fee, grade_card_fee, subject_fee_total, late_fee, total_fee,
          payment_status, payment_reference, paid_at, approved_at, remarks, created_at,
          students (registration_number, full_name),
          programs (code, name),
          academic_periods (name),
          exam_registration_courses (
            id, registration_id, course_id, attempt_number, registration_category,
            is_online_exempt, subject_fee, eligibility_status,
            course_catalog (course_code, title)
          )
        `)
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('created_at', { ascending: false })
      if (error) throw error

      return (data ?? []).map((row) => {
        const stu = unwrap(row.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null)
        const prog = unwrap(row.programs as { code: string; name: string } | { code: string; name: string }[] | null)
        const per = unwrap(row.academic_periods as { name: string } | { name: string }[] | null)
        const rawCourses = (row.exam_registration_courses ?? []) as Array<Record<string, unknown>>
        const courses: ExamRegistrationCourseItem[] = rawCourses.map((rc) => {
          const cc = unwrap(rc.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null)
          return {
            id: rc.id as string,
            registration_id: rc.registration_id as string,
            course_id: rc.course_id as string,
            attempt_number: Number(rc.attempt_number ?? 1),
            registration_category: rc.registration_category as RegistrationCourseCategory,
            is_online_exempt: Boolean(rc.is_online_exempt),
            subject_fee: Number(rc.subject_fee ?? 0),
            eligibility_status: rc.eligibility_status as ExamRegistrationCourseItem['eligibility_status'],
            course_code: cc?.course_code ?? '—',
            course_title: cc?.title ?? '—',
          }
        })

        return {
          id: row.id as string,
          institution_id: row.institution_id as string,
          exam_cycle_id: row.exam_cycle_id as string,
          student_id: row.student_id as string,
          enrollment_id: (row.enrollment_id as string | null) ?? null,
          program_id: row.program_id as string,
          academic_period_id: (row.academic_period_id as string | null) ?? null,
          registration_type: row.registration_type as ExamCycle['cycle_type'],
          status: row.status as RegistrationStatus,
          application_fee: Number(row.application_fee ?? 0),
          grade_card_fee: Number(row.grade_card_fee ?? 0),
          subject_fee_total: Number(row.subject_fee_total ?? 0),
          late_fee: Number(row.late_fee ?? 0),
          total_fee: Number(row.total_fee ?? 0),
          payment_status: row.payment_status as PaymentStatus,
          payment_reference: (row.payment_reference as string | null) ?? null,
          paid_at: (row.paid_at as string | null) ?? null,
          approved_at: (row.approved_at as string | null) ?? null,
          remarks: (row.remarks as string | null) ?? null,
          created_at: row.created_at as string,
          student_reg_no: stu?.registration_number ?? '—',
          student_name: stu?.full_name ?? '—',
          program_code: prog?.code ?? '—',
          program_name: prog?.name ?? '—',
          period_name: per?.name ?? null,
          courses,
        }
      })
    },
  })

  const { data: studentCandidates = [], isFetching: isSearchingStudents } = useQuery<StudentCandidate[]>({
    queryKey: ['exam_student_search', institutionId, studentTerm],
    enabled: showNewModal && studentTerm.trim().length >= 2,
    queryFn: async () => {
      const term = studentTerm.trim()
      const { data, error } = await supabase
        .from('students')
        .select(`
          id, registration_number, full_name,
          student_enrollments (
            id, program_id, current_period_id, is_current,
            programs (code, program_level),
            academic_periods (name)
          )
        `)
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .or(`registration_number.ilike.%${term}%,full_name.ilike.%${term}%`)
        .limit(20)
      if (error) throw error

      return (data ?? []).map((s) => {
        const enrollments = (s.student_enrollments ?? []) as Array<Record<string, unknown>>
        const current = enrollments.find((e) => e.is_current === true) ?? enrollments[0] ?? null
        const prog = current
          ? unwrap(current.programs as { code: string; program_level: ProgramLevel } | { code: string; program_level: ProgramLevel }[] | null)
          : null
        const per = current
          ? unwrap(current.academic_periods as { name: string } | { name: string }[] | null)
          : null
        return {
          id: s.id as string,
          registration_number: s.registration_number as string,
          full_name: s.full_name as string,
          enrollment_id: (current?.id as string | null) ?? null,
          program_id: (current?.program_id as string | null) ?? null,
          program_code: prog?.code ?? null,
          program_level: prog?.program_level ?? null,
          current_period_id: (current?.current_period_id as string | null) ?? null,
          period_name: per?.name ?? null,
        }
      })
    },
  })

  const matchedRule = useMemo(() => {
    if (!cycle) return null
    return resolveFeeRule(feeRules, cycle, selectedStudent?.program_level ?? null)
  }, [feeRules, cycle, selectedStudent])

  const feeSummary = useMemo(() => {
    const appFee = appFeeOverride !== '' ? Number(appFeeOverride) || 0 : Number(matchedRule?.application_fee ?? 0)
    const gradeFee =
      gradeCardFeeOverride !== '' ? Number(gradeCardFeeOverride) || 0 : Number(matchedRule?.grade_card_fee ?? 0)
    const isLateWindow = Boolean(cycle?.late_fee_starts_at && new Date() >= new Date(cycle.late_fee_starts_at))
    const defaultLate = isLateWindow ? Number(matchedRule?.late_fee ?? 0) : 0
    const lateFee = lateFeeOverride !== '' ? Number(lateFeeOverride) || 0 : defaultLate
    const subjectTotal = selectedCourses.reduce(
      (sum, item) => sum + computeCourseFee(item.course, item.attempt_number, matchedRule),
      0
    )
    return {
      appFee,
      gradeFee,
      lateFee,
      subjectTotal,
      total: appFee + gradeFee + subjectTotal + lateFee,
    }
  }, [appFeeOverride, gradeCardFeeOverride, lateFeeOverride, matchedRule, cycle, selectedCourses])

  const createRegMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an exam cycle first.')
      if (!selectedStudent) throw new Error('Select a student to register.')
      if (!selectedStudent.program_id) throw new Error('Selected student has no active program enrollment.')
      if (selectedCourses.length === 0) throw new Error('Add at least one course to register.')

      const { data: header, error: headerErr } = await supabase
        .from('exam_registrations')
        .insert({
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          student_id: selectedStudent.id,
          enrollment_id: selectedStudent.enrollment_id,
          program_id: selectedStudent.program_id,
          academic_period_id: selectedStudent.current_period_id,
          registration_type: cycle.cycle_type,
          status: 'SUBMITTED',
          application_fee: feeSummary.appFee,
          grade_card_fee: feeSummary.gradeFee,
          subject_fee_total: feeSummary.subjectTotal,
          late_fee: feeSummary.lateFee,
          payment_status: 'PENDING',
          remarks: remarks.trim() || null,
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        })
        .select('id')
        .single()
      if (headerErr) throw headerErr

      const courseRows = selectedCourses.map((item) => ({
        institution_id: institutionId,
        exam_cycle_id: cycle.id,
        registration_id: header.id as string,
        student_id: selectedStudent.id,
        course_id: item.course.id,
        academic_period_id: selectedStudent.current_period_id,
        attempt_number: item.attempt_number,
        registration_category: item.registration_category,
        is_online_exempt: item.course.is_online,
        subject_fee: computeCourseFee(item.course, item.attempt_number, matchedRule),
        eligibility_status: item.course.is_online ? 'EXEMPT' : 'ELIGIBLE',
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      }))

      const { error: courseErr } = await supabase.from('exam_registration_courses').insert(courseRows)
      if (courseErr) throw courseErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_registrations', institutionId, cycle?.id] })
      setShowNewModal(false)
      setSelectedStudent(null)
      setStudentTerm('')
      setSelectedCourses([])
      setAppFeeOverride('')
      setGradeCardFeeOverride('')
      setLateFeeOverride('')
      setRemarks('')
      setModalError(null)
    },
    onError: (err) => {
      setModalError(err instanceof Error ? err.message : 'Failed to create registration')
    },
  })

  const bulkCohortMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('No active cycle selected.')
      if (!bulkProgramId || !bulkPeriodId) throw new Error('Choose both a Program and an Academic Period.')

      const prog = programs.find((p) => p.id === bulkProgramId)
      const rule = resolveFeeRule(feeRules, cycle, prog?.program_level ?? null)

      const { data: enrollments, error: enrErr } = await supabase
        .from('student_enrollments')
        .select('id, student_id, program_id, current_period_id')
        .eq('institution_id', institutionId)
        .eq('program_id', bulkProgramId)
        .eq('current_period_id', bulkPeriodId)
        .eq('enrollment_status', 'ACTIVE')
        .eq('is_current', true)
      if (enrErr) throw enrErr
      if (!enrollments || enrollments.length === 0) {
        throw new Error('No ACTIVE student enrollments found for the selected Program and Period.')
      }

      const { data: existing, error: exErr } = await supabase
        .from('exam_registrations')
        .select('student_id')
        .eq('exam_cycle_id', cycle.id)
      if (exErr) throw exErr
      const existingSet = new Set((existing ?? []).map((r) => r.student_id as string))

      const toInsert = enrollments.filter((e) => !existingSet.has(e.student_id as string))
      if (toInsert.length === 0) {
        return { created: 0, skipped: enrollments.length, coursesAttached: 0 }
      }

      // Check active curriculum courses for this program + period (optional auto-attach)
      const { data: curricula } = await supabase
        .from('curricula')
        .select('id')
        .eq('institution_id', institutionId)
        .eq('program_id', bulkProgramId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('version_number', { ascending: false })
        .limit(1)

      let cohortCourses: CourseCatalogOption[] = []
      if (curricula && curricula.length > 0) {
        const { data: ccRows } = await supabase
          .from('curriculum_courses')
          .select('course_id')
          .eq('curriculum_id', curricula[0].id)
          .eq('academic_period_id', bulkPeriodId)
          .eq('is_active', true)
        const ids = new Set((ccRows ?? []).map((r) => r.course_id as string))
        cohortCourses = coursesCatalog.filter((c) => ids.has(c.id))
      }

      const subjectTotal = cohortCourses.reduce((sum, c) => sum + computeCourseFee(c, 1, rule), 0)
      const appFee = Number(rule?.application_fee ?? 0)
      const gradeFee = Number(rule?.grade_card_fee ?? 0)
      const defaultCategory = mapCycleToCourseCategory(cycle.cycle_type)

      let createdCount = 0
      let coursesAttached = 0
      const chunkSize = 100

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const batch = toInsert.slice(i, i + chunkSize)
        const headerRows = batch.map((e) => ({
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          student_id: e.student_id as string,
          enrollment_id: e.id as string,
          program_id: e.program_id as string,
          academic_period_id: e.current_period_id as string,
          registration_type: cycle.cycle_type,
          status: 'DRAFT',
          application_fee: appFee,
          grade_card_fee: gradeFee,
          subject_fee_total: subjectTotal,
          late_fee: 0,
          payment_status: 'PENDING',
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        }))

        const { data: insertedHeaders, error: insErr } = await supabase
          .from('exam_registrations')
          .insert(headerRows)
          .select('id, student_id')
        if (insErr) throw insErr

        createdCount += (insertedHeaders ?? []).length

        if (cohortCourses.length > 0 && insertedHeaders && insertedHeaders.length > 0) {
          const coursePayload = insertedHeaders.flatMap((h) =>
            cohortCourses.map((c) => ({
              institution_id: institutionId,
              exam_cycle_id: cycle.id,
              registration_id: h.id as string,
              student_id: h.student_id as string,
              course_id: c.id,
              academic_period_id: bulkPeriodId,
              attempt_number: 1,
              registration_category: defaultCategory,
              is_online_exempt: c.is_online,
              subject_fee: computeCourseFee(c, 1, rule),
              eligibility_status: c.is_online ? 'EXEMPT' : 'ELIGIBLE',
              created_by: session?.user.id ?? null,
              updated_by: session?.user.id ?? null,
            }))
          )
          const { error: cErr } = await supabase.from('exam_registration_courses').insert(coursePayload)
          if (cErr) throw cErr
          coursesAttached += coursePayload.length
        }
      }

      return { created: createdCount, skipped: existingSet.size, coursesAttached }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['exam_registrations', institutionId, cycle?.id] })
      setBulkNotice(
        `Created ${res.created} draft registrations (${res.coursesAttached} course entries attached, ${res.skipped} already registered skipped).`
      )
    },
    onError: (err) => {
      setBulkNotice(err instanceof Error ? err.message : 'Batch generation failed')
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RegistrationStatus }) => {
      const patch: Record<string, unknown> = { status, updated_by: session?.user.id ?? null }
      if (status === 'APPROVED') {
        patch.approved_by = session?.user.id ?? null
        patch.approved_at = new Date().toISOString()
      }
      const { error } = await supabase.from('exam_registrations').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_registrations', institutionId, cycle?.id] })
    },
  })

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, reference }: { id: string; reference: string }) => {
      const { error } = await supabase
        .from('exam_registrations')
        .update({
          payment_status: 'PAID',
          payment_reference: reference.trim() || null,
          paid_at: new Date().toISOString(),
          updated_by: session?.user.id ?? null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_registrations', institutionId, cycle?.id] })
    },
  })

  const deleteRegMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('exam_registrations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_registrations', institutionId, cycle?.id] })
    },
  })

  const filteredRegistrations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return registrations.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (paymentFilter !== 'ALL' && r.payment_status !== paymentFilter) return false
      if (q) {
        const hay = `${r.student_reg_no} ${r.student_name} ${r.program_code} ${r.payment_reference ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [registrations, searchQuery, statusFilter, paymentFilter])

  const filteredCatalog = useMemo(() => {
    const q = courseSearch.trim().toLowerCase()
    const pickedIds = new Set(selectedCourses.map((c) => c.course.id))
    return coursesCatalog
      .filter((c) => !pickedIds.has(c.id))
      .filter((c) => !q || c.course_code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      .slice(0, 12)
  }, [coursesCatalog, courseSearch, selectedCourses])

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Create and select an Exam Cycle in the <strong>Exam Cycles</strong> tab before managing student registrations.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Student Registrations — {cycle.code} ({cycle.cycle_type})
          </h2>
          <p className="text-xs text-slate-500">
            ONLINE courses are automatically flagged as CIE/SEE and seating exempt upon registration.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setBulkNotice(null)
                setShowBulkModal(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Users className="h-4 w-4" />
              Batch Cohort Drafts
            </button>
            <button
              type="button"
              onClick={() => {
                setModalError(null)
                setShowNewModal(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Register Student
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder="Search by USN, student name, program, or receipt ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
        >
          <option value="ALL">All Payments</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="WAIVED">Waived</option>
          <option value="REFUNDED">Refunded</option>
        </select>
      </div>

      {/* Registrations Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Student</th>
                <th className="px-4 py-2.5 font-semibold">Program / Period</th>
                <th className="px-4 py-2.5 font-semibold">Courses</th>
                <th className="px-4 py-2.5 font-semibold">Total Fee</th>
                <th className="px-4 py-2.5 font-semibold">Payment</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoadingRegs ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Loading registrations...
                  </td>
                </tr>
              ) : filteredRegistrations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No student registrations recorded for {cycle.code} yet.
                  </td>
                </tr>
              ) : (
                filteredRegistrations.map((reg) => {
                  const onlineCount = reg.courses.filter((c) => c.is_online_exempt).length
                  const isExpanded = expandedId === reg.id
                  return (
                    <>
                      <tr key={reg.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-mono font-semibold text-slate-900">{reg.student_reg_no}</p>
                          <p className="text-slate-600">{reg.student_name}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800">{reg.program_code}</span>
                          <p className="text-slate-500">{reg.period_name ?? '—'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                            className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
                          >
                            <BookOpen className="h-3.5 w-3.5" />
                            {reg.courses.length} subject{reg.courses.length === 1 ? '' : 's'}
                          </button>
                          {onlineCount > 0 && (
                            <span className="ml-1.5 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              {onlineCount} ONLINE Exempt
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">
                            ₹{reg.total_fee.toLocaleString('en-IN')}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            App ₹{reg.application_fee} + GC ₹{reg.grade_card_fee} + Sub ₹{reg.subject_fee_total}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              PAY_STATUS_STYLES[reg.payment_status]
                            )}
                          >
                            {reg.payment_status}
                          </span>
                          {reg.payment_reference && (
                            <p className="text-[10px] font-mono text-slate-500 mt-0.5">{reg.payment_reference}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              REG_STATUS_STYLES[reg.status]
                            )}
                          >
                            {reg.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              title="Inspect courses"
                              onClick={() => setExpandedId(isExpanded ? null : reg.id)}
                              className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            {canManage && reg.payment_status === 'PENDING' && (
                              <button
                                type="button"
                                title="Record Payment"
                                onClick={() => {
                                  const ref = window.prompt(
                                    `Enter receipt / UTR reference for ${reg.student_reg_no} (₹${reg.total_fee}):`,
                                    ''
                                  )
                                  if (ref !== null) {
                                    markPaidMutation.mutate({ id: reg.id, reference: ref })
                                  }
                                }}
                                className="p-1.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canManage && reg.status !== 'APPROVED' && (
                              <button
                                type="button"
                                title="Approve Registration"
                                onClick={() => updateStatusMutation.mutate({ id: reg.id, status: 'APPROVED' })}
                                className="p-1.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                title="Delete Registration"
                                onClick={() => {
                                  if (window.confirm(`Delete registration for ${reg.student_reg_no}?`)) {
                                    deleteRegMutation.mutate(reg.id)
                                  }
                                }}
                                className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${reg.id}-courses`} className="bg-slate-50/70">
                          <td colSpan={7} className="px-6 py-3">
                            <div className="space-y-2">
                              <p className="text-[11px] font-semibold text-slate-700">
                                Registered Courses ({reg.courses.length})
                              </p>
                              {reg.courses.length === 0 ? (
                                <p className="text-xs text-slate-500">No individual courses linked yet.</p>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {reg.courses.map((c) => (
                                    <div
                                      key={c.id}
                                      className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2"
                                    >
                                      <div>
                                        <span className="font-mono font-semibold text-slate-900">{c.course_code}</span>
                                        <span className="ml-2 text-slate-600">{c.course_title}</span>
                                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
                                          <span>Attempt #{c.attempt_number}</span>
                                          <span>·</span>
                                          <span>{c.registration_category}</span>
                                          {c.is_online_exempt && (
                                            <span className="rounded bg-amber-100 px-1.5 py-0.2 font-semibold text-amber-800">
                                              ONLINE — CIE/SEE Exempt
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="text-right">
                                        <p className="font-semibold text-slate-800">₹{c.subject_fee}</p>
                                        <p className="text-[10px] text-slate-500">{c.eligibility_status}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Individual Registration Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Register Student — {cycle.code} ({cycle.cycle_type})
                </h3>
                <p className="text-xs text-slate-500">
                  {matchedRule
                    ? `Active fee rule: ${matchedRule.rule_name}`
                    : 'No matching fee rule found — fees default to ₹0 (editable below).'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {modalError && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {modalError}
              </div>
            )}

            {/* Step 1: Pick Student */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">1. Select Student (Search USN or Name)</label>
              {selectedStudent ? (
                <div className="flex items-center justify-between rounded-md border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-xs">
                  <div>
                    <span className="font-mono font-semibold text-slate-900">
                      {selectedStudent.registration_number}
                    </span>
                    <span className="ml-2 font-medium text-slate-800">{selectedStudent.full_name}</span>
                    <span className="ml-2 text-slate-500">
                      ({selectedStudent.program_code ?? 'No Program'} · {selectedStudent.period_name ?? 'No Period'})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedStudent(null)}
                    className="text-indigo-600 hover:underline font-medium"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    placeholder="Type at least 2 characters (e.g. 1AM25CS or student name)..."
                    value={studentTerm}
                    onChange={(e) => setStudentTerm(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  {isSearchingStudents && <p className="text-xs text-slate-500">Searching students...</p>}
                  {studentCandidates.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
                      {studentCandidates.map((stu) => (
                        <button
                          key={stu.id}
                          type="button"
                          onClick={() => setSelectedStudent(stu)}
                          className="w-full px-3 py-2 text-left text-xs hover:bg-indigo-50 flex items-center justify-between"
                        >
                          <span>
                            <strong className="font-mono">{stu.registration_number}</strong> — {stu.full_name}
                          </span>
                          <span className="text-slate-500">
                            {stu.program_code ?? 'Unenrolled'} {stu.period_name ? `· ${stu.period_name}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Pick Courses */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">2. Add Subjects & Attempt Numbers</label>
              <input
                type="text"
                placeholder="Filter courses by code or title (e.g. 1BMATC101)..."
                value={courseSearch}
                onChange={(e) => setCourseSearch(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs"
              />
              <div className="max-h-36 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
                {filteredCatalog.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-slate-50"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-mono font-semibold text-slate-800">{c.course_code}</span>
                      <span className="ml-2 text-slate-600">{c.title}</span>
                      {c.is_online && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          ONLINE · Exempt
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedCourses((prev) => [
                          ...prev,
                          {
                            course: c,
                            attempt_number: 1,
                            registration_category: mapCycleToCourseCategory(cycle.cycle_type),
                          },
                        ])
                      }
                      className="shrink-0 rounded bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      + Add
                    </button>
                  </div>
                ))}
              </div>

              {selectedCourses.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {selectedCourses.map((item, idx) => {
                    const fee = computeCourseFee(item.course, item.attempt_number, matchedRule)
                    return (
                      <div
                        key={item.course.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-mono font-semibold text-slate-900">{item.course.course_code}</span>
                          <span className="ml-2 text-slate-600">{item.course.title}</span>
                          {item.course.is_online && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                              ONLINE Exempt
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-slate-500">
                            Attempt:
                            <input
                              type="number"
                              min={1}
                              max={10}
                              value={item.attempt_number}
                              onChange={(e) => {
                                const val = Math.max(1, Number(e.target.value) || 1)
                                setSelectedCourses((prev) =>
                                  prev.map((row, i) => (i === idx ? { ...row, attempt_number: val } : row))
                                )
                              }}
                              className="ml-1 w-14 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
                            />
                          </label>
                          <span className="font-semibold text-slate-800 w-16 text-right">₹{fee}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedCourses((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Step 3: Fee Breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Application Fee</label>
                <input
                  type="number"
                  min={0}
                  value={appFeeOverride !== '' ? appFeeOverride : String(feeSummary.appFee)}
                  onChange={(e) => setAppFeeOverride(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Grade Card Fee</label>
                <input
                  type="number"
                  min={0}
                  value={gradeCardFeeOverride !== '' ? gradeCardFeeOverride : String(feeSummary.gradeFee)}
                  onChange={(e) => setGradeCardFeeOverride(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Late Fee</label>
                <input
                  type="number"
                  min={0}
                  value={lateFeeOverride !== '' ? lateFeeOverride : String(feeSummary.lateFee)}
                  onChange={(e) => setLateFeeOverride(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                />
              </div>
              <div className="flex flex-col justify-center text-right">
                <span className="text-[11px] text-slate-500">Total Payable</span>
                <span className="text-lg font-bold text-indigo-700">
                  ₹{feeSummary.total.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Remarks (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Approved by HOD / ODE Batch 1"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createRegMutation.isPending}
                onClick={() => createRegMutation.mutate()}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {createRegMutation.isPending ? 'Saving Registration...' : 'Confirm Registration'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Regular Cohort Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Batch Cohort Draft Registrations</h3>
                <p className="text-xs text-slate-500">
                  Generate DRAFT registrations for all ACTIVE students in a Program & Semester for {cycle.code}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {bulkNotice && (
              <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-800">
                {bulkNotice}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Program</label>
                <select
                  value={bulkProgramId}
                  onChange={(e) => setBulkProgramId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="">Select Program...</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name} ({p.program_level})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Academic Period / Semester</label>
                <select
                  value={bulkPeriodId}
                  onChange={(e) => setBulkPeriodId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="">Select Period...</option>
                  {periods.map((per) => (
                    <option key={per.id} value={per.id}>
                      {per.code} — {per.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-slate-500">
                Already-registered students are skipped automatically. Active curriculum courses mapped to this program
                & period will be attached with ONLINE courses marked exempt.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowBulkModal(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                disabled={bulkCohortMutation.isPending}
                onClick={() => bulkCohortMutation.mutate()}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {bulkCohortMutation.isPending ? 'Generating...' : 'Generate Cohort Drafts'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
