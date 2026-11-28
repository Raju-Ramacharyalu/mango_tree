import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  Package,
  Play,
  Printer,
  Download,
  Upload,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  Trash2,
  Lock,
} from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  BundleStatus,
  EvaluatorStaffOption,
  ExamBundleScriptItem,
  ExamCycle,
  ExamScriptBundle,
  ProgramLevel,
  ScriptEvalStatus,
} from '@/types/exams'
import {
  buildCourseBranchBundles,
  normalizeCourseCode,
  type BundleSourceScript,
} from './bundleEngine'
import { fetchInstitutionBranding, openBrandedPrintWindow, renderBrandedHeaderHtml, renderSignatureBlockHtml, signPrivateAssets } from './printBranding'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  canDecode: boolean
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

const BUNDLE_STATUS_STYLES: Record<BundleStatus, string> = {
  CREATED: 'bg-slate-100 text-slate-700',
  DISPATCHED: 'bg-blue-50 text-blue-700',
  EVALUATED: 'bg-amber-50 text-amber-800',
  DECODED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  LOCKED: 'bg-purple-50 text-purple-800 border border-purple-200',
}

export function BundlesDecodingTab({ institutionId, institutionName, cycle, canDecode }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const [subTab, setSubTab] = useState<'BUNDLES' | 'EVALUATION'>('BUNDLES')
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'UG' | 'PG'>('ALL')
  const [maxBundleSize, setMaxBundleSize] = useState('30')
  const [splitSeriesBranches, setSplitSeriesBranches] = useState('CS, CSE')
  const [splitAllBranches, setSplitAllBranches] = useState(false)
  const [shuffleDummyCodes, setShuffleDummyCodes] = useState(true)
  const [includeUnseatedApproved, setIncludeUnseatedApproved] = useState(false)
  const [defaultSeeMax, setDefaultSeeMax] = useState('100')
  const [defaultSeeScale, setDefaultSeeScale] = useState('50')
  const [notice, setNotice] = useState<string | null>(null)

  // Evaluation / Decoding workspace state
  const [selectedBundleId, setSelectedBundleId] = useState('')
  const [revealUsn, setRevealUsn] = useState(false)
  const [evaluatorDraftName, setEvaluatorDraftName] = useState('')
  const [evaluatorStaffId, setEvaluatorStaffId] = useState('')

  const { data: staffOptions = [] } = useQuery<EvaluatorStaffOption[]>({
    queryKey: ['exam_evaluators', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, employee_code, full_name, department_label, is_evaluator')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('is_evaluator', { ascending: false })
        .order('full_name', { ascending: true })
      if (error) throw error
      return (data ?? []) as EvaluatorStaffOption[]
    },
  })

  const { data: bundles = [], isLoading: loadingBundles } = useQuery<ExamScriptBundle[]>({
    queryKey: ['exam_script_bundles', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_script_bundles')
        .select('*, course_catalog (title)')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('effective_course_code', { ascending: true })
        .order('program_code', { ascending: true })
        .order('usn_series_prefix', { ascending: true })
        .order('bundle_sequence', { ascending: true })
      if (error) throw error
      return (data ?? []).map((row) => {
        const cc = unwrap(row.course_catalog as { title: string } | { title: string }[] | null)
        return {
          id: row.id as string,
          institution_id: row.institution_id as string,
          exam_cycle_id: row.exam_cycle_id as string,
          course_id: row.course_id as string,
          effective_course_code: row.effective_course_code as string,
          course_title: cc?.title ?? '—',
          program_id: row.program_id as string,
          program_code: row.program_code as string,
          program_level: (row.program_level as ProgramLevel) ?? 'UG',
          usn_series_prefix: (row.usn_series_prefix as string | null) ?? null,
          bundle_code: row.bundle_code as string,
          bundle_sequence: Number(row.bundle_sequence ?? 1),
          max_bundle_size: Number(row.max_bundle_size ?? 30),
          script_count: Number(row.script_count ?? 0),
          see_max_marks: Number(row.see_max_marks ?? 100),
          see_scale_to: Number(row.see_scale_to ?? 50),
          evaluator_staff_id: (row.evaluator_staff_id as string | null) ?? null,
          evaluator_name: (row.evaluator_name as string | null) ?? null,
          status: row.status as BundleStatus,
          dispatched_at: (row.dispatched_at as string | null) ?? null,
          evaluated_at: (row.evaluated_at as string | null) ?? null,
          decoded_at: (row.decoded_at as string | null) ?? null,
          remarks: (row.remarks as string | null) ?? null,
          created_at: row.created_at as string,
        }
      })
    },
  })

  // Source scripts available to bundle (Present seats from Form B + optional approved unseated courses e.g. PG/Labs)
  const { data: sourceScripts = [] } = useQuery<BundleSourceScript[]>({
    queryKey: ['exam_bundle_sources', institutionId, cycle?.id, includeUnseatedApproved],
    enabled: Boolean(cycle?.id && canDecode),
    queryFn: async () => {
      const [seatsRes, existingScriptsRes] = await Promise.all([
        fetchAllRows<Record<string, unknown>>((from, to) =>
          supabase
            .from('exam_seat_allotments')
            .select(`
              id, registration_id, registration_course_id, student_id, course_id, program_id,
              effective_course_code, attendance_status, booklet_number,
              students (registration_number, full_name),
              course_catalog (course_code, title),
              programs (code, program_level)
            `)
            .eq('institution_id', institutionId)
            .eq('exam_cycle_id', cycle!.id)
            .in('attendance_status', ['PRESENT', 'MALPRACTICE'])
            .order('id', { ascending: true })
            .range(from, to)
        ).then((data) => ({ data, error: null as Error | null })),
        fetchAllRows<Record<string, unknown>>((from, to) =>
          supabase
            .from('exam_bundle_scripts')
            .select('registration_course_id')
            .eq('institution_id', institutionId)
            .eq('exam_cycle_id', cycle!.id)
            .order('id', { ascending: true })
            .range(from, to)
        ).then((data) => ({ data, error: null as Error | null })),
      ])

      if (seatsRes.error) throw seatsRes.error
      if (existingScriptsRes.error) throw existingScriptsRes.error

      const alreadyBundled = new Set((existingScriptsRes.data ?? []).map((r) => r.registration_course_id as string))
      const results: BundleSourceScript[] = []
      const seenRegCourse = new Set<string>()

      for (const row of seatsRes.data ?? []) {
        const rcId = row.registration_course_id as string
        if (alreadyBundled.has(rcId) || seenRegCourse.has(rcId)) continue
        seenRegCourse.add(rcId)

        const stu = unwrap(
          row.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null
        )
        const cc = unwrap(
          row.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null
        )
        const prog = unwrap(
          row.programs as { code: string; program_level: ProgramLevel } | { code: string; program_level: ProgramLevel }[] | null
        )
        results.push({
          seat_allotment_id: row.id as string,
          registration_id: row.registration_id as string,
          registration_course_id: rcId,
          student_id: row.student_id as string,
          student_reg_no: stu?.registration_number ?? '—',
          student_name: stu?.full_name ?? '—',
          course_id: row.course_id as string,
          course_code: normalizeCourseCode(cc?.course_code ?? ''),
          course_title: cc?.title ?? '—',
          effective_course_code: normalizeCourseCode(row.effective_course_code as string),
          program_id: row.program_id as string,
          program_code: prog?.code ?? '—',
          program_level: prog?.program_level ?? 'UG',
          booklet_number: (row.booklet_number as string | null) ?? null,
          is_malpractice: row.attendance_status === 'MALPRACTICE',
        })
      }

      if (includeUnseatedApproved) {
        const regCourses = await fetchAllRows<Record<string, unknown>>((from, to) =>
          supabase
            .from('exam_registration_courses')
            .select(`
              id, registration_id, student_id, course_id,
              course_catalog (course_code, title),
              exam_registrations!inner (
                status, program_id,
                students (registration_number, full_name),
                programs (code, program_level)
              )
            `)
            .eq('institution_id', institutionId)
            .eq('exam_cycle_id', cycle!.id)
            .eq('is_online_exempt', false)
            .eq('eligibility_status', 'ELIGIBLE')
            .order('id', { ascending: true })
            .range(from, to)
        )

        for (const rc of regCourses ?? []) {
          const rcId = rc.id as string
          if (alreadyBundled.has(rcId) || seenRegCourse.has(rcId)) continue
          const er = unwrap(rc.exam_registrations as Record<string, unknown> | Record<string, unknown>[] | null)
          if (!er || er.status !== 'APPROVED') continue
          seenRegCourse.add(rcId)

          const stu = unwrap(
            er.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null
          )
          const cc = unwrap(
            rc.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null
          )
          const prog = unwrap(
            er.programs as { code: string; program_level: ProgramLevel } | { code: string; program_level: ProgramLevel }[] | null
          )
          const code = normalizeCourseCode(cc?.course_code ?? '')
          results.push({
            seat_allotment_id: null,
            registration_id: rc.registration_id as string,
            registration_course_id: rcId,
            student_id: rc.student_id as string,
            student_reg_no: stu?.registration_number ?? '—',
            student_name: stu?.full_name ?? '—',
            course_id: rc.course_id as string,
            course_code: code,
            course_title: cc?.title ?? '—',
            effective_course_code: code,
            program_id: er.program_id as string,
            program_code: prog?.code ?? '—',
            program_level: prog?.program_level ?? 'UG',
            booklet_number: null,
            is_malpractice: false,
          })
        }
      }

      return results
    },
  })

  const filteredSourceScripts = useMemo(() => {
    if (levelFilter === 'ALL') return sourceScripts
    return sourceScripts.filter((s) => s.program_level === levelFilter)
  }, [sourceScripts, levelFilter])

  const plannedBundles = useMemo(() => {
    if (!cycle) return []
    const branches = splitSeriesBranches.split(',').map((b) => b.trim()).filter(Boolean)
    return buildCourseBranchBundles({
      scripts: filteredSourceScripts,
      maxBundleSize: Math.max(1, Number(maxBundleSize) || 30),
      splitSeriesBranches: branches,
      splitAllBranches,
      shuffleDummyCodes,
      cycleCode: cycle.code,
    })
  }, [filteredSourceScripts, maxBundleSize, splitSeriesBranches, splitAllBranches, shuffleDummyCodes, cycle])

  const filteredBundles = useMemo(() => {
    if (levelFilter === 'ALL') return bundles
    return bundles.filter((b) => b.program_level === levelFilter)
  }, [bundles, levelFilter])

  const activeBundle = useMemo(() => {
    if (selectedBundleId) return bundles.find((b) => b.id === selectedBundleId) ?? bundles[0] ?? null
    return bundles[0] ?? null
  }, [bundles, selectedBundleId])

  const { data: bundleScripts = [], isLoading: loadingScripts } = useQuery<ExamBundleScriptItem[]>({
    queryKey: ['exam_bundle_scripts', institutionId, activeBundle?.id],
    enabled: Boolean(activeBundle?.id && canDecode),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_bundle_scripts')
        .select('*, students (registration_number, full_name)')
        .eq('institution_id', institutionId)
        .eq('bundle_id', activeBundle!.id)
        .order('script_sequence', { ascending: true })
      if (error) throw error
      return (data ?? []).map((row) => {
        const stu = unwrap(
          row.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null
        )
        return {
          id: row.id as string,
          bundle_id: row.bundle_id as string,
          seat_allotment_id: (row.seat_allotment_id as string | null) ?? null,
          registration_id: row.registration_id as string,
          registration_course_id: row.registration_course_id as string,
          student_id: row.student_id as string,
          student_reg_no: stu?.registration_number ?? '—',
          student_name: stu?.full_name ?? '—',
          course_id: row.course_id as string,
          program_id: row.program_id as string,
          script_sequence: Number(row.script_sequence),
          dummy_code: row.dummy_code as string,
          booklet_number: (row.booklet_number as string | null) ?? null,
          see_marks_raw: row.see_marks_raw !== null ? Number(row.see_marks_raw) : null,
          see_marks_scaled: row.see_marks_scaled !== null ? Number(row.see_marks_scaled) : null,
          is_absent: Boolean(row.is_absent),
          is_malpractice: Boolean(row.is_malpractice),
          evaluation_status: row.evaluation_status as ScriptEvalStatus,
          evaluator_remarks: (row.evaluator_remarks as string | null) ?? null,
        }
      })
    },
  })

  const generateBundlesMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an exam cycle first.')
      if (plannedBundles.length === 0) throw new Error('No unbundled scripts found to generate.')

      const seeMax = Math.max(1, Number(defaultSeeMax) || 100)
      const seeScale = Math.max(1, Number(defaultSeeScale) || 50)
      const existingCodes = new Set(bundles.map((b) => b.bundle_code))

      let bundlesCreated = 0
      let scriptsCreated = 0

      for (const plan of plannedBundles) {
        let code = plan.bundle_code
        let seq = plan.bundle_sequence
        while (existingCodes.has(code)) {
          seq += 1
          const pad = String(seq).padStart(2, '0')
          code = plan.usn_series_prefix
            ? `${plan.effective_course_code}-${plan.program_code}-${plan.usn_series_prefix}-B${pad}`
            : `${plan.effective_course_code}-${plan.program_code}-B${pad}`
        }
        existingCodes.add(code)

        const { data: insertedBundle, error: bErr } = await supabase
          .from('exam_script_bundles')
          .insert({
            institution_id: institutionId,
            exam_cycle_id: cycle.id,
            course_id: plan.course_id,
            effective_course_code: plan.effective_course_code,
            program_id: plan.program_id,
            program_code: plan.program_code,
            program_level: plan.program_level,
            usn_series_prefix: plan.usn_series_prefix,
            bundle_code: code,
            bundle_sequence: seq,
            max_bundle_size: Math.max(1, Number(maxBundleSize) || 30),
            script_count: plan.scripts.length,
            see_max_marks: seeMax,
            see_scale_to: seeScale,
            status: 'CREATED',
            created_by: session?.user.id ?? null,
            updated_by: session?.user.id ?? null,
          })
          .select('id')
          .single()
        if (bErr) throw bErr
        bundlesCreated += 1

        const scriptRows = plan.scripts.map((s) => ({
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          bundle_id: insertedBundle.id as string,
          seat_allotment_id: s.seat_allotment_id,
          registration_id: s.registration_id,
          registration_course_id: s.registration_course_id,
          student_id: s.student_id,
          course_id: s.course_id,
          program_id: s.program_id,
          script_sequence: s.script_sequence,
          dummy_code: `${code}-${String(s.script_sequence).padStart(3, '0')}`,
          booklet_number: s.booklet_number,
          is_absent: false,
          is_malpractice: s.is_malpractice,
          evaluation_status: 'PENDING',
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        }))

        const chunkSize = 400
        for (let i = 0; i < scriptRows.length; i += chunkSize) {
          const { error: sErr } = await supabase
            .from('exam_bundle_scripts')
            .insert(scriptRows.slice(i, i + chunkSize))
          if (sErr) throw sErr
          scriptsCreated += Math.min(chunkSize, scriptRows.length - i)
        }
      }

      return { bundlesCreated, scriptsCreated }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['exam_script_bundles', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_bundle_sources', institutionId, cycle?.id] })
      setNotice(
        `Generated ${res.bundlesCreated} Course-Branch bundles (${res.scriptsCreated} coded answer scripts). Open "Evaluator Marks Entry" to assign evaluators, enter/import SEE marks, and decode.`
      )
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : 'Failed to generate bundles')
    },
  })

  const updateBundleEvaluatorMutation = useMutation({
    mutationFn: async ({
      bundleId,
      staffId,
      evaluatorName,
      status,
    }: {
      bundleId: string
      staffId: string | null
      evaluatorName: string | null
      status?: BundleStatus
    }) => {
      const patch: Record<string, unknown> = {
        evaluator_staff_id: staffId,
        evaluator_name: evaluatorName?.trim() || null,
        updated_by: session?.user.id ?? null,
      }
      if (status) {
        patch.status = status
        if (status === 'DISPATCHED') patch.dispatched_at = new Date().toISOString()
        if (status === 'EVALUATED') patch.evaluated_at = new Date().toISOString()
      }
      const { error } = await supabase.from('exam_script_bundles').update(patch).eq('id', bundleId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_script_bundles', institutionId, cycle?.id] })
      setNotice('Evaluator assignment saved — printable marks sheets and CSV exports now reflect this evaluator.')
    },
  })

  const updateScriptMarkMutation = useMutation({
    mutationFn: async ({
      scriptId,
      rawMarks,
      seeMax,
      seeScaleTo,
    }: {
      scriptId: string
      rawMarks: number | null
      seeMax: number
      seeScaleTo: number
    }) => {
      if (rawMarks !== null && (rawMarks < 0 || rawMarks > seeMax)) {
        throw new Error(`Marks must be between 0 and ${seeMax}.`)
      }
      const scaled =
        rawMarks !== null ? Number(((rawMarks / Math.max(1, seeMax)) * seeScaleTo).toFixed(2)) : null
      const { error } = await supabase
        .from('exam_bundle_scripts')
        .update({
          see_marks_raw: rawMarks,
          see_marks_scaled: scaled,
          evaluation_status: rawMarks !== null ? 'ENTERED' : 'PENDING',
          updated_by: session?.user.id ?? null,
        })
        .eq('id', scriptId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_bundle_scripts', institutionId, activeBundle?.id] })
    },
  })

  const decodeBundleMutation = useMutation({
    mutationFn: async (bundle: ExamScriptBundle) => {
      if (!cycle) throw new Error('No active cycle.')
      if (bundleScripts.length === 0) throw new Error('No scripts found in this bundle.')

      // Fetch course credits & max CIE marks so exam_course_results rows initialize cleanly
      const { data: courseInfo } = await supabase
        .from('course_catalog')
        .select('default_credits, course_categories (default_max_cie, default_max_see)')
        .eq('id', bundle.course_id)
        .single()

      const cat = unwrap(
        courseInfo?.course_categories as
          | { default_max_cie: number; default_max_see: number }
          | { default_max_cie: number; default_max_see: number }[]
          | null
      )
      const credits = Number(courseInfo?.default_credits ?? 3)
      const cieMax = Number(cat?.default_max_cie ?? 50)
      const seeMaxScaled = Number(bundle.see_scale_to || cat?.default_max_see || 50)

      // Fetch existing course results to preserve already-entered CIE marks
      const rcIds = bundleScripts.map((s) => s.registration_course_id)
      const { data: existingRows } = await supabase
        .from('exam_course_results')
        .select('registration_course_id, cie_marks, cie_max_marks')
        .eq('exam_cycle_id', cycle.id)
        .in('registration_course_id', rcIds)

      const cieMap = new Map<string, { cie: number | null; cieMax: number }>()
      for (const r of existingRows ?? []) {
        cieMap.set(r.registration_course_id as string, {
          cie: r.cie_marks !== null ? Number(r.cie_marks) : null,
          cieMax: Number(r.cie_max_marks ?? cieMax),
        })
      }

      const upsertRows = bundleScripts.map((s) => {
        const existingCie = cieMap.get(s.registration_course_id)
        const rowCieMax = existingCie?.cieMax ?? cieMax
        const seeVal =
          s.see_marks_scaled !== null
            ? s.see_marks_scaled
            : s.see_marks_raw !== null
              ? Number(((s.see_marks_raw / Math.max(1, bundle.see_max_marks)) * seeMaxScaled).toFixed(2))
              : null
        return {
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          registration_id: s.registration_id,
          registration_course_id: s.registration_course_id,
          student_id: s.student_id,
          course_id: s.course_id,
          program_id: s.program_id,
          effective_course_code: bundle.effective_course_code,
          credits,
          is_online_exempt: false,
          cie_marks: existingCie?.cie ?? null,
          cie_max_marks: rowCieMax,
          see_marks: seeVal,
          see_max_marks: seeMaxScaled,
          max_total_marks: rowCieMax + seeMaxScaled,
          result_status: s.is_malpractice ? 'MALPRACTICE' : s.is_absent ? 'ABSENT' : 'PENDING',
          source_bundle_id: bundle.id,
          updated_by: session?.user.id ?? null,
        }
      })

      const chunkSize = 400
      for (let i = 0; i < upsertRows.length; i += chunkSize) {
        const { error: upErr } = await supabase
          .from('exam_course_results')
          .upsert(upsertRows.slice(i, i + chunkSize), { onConflict: 'exam_cycle_id,registration_course_id' })
        if (upErr) throw upErr
      }

      const { error: scriptUpdErr } = await supabase
        .from('exam_bundle_scripts')
        .update({ evaluation_status: 'DECODED', updated_by: session?.user.id ?? null })
        .eq('bundle_id', bundle.id)
      if (scriptUpdErr) throw scriptUpdErr

      const { error: bUpdErr } = await supabase
        .from('exam_script_bundles')
        .update({
          status: 'DECODED',
          decoded_at: new Date().toISOString(),
          updated_by: session?.user.id ?? null,
        })
        .eq('id', bundle.id)
      if (bUpdErr) throw bUpdErr

      return upsertRows.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['exam_script_bundles', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_bundle_scripts', institutionId, activeBundle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_course_results', institutionId, cycle?.id] })
      setNotice(
        `Decoded ${count} scripts from bundle ${activeBundle?.bundle_code} directly into the Marks & Results ledger.`
      )
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : 'Failed to decode bundle')
    },
  })

  const deleteBundleMutation = useMutation({
    mutationFn: async (bundleId: string) => {
      const { error } = await supabase.from('exam_script_bundles').delete().eq('id', bundleId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_script_bundles', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_bundle_sources', institutionId, cycle?.id] })
    },
  })

  const handleImportMarksCsv = (file: File) => {
    if (!activeBundle) return
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        const scriptByDummy = new Map(bundleScripts.map((s) => [s.dummy_code.trim().toUpperCase(), s]))
        let updated = 0
        let evaluatorFromCsv: string | null = null

        for (const row of parsed.data) {
          const dummy = (row.Dummy_Code || row.dummy_code || row.CODE || '').trim().toUpperCase()
          const marksStr = (row.SEE_Raw_Marks || row.SEE_Marks || row.Marks || row.SEE || '').trim()
          const evalName = (row.Evaluator_Name || row.evaluator_name || '').trim()
          if (evalName && !evaluatorFromCsv) evaluatorFromCsv = evalName

          const target = scriptByDummy.get(dummy)
          if (!target || marksStr === '') continue
          const num = Number(marksStr)
          if (Number.isNaN(num) || num < 0 || num > activeBundle.see_max_marks) continue

          const scaled = Number(((num / Math.max(1, activeBundle.see_max_marks)) * activeBundle.see_scale_to).toFixed(2))
          const { error } = await supabase
            .from('exam_bundle_scripts')
            .update({
              see_marks_raw: num,
              see_marks_scaled: scaled,
              evaluation_status: 'ENTERED',
              updated_by: session?.user.id ?? null,
            })
            .eq('id', target.id)
          if (!error) updated += 1
        }

        if (evaluatorFromCsv && evaluatorFromCsv !== activeBundle.evaluator_name) {
          await supabase
            .from('exam_script_bundles')
            .update({ evaluator_name: evaluatorFromCsv, updated_by: session?.user.id ?? null })
            .eq('id', activeBundle.id)
        }

        queryClient.invalidateQueries({ queryKey: ['exam_bundle_scripts', institutionId, activeBundle.id] })
        queryClient.invalidateQueries({ queryKey: ['exam_script_bundles', institutionId, cycle?.id] })
        setNotice(
          `Imported SEE marks for ${updated} scripts into ${activeBundle.bundle_code}${
            evaluatorFromCsv ? ` (Evaluator: ${evaluatorFromCsv})` : ''
          }.`
        )
      },
    })
  }

  const printEvaluatorMarksSheet = async (includeDecodingKey: boolean) => {
    if (!cycle || !activeBundle) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigs = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? sigs.get(branding.coe_signature_path) : null

    const evalName = evaluatorDraftName.trim() || activeBundle.evaluator_name || '________________________'
    const titleText = includeDecodingKey
      ? 'COE CONFIDENTIAL CODING & DECODING KEY SHEET'
      : 'BLIND EVALUATOR MARKS ENTRY SHEET'

    const rowsHtml = bundleScripts
      .map(
        (s) => `<tr>
          <td style="text-align:center">${s.script_sequence}</td>
          <td style="font-family:monospace;font-weight:700">${escapeHtml(s.dummy_code)}</td>
          ${
            includeDecodingKey
              ? `<td style="font-family:monospace;font-weight:700">${escapeHtml(s.student_reg_no)}</td><td>${escapeHtml(s.student_name)}</td>`
              : ''
          }
          <td style="text-align:center">${s.see_marks_raw !== null ? s.see_marks_raw : ''}</td>
          <td style="text-align:center">${s.see_marks_scaled !== null ? s.see_marks_scaled : ''}</td>
          <td>${s.is_malpractice ? 'MP' : escapeHtml(s.evaluator_remarks ?? '')}</td>
        </tr>`
      )
      .join('')

    openBrandedPrintWindow({
      title: `${activeBundle.bundle_code} — ${titleText}`,
      landscape: false,
      branding,
      watermarkMode: 'fixed',
      extraCss: `.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 6px 10px; margin-bottom: 10px; font-size: 10.5px; }`,
      bodyHtml: `
        ${renderBrandedHeaderHtml(branding, titleText, `${cycle.name} (${cycle.code})`)}
        <div class="meta-grid">
          <span><strong>Bundle ID:</strong> ${escapeHtml(activeBundle.bundle_code)}</span>
          <span><strong>Course:</strong> ${escapeHtml(activeBundle.effective_course_code)} — ${escapeHtml(activeBundle.course_title)}</span>
          <span><strong>Branch / Level:</strong> ${escapeHtml(activeBundle.program_code)} (${escapeHtml(activeBundle.program_level)})${activeBundle.usn_series_prefix ? ` · Series ${escapeHtml(activeBundle.usn_series_prefix)}` : ''}</span>
          <span><strong>Script Count:</strong> ${bundleScripts.length} · Max SEE: ${activeBundle.see_max_marks} (Scaled to ${activeBundle.see_scale_to})</span>
          <span style="grid-column:span 2"><strong>Evaluator Name:</strong> ${escapeHtml(evalName)}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:36px">Sl.</th>
              <th style="width:170px">Dummy Script Code</th>
              ${includeDecodingKey ? '<th style="width:115px">USN</th><th>Candidate Name</th>' : ''}
              <th style="width:90px;text-align:center">SEE Marks (/${activeBundle.see_max_marks})</th>
              <th style="width:90px;text-align:center">Scaled (/${activeBundle.see_scale_to})</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="signatures">
          ${renderSignatureBlockHtml(`Evaluator: ${evalName}`, null)}
          ${renderSignatureBlockHtml('Chief Valuator / Custodian', null)}
          ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSigUrl)}
        </div>
      `,
    })
  }

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to generate Course-Branch Answer Script Bundles.
      </div>
    )
  }

  if (!canDecode) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Confidential Script Coding & Decoding is restricted to <strong>Controller of Examinations (COE)</strong>,{' '}
        <strong>Principal</strong>, and <strong>Institution Admins</strong>.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Course-Branch Bundles & Confidential Decoding — {cycle.code}
          </h2>
          <p className="text-xs text-slate-500">
            Bundles are grouped by Course Code + Branch (zero room names), support UG & PG courses, and split CS
            scripts into separate <span className="font-mono">1AM</span> / <span className="font-mono">1AX</span>{' '}
            series bundles.
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSubTab('BUNDLES')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium',
              subTab === 'BUNDLES' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <Package className="h-3.5 w-3.5" />
            Bundle Generator ({bundles.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('EVALUATION')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium',
              subTab === 'EVALUATION' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Evaluator Marks & Decoding
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-600" />
          {notice}
        </div>
      )}

      {/* SUB-TAB 1: COURSE-BRANCH BUNDLE GENERATOR */}
      {subTab === 'BUNDLES' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Program Level</label>
                <select
                  value={levelFilter}
                  onChange={(e) => setLevelFilter(e.target.value as 'ALL' | 'UG' | 'PG')}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="ALL">All Levels (UG & PG)</option>
                  <option value="UG">UG Only</option>
                  <option value="PG">PG Only</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Max Scripts / Bundle</label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={maxBundleSize}
                  onChange={(e) => setMaxBundleSize(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Split USN Series Branches (e.g. 1AM/1AX)
                </label>
                <input
                  type="text"
                  value={splitSeriesBranches}
                  onChange={(e) => setSplitSeriesBranches(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">SEE Raw Max</label>
                <input
                  type="number"
                  min={10}
                  value={defaultSeeMax}
                  onChange={(e) => setDefaultSeeMax(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Scale SEE To</label>
                <input
                  type="number"
                  min={10}
                  value={defaultSeeScale}
                  onChange={(e) => setDefaultSeeScale(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={shuffleDummyCodes}
                    onChange={(e) => setShuffleDummyCodes(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  Shuffle Script Order for Blind Dummy Coding
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={splitAllBranches}
                    onChange={(e) => setSplitAllBranches(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  Split USN Series on All Branches
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeUnseatedApproved}
                    onChange={(e) => setIncludeUnseatedApproved(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  Include Unseated Approved Courses (PG/Labs)
                </label>
              </div>

              <button
                type="button"
                disabled={generateBundlesMutation.isPending || plannedBundles.length === 0}
                onClick={() => generateBundlesMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
                {generateBundlesMutation.isPending
                  ? 'Creating Bundles...'
                  : `Generate ${plannedBundles.length} New Bundle${plannedBundles.length === 1 ? '' : 's'} (${filteredSourceScripts.length} scripts)`}
              </button>
            </div>
          </div>

          {/* Pending Preview if unbundled scripts exist */}
          {plannedBundles.length > 0 && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
              <p className="text-xs font-semibold text-indigo-900">
                Ready to Bundle ({plannedBundles.length} Course-Branch bundles from Form B Present Scripts):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {plannedBundles.slice(0, 18).map((pb) => (
                  <span
                    key={pb.bundle_code}
                    className="rounded-md bg-white border border-indigo-200 px-2 py-1 text-[11px] font-mono text-slate-800"
                  >
                    <strong>{pb.bundle_code}</strong> ({pb.scripts.length}) · {pb.program_level}
                  </span>
                ))}
                {plannedBundles.length > 18 && (
                  <span className="text-xs text-indigo-700 self-center">
                    +{plannedBundles.length - 18} more bundles
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Existing Bundles Ledger */}
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Bundle ID (Course-Branch)</th>
                    <th className="px-4 py-2.5 font-semibold">Course / Branch</th>
                    <th className="px-4 py-2.5 font-semibold text-center">Scripts</th>
                    <th className="px-4 py-2.5 font-semibold">Assigned Evaluator</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingBundles ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Loading script bundles...
                      </td>
                    </tr>
                  ) : filteredBundles.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No answer script bundles created for {cycle.code} yet.
                      </td>
                    </tr>
                  ) : (
                    filteredBundles.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedBundleId(b.id)
                              setEvaluatorDraftName(b.evaluator_name ?? '')
                              setEvaluatorStaffId(b.evaluator_staff_id ?? '')
                              setSubTab('EVALUATION')
                            }}
                            className="font-mono font-semibold text-indigo-700 hover:underline text-left"
                          >
                            {b.bundle_code}
                          </button>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              {b.program_level}
                            </span>
                            {b.usn_series_prefix && (
                              <span className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-amber-800">
                                Series {b.usn_series_prefix}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-semibold text-slate-900">{b.effective_course_code}</span>
                          <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                            {b.program_code}
                          </span>
                          <p className="text-slate-500 mt-0.5">{b.course_title}</p>
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-900">{b.script_count}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {b.evaluator_name || <span className="text-slate-400">Unassigned</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              BUNDLE_STATUS_STYLES[b.status]
                            )}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBundleId(b.id)
                                setEvaluatorDraftName(b.evaluator_name ?? '')
                                setEvaluatorStaffId(b.evaluator_staff_id ?? '')
                                setSubTab('EVALUATION')
                              }}
                              className="rounded bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
                            >
                              Marks / Decode
                            </button>
                            {b.status === 'CREATED' && (
                              <button
                                type="button"
                                title="Delete un-evaluated bundle"
                                onClick={() => {
                                  if (window.confirm(`Delete bundle ${b.bundle_code}? Scripts will return to unbundled pool.`)) {
                                    deleteBundleMutation.mutate(b.id)
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: EVALUATOR MARKS ENTRY, CSV IMPORT/EXPORT & DECODING */}
      {subTab === 'EVALUATION' && (
        <div className="space-y-4">
          {!activeBundle ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
              Generate Course-Branch bundles first to enter SEE marks and decode scripts.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Active Bundle</label>
                    <select
                      value={activeBundle.id}
                      onChange={(e) => {
                        const found = bundles.find((b) => b.id === e.target.value)
                        setSelectedBundleId(e.target.value)
                        setEvaluatorDraftName(found?.evaluator_name ?? '')
                        setEvaluatorStaffId(found?.evaluator_staff_id ?? '')
                      }}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono font-medium"
                    >
                      {bundles.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bundle_code} ({b.script_count} scripts · {b.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Select Evaluator (Staff Directory)
                    </label>
                    <select
                      value={evaluatorStaffId}
                      onChange={(e) => {
                        const id = e.target.value
                        setEvaluatorStaffId(id)
                        const staff = staffOptions.find((s) => s.id === id)
                        if (staff) setEvaluatorDraftName(staff.full_name)
                      }}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                    >
                      <option value="">External / Custom Evaluator Name...</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name} ({s.employee_code}
                          {s.department_label ? ` · ${s.department_label}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Evaluator Name (Populates Print & CSV Sheets)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="Dr. / Prof. Evaluator Name"
                        value={evaluatorDraftName}
                        onChange={(e) => setEvaluatorDraftName(e.target.value)}
                        className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateBundleEvaluatorMutation.mutate({
                            bundleId: activeBundle.id,
                            staffId: evaluatorStaffId || null,
                            evaluatorName: evaluatorDraftName,
                            status: activeBundle.status === 'CREATED' ? 'DISPATCHED' : undefined,
                          })
                        }
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRevealUsn((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {revealUsn ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {revealUsn ? 'Hide USNs (Blind Mode)' : 'Reveal USNs (COE Key)'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(
                          `${activeBundle.bundle_code}_Evaluator_Marks_Sheet.csv`,
                          ['Bundle_Code', 'Evaluator_Name', 'Sl_No', 'Dummy_Code', 'SEE_Max', 'SEE_Raw_Marks', 'Remarks'],
                          bundleScripts.map((s) => [
                            activeBundle.bundle_code,
                            evaluatorDraftName.trim() || activeBundle.evaluator_name || '',
                            s.script_sequence,
                            s.dummy_code,
                            activeBundle.see_max_marks,
                            s.see_marks_raw ?? '',
                            s.evaluator_remarks ?? '',
                          ])
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export Marks CSV
                    </button>

                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleImportMarksCsv(file)
                        e.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => csvInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Import Marks CSV
                    </button>

                    <button
                      type="button"
                      onClick={() => printEvaluatorMarksSheet(false)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      Print Evaluator Sheet
                    </button>

                    <button
                      type="button"
                      onClick={() => printEvaluatorMarksSheet(true)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Print COE Decoding Key
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={decodeBundleMutation.isPending || activeBundle.status === 'LOCKED'}
                    onClick={() => decodeBundleMutation.mutate(activeBundle)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {decodeBundleMutation.isPending ? 'Decoding...' : 'Decode Bundle to Results'}
                  </button>
                </div>
              </div>

              {/* Blind / Decoded Scripts Table */}
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold w-12">Sl.</th>
                        <th className="px-3 py-2.5 font-semibold">Dummy Code</th>
                        {revealUsn && <th className="px-3 py-2.5 font-semibold">Decoded USN & Name</th>}
                        <th className="px-3 py-2.5 font-semibold">SEE Raw (/{activeBundle.see_max_marks})</th>
                        <th className="px-3 py-2.5 font-semibold">Scaled (/{activeBundle.see_scale_to})</th>
                        <th className="px-3 py-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadingScripts ? (
                        <tr>
                          <td colSpan={revealUsn ? 6 : 5} className="px-4 py-8 text-center text-slate-500">
                            Loading bundle scripts...
                          </td>
                        </tr>
                      ) : (
                        bundleScripts.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-500">{s.script_sequence}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900">{s.dummy_code}</td>
                            {revealUsn && (
                              <td className="px-3 py-2">
                                <span className="font-mono font-semibold text-indigo-800">{s.student_reg_no}</span>
                                <span className="ml-2 text-slate-600">{s.student_name}</span>
                              </td>
                            )}
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={0}
                                max={activeBundle.see_max_marks}
                                step="0.5"
                                disabled={activeBundle.status === 'LOCKED'}
                                defaultValue={s.see_marks_raw ?? ''}
                                placeholder="0–100"
                                onBlur={(e) => {
                                  const rawStr = e.target.value.trim()
                                  const parsed = rawStr === '' ? null : Number(rawStr)
                                  if (parsed !== s.see_marks_raw) {
                                    updateScriptMarkMutation.mutate({
                                      scriptId: s.id,
                                      rawMarks: parsed,
                                      seeMax: activeBundle.see_max_marks,
                                      seeScaleTo: activeBundle.see_scale_to,
                                    })
                                  }
                                }}
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-xs font-mono disabled:bg-slate-100"
                              />
                            </td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-800">
                              {s.see_marks_scaled !== null ? s.see_marks_scaled : '—'}
                            </td>
                            <td className="px-3 py-2">
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                {s.is_malpractice ? 'MALPRACTICE' : s.evaluation_status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
