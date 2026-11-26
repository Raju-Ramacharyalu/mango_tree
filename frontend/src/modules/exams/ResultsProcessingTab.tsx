import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  Award,
  ClipboardEdit,
  Download,
  Upload,
  Printer,
  RefreshCw,
  CheckCircle2,
  Globe,
  Lock,
  Search,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  CourseResultStatus,
  ExamCourseResultItem,
  ExamCycle,
  ExamSemesterResultItem,
  GradeScaleItemRow,
  ProgramLevel,
  SemesterResultStatus,
} from '@/types/exams'
import { evaluateCourseGrade, normalizeCourseCode } from './bundleEngine'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  canEnterCie: boolean
  canPublish: boolean
}

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function escapeHtml(val: string | number | null | undefined): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = String(val ?? '').trim()
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const csvBody = [headers, ...rows].map((line) => line.map(escapeCsvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const RESULT_BADGES: Record<CourseResultStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  PASS: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  FAIL: 'bg-red-50 text-red-700 border border-red-200',
  ABSENT: 'bg-red-100 text-red-800',
  MALPRACTICE: 'bg-amber-100 text-amber-900',
  EXEMPT: 'bg-indigo-50 text-indigo-700',
  WITHHELD: 'bg-amber-50 text-amber-800',
}

export function ResultsProcessingTab({
  institutionId,
  institutionName,
  cycle,
  canEnterCie,
  canPublish,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const cieCsvRef = useRef<HTMLInputElement | null>(null)

  const [subTab, setSubTab] = useState<'LEDGER' | 'SEMESTER'>('LEDGER')
  const [programFilter, setProgramFilter] = useState('ALL')
  const [courseFilter, setCourseFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [minCiePct, setMinCiePct] = useState('40')
  const [minSeePct, setMinSeePct] = useState('35')
  const [minTotalPct, setMinTotalPct] = useState('40')
  const [notice, setNotice] = useState<string | null>(null)

  const { data: gradeScaleItems = [] } = useQuery<GradeScaleItemRow[]>({
    queryKey: ['exam_grade_scale_items', institutionId],
    queryFn: async () => {
      const { data: scales } = await supabase
        .from('grading_scales')
        .select('id')
        .eq('institution_id', institutionId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)

      if (!scales || scales.length === 0) return []
      const { data: items, error } = await supabase
        .from('grade_scale_items')
        .select('grade_code, description, grade_point, min_percentage, max_percentage, is_pass, sort_order')
        .eq('grading_scale_id', scales[0].id)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return (items ?? []).map((i) => ({
        grade_code: i.grade_code as string,
        description: i.description as string,
        grade_point: Number(i.grade_point ?? 0),
        min_percentage: i.min_percentage !== null ? Number(i.min_percentage) : null,
        max_percentage: i.max_percentage !== null ? Number(i.max_percentage) : null,
        is_pass: Boolean(i.is_pass),
        sort_order: Number(i.sort_order ?? 100),
      }))
    },
  })

  const { data: courseResults = [], isLoading: loadingLedger } = useQuery<ExamCourseResultItem[]>({
    queryKey: ['exam_course_results', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_course_results')
        .select(`
          id, institution_id, exam_cycle_id, registration_id, registration_course_id,
          student_id, course_id, program_id, effective_course_code, credits, is_online_exempt,
          cie_marks, cie_max_marks, see_marks, see_max_marks, total_marks, max_total_marks,
          percentage, grade_code, grade_point, result_status, source_bundle_id, is_published, remarks,
          students (registration_number, full_name),
          course_catalog (course_code, title),
          programs (code, program_level),
          exam_registrations (academic_periods (name))
        `)
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('effective_course_code', { ascending: true })
      if (error) throw error

      return (data ?? [])
        .map((row) => {
          const stu = unwrap(
            row.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null
          )
          const cc = unwrap(
            row.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null
          )
          const prog = unwrap(
            row.programs as { code: string; program_level: ProgramLevel } | { code: string; program_level: ProgramLevel }[] | null
          )
          const er = unwrap(row.exam_registrations as Record<string, unknown> | Record<string, unknown>[] | null)
          const per = er ? unwrap(er.academic_periods as { name: string } | { name: string }[] | null) : null
          return {
            id: row.id as string,
            institution_id: row.institution_id as string,
            exam_cycle_id: row.exam_cycle_id as string,
            registration_id: row.registration_id as string,
            registration_course_id: row.registration_course_id as string,
            student_id: row.student_id as string,
            student_reg_no: stu?.registration_number ?? '—',
            student_name: stu?.full_name ?? '—',
            course_id: row.course_id as string,
            course_code: cc?.course_code ?? row.effective_course_code,
            course_title: cc?.title ?? '—',
            effective_course_code: row.effective_course_code as string,
            program_id: row.program_id as string,
            program_code: prog?.code ?? '—',
            program_level: prog?.program_level ?? 'UG',
            period_name: per?.name ?? null,
            credits: Number(row.credits ?? 3),
            is_online_exempt: Boolean(row.is_online_exempt),
            cie_marks: row.cie_marks !== null ? Number(row.cie_marks) : null,
            cie_max_marks: Number(row.cie_max_marks ?? 50),
            see_marks: row.see_marks !== null ? Number(row.see_marks) : null,
            see_max_marks: Number(row.see_max_marks ?? 50),
            total_marks: row.total_marks !== null ? Number(row.total_marks) : null,
            max_total_marks: Number(row.max_total_marks ?? 100),
            percentage: row.percentage !== null ? Number(row.percentage) : null,
            grade_code: (row.grade_code as string | null) ?? null,
            grade_point: row.grade_point !== null ? Number(row.grade_point) : null,
            result_status: row.result_status as CourseResultStatus,
            source_bundle_id: (row.source_bundle_id as string | null) ?? null,
            is_published: Boolean(row.is_published),
            remarks: (row.remarks as string | null) ?? null,
          }
        })
        .sort(
          (a, b) =>
            a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true }) ||
            a.effective_course_code.localeCompare(b.effective_course_code)
        )
    },
  })

  const { data: semesterResults = [] } = useQuery<ExamSemesterResultItem[]>({
    queryKey: ['exam_semester_results', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_semester_results')
        .select(`
          *,
          students (registration_number, full_name),
          programs (code, name, program_level),
          academic_periods (name)
        `)
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
      if (error) throw error

      return (data ?? [])
        .map((row) => {
          const stu = unwrap(
            row.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null
          )
          const prog = unwrap(
            row.programs as { code: string; name: string; program_level: ProgramLevel } | { code: string; name: string; program_level: ProgramLevel }[] | null
          )
          const per = unwrap(row.academic_periods as { name: string } | { name: string }[] | null)
          return {
            id: row.id as string,
            institution_id: row.institution_id as string,
            exam_cycle_id: row.exam_cycle_id as string,
            registration_id: row.registration_id as string,
            student_id: row.student_id as string,
            student_reg_no: stu?.registration_number ?? '—',
            student_name: stu?.full_name ?? '—',
            program_id: row.program_id as string,
            program_code: prog?.code ?? '—',
            program_name: prog?.name ?? '—',
            program_level: prog?.program_level ?? 'UG',
            academic_period_id: (row.academic_period_id as string | null) ?? null,
            period_name: per?.name ?? null,
            total_courses: Number(row.total_courses ?? 0),
            passed_courses: Number(row.passed_courses ?? 0),
            failed_courses: Number(row.failed_courses ?? 0),
            credits_registered: Number(row.credits_registered ?? 0),
            credits_earned: Number(row.credits_earned ?? 0),
            total_grade_points: Number(row.total_grade_points ?? 0),
            sgpa: Number(row.sgpa ?? 0),
            overall_status: row.overall_status as SemesterResultStatus,
            is_published: Boolean(row.is_published),
            published_at: (row.published_at as string | null) ?? null,
          }
        })
        .sort((a, b) => a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true }))
    },
  })

  // Initialize result rows from all APPROVED exam_registration_courses + sync Form B absentees
  const syncLedgerMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an exam cycle first.')
      const [regCoursesRes, seatsRes, existingRes] = await Promise.all([
        supabase
          .from('exam_registration_courses')
          .select(`
            id, registration_id, student_id, course_id, is_online_exempt,
            course_catalog (course_code, default_credits, course_categories (default_max_cie, default_max_see)),
            exam_registrations!inner (status, program_id)
          `)
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle.id),
        supabase
          .from('exam_seat_allotments')
          .select('registration_course_id, effective_course_code, attendance_status')
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle.id),
        supabase
          .from('exam_course_results')
          .select('registration_course_id')
          .eq('exam_cycle_id', cycle.id),
      ])

      if (regCoursesRes.error) throw regCoursesRes.error
      if (seatsRes.error) throw seatsRes.error
      if (existingRes.error) throw existingRes.error

      const seatMap = new Map<string, { effectiveCode: string; status: string }>()
      for (const s of seatsRes.data ?? []) {
        seatMap.set(s.registration_course_id as string, {
          effectiveCode: s.effective_course_code as string,
          status: s.attendance_status as string,
        })
      }
      const existingSet = new Set((existingRes.data ?? []).map((r) => r.registration_course_id as string))

      const toInsert: Array<Record<string, unknown>> = []
      for (const rc of regCoursesRes.data ?? []) {
        const er = unwrap(rc.exam_registrations as Record<string, unknown> | Record<string, unknown>[] | null)
        if (!er || er.status !== 'APPROVED') continue
        if (existingSet.has(rc.id as string)) continue

        const cc = unwrap(rc.course_catalog as Record<string, unknown> | Record<string, unknown>[] | null)
        const cat = cc
          ? unwrap(
              cc.course_categories as
                | { default_max_cie: number; default_max_see: number }
                | { default_max_cie: number; default_max_see: number }[]
                | null
            )
          : null
        const seat = seatMap.get(rc.id as string)
        const isOnline = Boolean(rc.is_online_exempt)
        const cieMax = isOnline ? 0 : Number(cat?.default_max_cie ?? 50)
        const seeMax = isOnline ? 0 : Number(cat?.default_max_see ?? 50)

        let initStatus: CourseResultStatus = 'PENDING'
        if (isOnline) initStatus = 'EXEMPT'
        else if (seat?.status === 'ABSENT') initStatus = 'ABSENT'
        else if (seat?.status === 'MALPRACTICE') initStatus = 'MALPRACTICE'

        toInsert.push({
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          registration_id: rc.registration_id as string,
          registration_course_id: rc.id as string,
          student_id: rc.student_id as string,
          course_id: rc.course_id as string,
          program_id: er.program_id as string,
          effective_course_code: normalizeCourseCode(seat?.effectiveCode ?? String(cc?.course_code ?? '')),
          credits: Number(cc?.default_credits ?? 3),
          is_online_exempt: isOnline,
          cie_max_marks: cieMax,
          see_max_marks: seeMax,
          max_total_marks: Math.max(1, cieMax + seeMax),
          result_status: initStatus,
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        })
      }

      const chunkSize = 400
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const { error } = await supabase
          .from('exam_course_results')
          .upsert(toInsert.slice(i, i + chunkSize), { onConflict: 'exam_cycle_id,registration_course_id' })
        if (error) throw error
      }

      return toInsert.length
    },
    onSuccess: (cnt) => {
      queryClient.invalidateQueries({ queryKey: ['exam_course_results', institutionId, cycle?.id] })
      setNotice(`Synced ${cnt} approved course registration entries (including ONLINE exemptions & Form B absentees) into the Marks Ledger.`)
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : 'Failed to sync marks ledger')
    },
  })

  const updateMarkCellMutation = useMutation({
    mutationFn: async (patch: { id: string; cie_marks?: number | null; see_marks?: number | null }) => {
      const updateObj: Record<string, unknown> = { updated_by: session?.user.id ?? null }
      if (patch.cie_marks !== undefined) updateObj.cie_marks = patch.cie_marks
      if (patch.see_marks !== undefined) updateObj.see_marks = patch.see_marks
      const { error } = await supabase.from('exam_course_results').update(updateObj).eq('id', patch.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_course_results', institutionId, cycle?.id] })
    },
  })

  const computeGradesMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an exam cycle first.')
      if (courseResults.length === 0) throw new Error('No course result rows to process.')

      const cieMin = Number(minCiePct) || 40
      const seeMin = Number(minSeePct) || 35
      const totMin = Number(minTotalPct) || 40

      // Compute course-level grades
      const evaluatedCourseUpdates: Array<{
        row: ExamCourseResultItem
        evalOut: ReturnType<typeof evaluateCourseGrade>
      }> = courseResults.map((row) => ({
        row,
        evalOut: evaluateCourseGrade({
          is_online_exempt: row.is_online_exempt,
          current_status: row.result_status,
          cie_marks: row.cie_marks,
          cie_max_marks: row.cie_max_marks,
          see_marks: row.see_marks,
          see_max_marks: row.see_max_marks,
          min_cie_percent: cieMin,
          min_see_percent: seeMin,
          min_total_percent: totMin,
          scaleItems: gradeScaleItems,
        }),
      }))

      // Batch upsert course results in 400-row chunks
      const coursePayloads = evaluatedCourseUpdates.map(({ row, evalOut }) => ({
        id: row.id,
        institution_id: row.institution_id,
        exam_cycle_id: row.exam_cycle_id,
        registration_id: row.registration_id,
        registration_course_id: row.registration_course_id,
        student_id: row.student_id,
        course_id: row.course_id,
        program_id: row.program_id,
        effective_course_code: row.effective_course_code,
        credits: row.credits,
        is_online_exempt: row.is_online_exempt,
        cie_marks: row.cie_marks,
        cie_max_marks: row.cie_max_marks,
        see_marks: row.see_marks,
        see_max_marks: row.see_max_marks,
        total_marks: evalOut.total_marks,
        max_total_marks: evalOut.max_total_marks,
        percentage: evalOut.percentage,
        grade_code: evalOut.grade_code,
        grade_point: evalOut.grade_point,
        result_status: evalOut.result_status,
        updated_by: session?.user.id ?? null,
      }))

      const chunkSize = 400
      for (let i = 0; i < coursePayloads.length; i += chunkSize) {
        const { error } = await supabase
          .from('exam_course_results')
          .upsert(coursePayloads.slice(i, i + chunkSize), { onConflict: 'exam_cycle_id,registration_course_id' })
        if (error) throw error
      }

      // Fetch registration period_ids for semester rollups
      const { data: regs } = await supabase
        .from('exam_registrations')
        .select('id, academic_period_id')
        .eq('exam_cycle_id', cycle.id)
      const regPeriodMap = new Map((regs ?? []).map((r) => [r.id as string, (r.academic_period_id as string | null) ?? null]))

      // Aggregate per student for SGPA
      const byStudent = new Map<
        string,
        {
          registration_id: string
          student_id: string
          program_id: string
          academic_period_id: string | null
          totalCourses: number
          passedCourses: number
          failedCourses: number
          pendingCourses: number
          withheldCourses: number
          creditsRegistered: number
          creditsEarned: number
          totalGradePoints: number
          gradedCredits: number
        }
      >()

      for (const { row, evalOut } of evaluatedCourseUpdates) {
        const agg = byStudent.get(row.student_id) ?? {
          registration_id: row.registration_id,
          student_id: row.student_id,
          program_id: row.program_id,
          academic_period_id: regPeriodMap.get(row.registration_id) ?? null,
          totalCourses: 0,
          passedCourses: 0,
          failedCourses: 0,
          pendingCourses: 0,
          withheldCourses: 0,
          creditsRegistered: 0,
          creditsEarned: 0,
          totalGradePoints: 0,
          gradedCredits: 0,
        }
        agg.totalCourses += 1
        agg.creditsRegistered += row.credits

        if (evalOut.result_status === 'PASS') {
          agg.passedCourses += 1
          agg.creditsEarned += row.credits
          agg.gradedCredits += row.credits
          agg.totalGradePoints += row.credits * evalOut.grade_point
        } else if (evalOut.result_status === 'EXEMPT') {
          agg.passedCourses += 1
          agg.creditsEarned += row.credits
        } else if (
          evalOut.result_status === 'FAIL' ||
          evalOut.result_status === 'ABSENT' ||
          evalOut.result_status === 'MALPRACTICE'
        ) {
          agg.failedCourses += 1
          agg.gradedCredits += row.credits
        } else if (evalOut.result_status === 'WITHHELD') {
          agg.withheldCourses += 1
        } else {
          agg.pendingCourses += 1
        }
        byStudent.set(row.student_id, agg)
      }

      const semPayloads = Array.from(byStudent.values()).map((a) => {
        const sgpa = a.gradedCredits > 0 ? Number((a.totalGradePoints / a.gradedCredits).toFixed(2)) : 0
        let overall: SemesterResultStatus = 'PASS'
        if (a.withheldCourses > 0) overall = 'WITHHELD'
        else if (a.pendingCourses > 0) overall = 'PENDING'
        else if (a.failedCourses > 0) overall = 'FAIL'

        return {
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          registration_id: a.registration_id,
          student_id: a.student_id,
          program_id: a.program_id,
          academic_period_id: a.academic_period_id,
          total_courses: a.totalCourses,
          passed_courses: a.passedCourses,
          failed_courses: a.failedCourses,
          credits_registered: Number(a.creditsRegistered.toFixed(2)),
          credits_earned: Number(a.creditsEarned.toFixed(2)),
          total_grade_points: Number(a.totalGradePoints.toFixed(2)),
          sgpa,
          overall_status: overall,
          updated_by: session?.user.id ?? null,
        }
      })

      for (let i = 0; i < semPayloads.length; i += chunkSize) {
        const { error } = await supabase
          .from('exam_semester_results')
          .upsert(semPayloads.slice(i, i + chunkSize), { onConflict: 'exam_cycle_id,student_id' })
        if (error) throw error
      }

      return { coursesProcessed: coursePayloads.length, studentsProcessed: semPayloads.length }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['exam_course_results', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_semester_results', institutionId, cycle?.id] })
      setNotice(
        `Processed grades for ${res.coursesProcessed} course entries and computed SGPA for ${res.studentsProcessed} students.`
      )
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : 'Result computation failed')
    },
  })

  const togglePublishMutation = useMutation({
    mutationFn: async (publish: boolean) => {
      if (!cycle) throw new Error('No active cycle.')
      const now = publish ? new Date().toISOString() : null
      const [cRes, sRes] = await Promise.all([
        supabase
          .from('exam_course_results')
          .update({ is_published: publish, published_at: now, updated_by: session?.user.id ?? null })
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle.id),
        supabase
          .from('exam_semester_results')
          .update({ is_published: publish, published_at: now, updated_by: session?.user.id ?? null })
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle.id),
      ])
      if (cRes.error) throw cRes.error
      if (sRes.error) throw sRes.error
    },
    onSuccess: (_data, publish) => {
      queryClient.invalidateQueries({ queryKey: ['exam_course_results', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_semester_results', institutionId, cycle?.id] })
      setNotice(publish ? `Results for ${cycle?.code} are now PUBLISHED.` : `Results for ${cycle?.code} moved back to UNPUBLISHED draft.`)
    },
  })

  const handleCieCsvImport = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        const lookup = new Map<string, ExamCourseResultItem>()
        for (const r of courseResults) {
          lookup.set(`${r.student_reg_no.toUpperCase()}::${normalizeCourseCode(r.effective_course_code)}`, r)
          lookup.set(`${r.student_reg_no.toUpperCase()}::${normalizeCourseCode(r.course_code)}`, r)
        }

        let updated = 0
        for (const row of parsed.data) {
          const usn = (row.USN || row.usn || row.Registration_Number || '').trim().toUpperCase()
          const course = normalizeCourseCode(row.Course_code || row.Course_Code || row.course_code || '')
          const cieStr = (row.CIE || row.cie || row.CIE_Marks || '').trim()
          const seeStr = (row.SEE || row.see || row.SEE_Marks || '').trim()

          const target = lookup.get(`${usn}::${course}`)
          if (!target || target.is_online_exempt) continue

          const patch: Record<string, unknown> = { updated_by: session?.user.id ?? null }
          let hasChange = false
          if (cieStr !== '' && !Number.isNaN(Number(cieStr))) {
            patch.cie_marks = Number(cieStr)
            hasChange = true
          }
          if (seeStr !== '' && !Number.isNaN(Number(seeStr))) {
            patch.see_marks = Number(seeStr)
            hasChange = true
          }
          if (!hasChange) continue

          const { error } = await supabase.from('exam_course_results').update(patch).eq('id', target.id)
          if (!error) updated += 1
        }

        queryClient.invalidateQueries({ queryKey: ['exam_course_results', institutionId, cycle?.id] })
        setNotice(`Imported CIE/SEE marks for ${updated} course result rows. Click "Compute Grades & SGPA" to recalculate totals.`)
      },
    })
  }

  const filterOptions = useMemo(() => {
    const progs = Array.from(new Set(courseResults.map((r) => r.program_code))).sort()
    const courses = Array.from(new Set(courseResults.map((r) => r.effective_course_code))).sort()
    return { progs, courses }
  }, [courseResults])

  const filteredLedger = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return courseResults.filter((r) => {
      if (programFilter !== 'ALL' && r.program_code !== programFilter) return false
      if (courseFilter !== 'ALL' && r.effective_course_code !== courseFilter) return false
      if (q) {
        const hay = `${r.student_reg_no} ${r.student_name} ${r.effective_course_code} ${r.program_code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [courseResults, programFilter, courseFilter, searchQuery])

  const filteredSemester = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return semesterResults.filter((r) => {
      if (programFilter !== 'ALL' && r.program_code !== programFilter) return false
      if (q) {
        const hay = `${r.student_reg_no} ${r.student_name} ${r.program_code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [semesterResults, programFilter, searchQuery])

  const printGradeCards = (batch: ExamSemesterResultItem[]) => {
    if (!cycle || batch.length === 0) return
    const win = window.open('', '_blank', 'width=960,height=820')
    if (!win) {
      window.alert('Please allow pop-ups in your browser to print Provisional Grade Cards.')
      return
    }

    const pages = batch
      .map((sr) => {
        const lines = courseResults.filter((c) => c.student_id === sr.student_id)
        return `<section class="page">
          <div class="box">
            <div class="hdr">
              <h1>${escapeHtml(institutionName)}</h1>
              <p><strong>PROVISIONAL STATEMENT OF GRADES — ${escapeHtml(cycle.name)} (${escapeHtml(cycle.code)})</strong></p>
            </div>
            <table class="info">
              <tr><td class="lbl">USN</td><td><strong>${escapeHtml(sr.student_reg_no)}</strong></td><td class="lbl">Program</td><td>${escapeHtml(sr.program_code)} — ${escapeHtml(sr.program_name)}</td></tr>
              <tr><td class="lbl">Candidate Name</td><td><strong>${escapeHtml(sr.student_name)}</strong></td><td class="lbl">Semester</td><td>${escapeHtml(sr.period_name ?? '—')}</td></tr>
            </table>
            <table>
              <thead>
                <tr>
                  <th style="width:95px">Course Code</th>
                  <th>Course Title</th>
                  <th style="width:48px;text-align:center">Cr.</th>
                  <th style="width:52px;text-align:center">CIE</th>
                  <th style="width:52px;text-align:center">SEE</th>
                  <th style="width:52px;text-align:center">TOT</th>
                  <th style="width:48px;text-align:center">GRD</th>
                  <th style="width:48px;text-align:center">GP</th>
                  <th style="width:72px;text-align:center">Result</th>
                </tr>
              </thead>
              <tbody>
                ${lines
                  .map(
                    (c) => `<tr>
                      <td style="font-family:monospace;font-weight:700">${escapeHtml(c.effective_course_code)}</td>
                      <td>${escapeHtml(c.course_title)}${c.is_online_exempt ? ' (ONLINE)' : ''}</td>
                      <td style="text-align:center">${c.credits}</td>
                      <td style="text-align:center">${c.is_online_exempt ? 'EX' : c.cie_marks ?? '—'}</td>
                      <td style="text-align:center">${c.is_online_exempt ? 'EX' : c.see_marks ?? '—'}</td>
                      <td style="text-align:center;font-weight:700">${c.is_online_exempt ? 'EX' : c.total_marks ?? '—'}</td>
                      <td style="text-align:center;font-weight:700">${escapeHtml(c.grade_code ?? '—')}</td>
                      <td style="text-align:center">${c.grade_point ?? '—'}</td>
                      <td style="text-align:center;font-weight:600">${escapeHtml(c.result_status)}</td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
            <div class="summary">
              <span><strong>Credits Registered:</strong> ${sr.credits_registered}</span>
              <span><strong>Credits Earned:</strong> ${sr.credits_earned}</span>
              <span><strong>SGPA:</strong> ${sr.sgpa.toFixed(2)}</span>
              <span><strong>Result:</strong> ${escapeHtml(sr.overall_status)}</span>
            </div>
            <div class="sign">
              <span>Verified By</span>
              <span>Controller of Examinations (COE)</span>
              <span>Principal</span>
            </div>
          </div>
        </section>`
      })
      .join('')

    win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(cycle.code)} — Provisional Grade Cards</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111; font-size: 11px; margin: 0; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .box { border: 1.5px solid #1e293b; padding: 14px; }
    .hdr { text-align: center; border-bottom: 1.5px solid #1e293b; padding-bottom: 8px; margin-bottom: 10px; }
    .hdr h1 { margin: 0; font-size: 15px; text-transform: uppercase; }
    .hdr p { margin: 3px 0 0; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #475569; padding: 4px 6px; text-align: left; }
    th { background: #f1f5f9; }
    .info .lbl { background: #f8fafc; font-weight: 600; width: 110px; }
    .summary { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #94a3b8; padding: 7px 10px; font-size: 11.5px; }
    .sign { display: flex; justify-content: space-between; margin-top: 48px; font-weight: 600; }
  </style>
</head>
<body>
  ${pages}
  <script>window.onload = function(){ window.print(); };</script>
</body>
</html>`)
    win.document.close()
  }

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to manage CIE Marks, Decoded SEE Marks, and Result Processing.
      </div>
    )
  }

  const isPublished = semesterResults.some((r) => r.is_published)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Marks Ledger & Result Processing — {cycle.code}</h2>
          <p className="text-xs text-slate-500">
            Combine CIE + decoded SEE marks, compute VTU/tenant grades & SGPA, export result CSVs, and print
            provisional grade cards.
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSubTab('LEDGER')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium',
              subTab === 'LEDGER' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <ClipboardEdit className="h-3.5 w-3.5" />
            CIE / SEE Ledger ({courseResults.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('SEMESTER')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium',
              subTab === 'SEMESTER' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <Award className="h-3.5 w-3.5" />
            SGPA & Grade Cards ({semesterResults.length})
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-600" />
          {notice}
        </div>
      )}

      {/* Control Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-1 text-slate-600">
              Min CIE %:
              <input
                type="number"
                value={minCiePct}
                onChange={(e) => setMinCiePct(e.target.value)}
                className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs"
              />
            </label>
            <label className="inline-flex items-center gap-1 text-slate-600">
              Min SEE %:
              <input
                type="number"
                value={minSeePct}
                onChange={(e) => setMinSeePct(e.target.value)}
                className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs"
              />
            </label>
            <label className="inline-flex items-center gap-1 text-slate-600">
              Min Total %:
              <input
                type="number"
                value={minTotalPct}
                onChange={(e) => setMinTotalPct(e.target.value)}
                className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEnterCie && (
              <>
                <button
                  type="button"
                  disabled={syncLedgerMutation.isPending}
                  onClick={() => syncLedgerMutation.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', syncLedgerMutation.isPending && 'animate-spin')} />
                  Sync Approved Registrations
                </button>

                <input
                  ref={cieCsvRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleCieCsvImport(file)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => cieCsvRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import CIE/SEE CSV
                </button>
              </>
            )}

            {canPublish && (
              <>
                <button
                  type="button"
                  disabled={computeGradesMutation.isPending || courseResults.length === 0}
                  onClick={() => computeGradesMutation.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  <Award className="h-3.5 w-3.5" />
                  {computeGradesMutation.isPending ? 'Computing...' : 'Compute Grades & SGPA'}
                </button>
                <button
                  type="button"
                  disabled={togglePublishMutation.isPending || semesterResults.length === 0}
                  onClick={() => togglePublishMutation.mutate(!isPublished)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40',
                    isPublished ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  )}
                >
                  {isPublished ? <Lock className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                  {isPublished ? 'Unpublish Results' : 'Publish Results'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Search USN, student name, course, or branch..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
          <select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="ALL">All Branches</option>
            {filterOptions.progs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {subTab === 'LEDGER' && (
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
            >
              <option value="ALL">All Courses</option>
              {filterOptions.courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={filteredLedger.length === 0}
            onClick={() =>
              downloadCsv(
                `${cycle.code}_Results_Sheet.csv`,
                ['USN', 'Student_Name', 'Program', 'Course_code', 'Credits', 'CIE', 'SEE', 'TOT', 'GRD', 'GP', 'Status'],
                filteredLedger.map((r) => [
                  r.student_reg_no,
                  r.student_name,
                  r.program_code,
                  r.effective_course_code,
                  r.credits,
                  r.is_online_exempt ? 'EX' : r.cie_marks ?? '',
                  r.is_online_exempt ? 'EX' : r.see_marks ?? '',
                  r.is_online_exempt ? 'EX' : r.total_marks ?? '',
                  r.grade_code ?? '',
                  r.grade_point ?? '',
                  r.result_status,
                ])
              )
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export Results CSV
          </button>
          {subTab === 'SEMESTER' && (
            <button
              type="button"
              disabled={filteredSemester.length === 0}
              onClick={() => printGradeCards(filteredSemester)}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Grade Cards ({filteredSemester.length})
            </button>
          )}
        </div>
      </div>

      {/* SUB-TAB 1: CIE + DECODED SEE COURSE LEDGER */}
      {subTab === 'LEDGER' && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">USN & Student</th>
                  <th className="px-3 py-2.5 font-semibold">Course / Branch</th>
                  <th className="px-3 py-2.5 font-semibold">CIE</th>
                  <th className="px-3 py-2.5 font-semibold">SEE (Decoded)</th>
                  <th className="px-3 py-2.5 font-semibold text-center">TOT</th>
                  <th className="px-3 py-2.5 font-semibold text-center">GRD / GP</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingLedger ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Loading marks ledger...
                    </td>
                  </tr>
                ) : filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No marks rows yet. Click <strong>Sync Approved Registrations</strong> above or decode bundles
                      from the <strong>Bundles & Decoding</strong> tab.
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-slate-900">{r.student_reg_no}</span>
                        <p className="text-slate-600">{r.student_name}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-slate-900">{r.effective_course_code}</span>
                        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {r.program_code}
                        </span>
                        <p className="text-[11px] text-slate-500">{r.course_title}</p>
                      </td>
                      <td className="px-3 py-2">
                        {r.is_online_exempt ? (
                          <span className="text-slate-400">Exempt</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={r.cie_max_marks}
                            step="0.5"
                            disabled={!canEnterCie || r.is_published}
                            defaultValue={r.cie_marks ?? ''}
                            placeholder={`/${r.cie_max_marks}`}
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              const val = raw === '' ? null : Number(raw)
                              if (val !== r.cie_marks) {
                                updateMarkCellMutation.mutate({ id: r.id, cie_marks: val })
                              }
                            }}
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-xs font-mono disabled:bg-slate-100"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.is_online_exempt ? (
                          <span className="text-slate-400">Exempt</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            max={r.see_max_marks}
                            step="0.5"
                            disabled={!canPublish || r.is_published}
                            defaultValue={r.see_marks ?? ''}
                            placeholder={`/${r.see_max_marks}`}
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              const val = raw === '' ? null : Number(raw)
                              if (val !== r.see_marks) {
                                updateMarkCellMutation.mutate({ id: r.id, see_marks: val })
                              }
                            }}
                            className="w-20 rounded border border-slate-300 px-2 py-1 text-xs font-mono disabled:bg-slate-100"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 text-center font-mono font-bold text-slate-900">
                        {r.is_online_exempt ? 'EX' : r.total_marks ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-center font-mono">
                        <strong>{r.grade_code ?? '—'}</strong>
                        {r.grade_point !== null && <span className="text-slate-500"> ({r.grade_point})</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            RESULT_BADGES[r.result_status]
                          )}
                        >
                          {r.result_status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SEMESTER SGPA & PROVISIONAL GRADE CARDS */}
      {subTab === 'SEMESTER' && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">USN & Student</th>
                  <th className="px-4 py-2.5 font-semibold">Program / Sem</th>
                  <th className="px-4 py-2.5 font-semibold text-center">Courses (P/F)</th>
                  <th className="px-4 py-2.5 font-semibold text-center">Credits</th>
                  <th className="px-4 py-2.5 font-semibold text-center">SGPA</th>
                  <th className="px-4 py-2.5 font-semibold">Result</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Grade Card</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSemester.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Click <strong>Compute Grades & SGPA</strong> above to generate semester results.
                    </td>
                  </tr>
                ) : (
                  filteredSemester.map((sr) => (
                    <tr key={sr.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-slate-900">{sr.student_reg_no}</span>
                        <p className="text-slate-600">{sr.student_name}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="font-medium">{sr.program_code}</span> ({sr.program_level})
                        <p className="text-[11px] text-slate-500">{sr.period_name ?? '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="font-semibold text-emerald-700">{sr.passed_courses}</span> /{' '}
                        <span className="font-semibold text-red-600">{sr.failed_courses}</span>
                        <span className="text-slate-400"> (of {sr.total_courses})</span>
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono">
                        {sr.credits_earned} / {sr.credits_registered}
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono font-bold text-indigo-700">
                        {sr.sgpa.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            sr.overall_status === 'PASS'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : sr.overall_status === 'FAIL'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-amber-50 text-amber-800'
                          )}
                        >
                          {sr.overall_status}
                        </span>
                        {sr.is_published && (
                          <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                            Published
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => printGradeCards([sr])}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Printer className="h-3 w-3" />
                          Print A4
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
