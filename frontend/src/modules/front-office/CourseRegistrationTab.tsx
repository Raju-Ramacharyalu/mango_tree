import { useMemo, useRef, useState } from 'react'
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
}

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function computeSummerFee(items: Array<{ summerRule: 'RULE_1' | 'RULE_2' | 'RULE_3' }>): number {
  if (items.length === 0) return 0
  let total = 400
  let rule2Count = 0
  for (const item of items) {
    if (item.summerRule === 'RULE_1') total += 5600
    else if (item.summerRule === 'RULE_2') {
      rule2Count += 1
      total += rule2Count === 1 ? 2000 : 1000
    } else {
      total += 600
    }
  }
  return total
}

function computeOdeFee(items: Array<{ attemptNum: number }>): {
  att1Count: number
  att2Count: number
  total: number
} {
  if (items.length === 0) return { att1Count: 0, att2Count: 0, total: 0 }
  const att1Count = items.filter((i) => i.attemptNum <= 1).length
  const att2Count = items.filter((i) => i.attemptNum > 1).length
  return {
    att1Count,
    att2Count,
    total: att1Count * 6000 + att2Count * 3000 + 100 + 600,
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
  const { session } = useAppStore()
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const [mode, setMode] = useState<'PHASE1' | 'SUMMER' | 'ODE'>('PHASE1')
  const [academicYear, setAcademicYear] = useState('2026-27')
  const [activeTerm, setActiveTerm] = useState<'ODD' | 'EVEN'>('ODD')
  const [targetId, setTargetId] = useState('')
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([])
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

  // Fetch student's historical failed courses + prior ODE attempts for Summer & ODE modes
  const { data: failedCandidates = [] } = useQuery<FailedCourseCandidate[]>({
    queryKey: ['student_failed_history', institutionId, activeStudent?.id, cycle?.id],
    enabled: Boolean(activeStudent && (mode === 'SUMMER' || mode === 'ODE')),
    queryFn: async () => {
      const [resHist, priorOdeRes] = await Promise.all([
        supabase
          .from('exam_course_results')
          .select(`
            course_id, effective_course_code, credits, cie_marks, grade_code, result_status, updated_at,
            course_catalog (title)
          `)
          .eq('institution_id', institutionId)
          .eq('student_id', activeStudent!.id)
          .order('updated_at', { ascending: false }),
        supabase
          .from('exam_registration_courses')
          .select('course_id, exam_cycle_id, registration_category')
          .eq('institution_id', institutionId)
          .eq('student_id', activeStudent!.id),
      ])
      if (resHist.error) throw resHist.error
      if (priorOdeRes.error) throw priorOdeRes.error

      const odeCounts = new Map<string, number>()
      for (const row of priorOdeRes.data ?? []) {
        if (row.exam_cycle_id === cycle?.id) continue
        const cat = String(row.registration_category ?? '').toUpperCase()
        if (cat.includes('ODE')) {
          odeCounts.set(row.course_id as string, (odeCounts.get(row.course_id as string) ?? 0) + 1)
        }
      }

      const latestByCourse = new Map<string, Record<string, unknown>>()
      for (const row of resHist.data ?? []) {
        const cid = row.course_id as string
        if (!latestByCourse.has(cid)) latestByCourse.set(cid, row as Record<string, unknown>)
      }

      const cieThreshold = activeStudent!.program_level.toUpperCase() === 'PG' ? 25 : 20
      const out: FailedCourseCandidate[] = []

      for (const [courseId, row] of latestByCourse.entries()) {
        const status = String(row.result_status ?? '')
        if (!['FAIL', 'ABSENT', 'MALPRACTICE'].includes(status)) continue
        const cie = Number(row.cie_marks ?? 0)
        const grade = String(row.grade_code ?? (status === 'ABSENT' ? 'AB' : 'F')).toUpperCase()
        const cc = unwrap(row.course_catalog as { title: string } | { title: string }[] | null)

        let summerRule: 'RULE_1' | 'RULE_2' | 'RULE_3' = 'RULE_3'
        let summerRuleLabel = 'Rule 3: Exam Only (SEE Fail / MP)'
        if (cie < cieThreshold) {
          summerRule = 'RULE_1'
          summerRuleLabel = 'Rule 1: Mandatory Classes (CIE Fail)'
        } else if (grade === 'AB' || status === 'ABSENT') {
          summerRule = 'RULE_2'
          summerRuleLabel = 'Rule 2: Exam Only (Absent)'
        }

        out.push({
          course_id: courseId,
          course_code: String(row.effective_course_code ?? ''),
          course_title: cc?.title ?? 'Course',
          credits: Number(row.credits ?? 3),
          cie_marks: cie,
          grade_code: grade,
          summerRule,
          summerRuleLabel,
          priorOdeAttempts: odeCounts.get(courseId) ?? 0,
        })
      }

      return out.sort((a, b) => a.course_code.localeCompare(b.course_code))
    },
  })

  const parityMismatch =
    activeStudent &&
    mode === 'PHASE1' &&
    ((activeStudent.current_sem % 2 !== 0) !== (activeTerm === 'ODD'))

  const toggleCourse = (id: string) => {
    setSelectedCourseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const savePhase1Mutation = useMutation({
    mutationFn: async () => {
      if (!activeStudent || !activeStudent.program_id) {
        throw new Error('Select a valid student with an active program enrollment.')
      }
      if (parityMismatch) {
        throw new Error(
          `Term parity mismatch: Active term is ${activeTerm}, but student is in Semester ${activeStudent.current_sem}.`
        )
      }
      if (selectedCourseIds.length === 0) throw new Error('Select at least one course.')

      const selectedObjs = catalogCourses.filter((c) => selectedCourseIds.includes(c.id))
      const payload = selectedObjs.map((c) => ({
        institution_id: institutionId,
        academic_year: academicYear.trim(),
        term: activeTerm,
        student_id: activeStudent.id,
        program_id: activeStudent.program_id!,
        academic_period_id: activeStudent.current_period_id,
        semester_number: activeStudent.current_sem,
        course_id: c.id,
        course_code: c.course_code,
        course_type: c.is_online ? 'ONLINE' : (c.category_code ?? 'CORE'),
        credits: c.default_credits,
        registration_source: 'MANUAL',
        status: 'ACTIVE',
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      }))

      const { error } = await supabase
        .from('academic_course_registrations')
        .upsert(payload, { onConflict: 'institution_id,academic_year,term,student_id,course_id' })
      if (error) throw error
      return selectedObjs
    },
    onSuccess: (courses) => {
      setErrorMsg(null)
      setNotice(
        `Registered ${activeStudent?.registration_number} for ${courses.length} Phase 1 courses (${academicYear} ${activeTerm}).`
      )
    },
    onError: (err) => {
      setNotice(null)
      setErrorMsg(err instanceof Error ? err.message : 'Phase 1 registration failed')
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

          for (const rec of parsed.data) {
            const usn = (rec.usn || rec.USN || rec.Registration_Number || '').trim().toUpperCase()
            const code = (rec.course_code || rec.Course_Code || rec.COURSE_CODE || '').trim().toUpperCase()
            const stu = studentByLookup.get(usn)
            const crs = courseByCode.get(code)
            if (!stu || !stu.program_id || !crs) {
              skipped += 1
              continue
            }
            rows.push({
              institution_id: institutionId,
              academic_year: academicYear.trim(),
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
          setNotice(`Bulk CSV sync complete: ${rows.length} course rows saved${skipped ? ` (${skipped} unmatched skipped)` : ''}.`)
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Bulk CSV import failed')
        }
      },
    })
  }

  const saveSpecialCycleMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select a working Exam Cycle in the sidebar first.')
      if (!activeStudent || !activeStudent.program_id) throw new Error('Select a valid student first.')

      const chosen = failedCandidates.filter((c) => selectedCourseIds.includes(c.course_id))
      if (chosen.length === 0) throw new Error('Select at least one eligible failed course.')

      let totalFee = 0
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
        totalFee = computeSummerFee(chosen)
      } else {
        const odeItems = chosen.map((c) => ({
          attemptNum: odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1),
        }))
        totalFee = computeOdeFee(odeItems).total
      }

      const { data: regRow, error: regErr } = await supabase
        .from('exam_registrations')
        .upsert(
          {
            institution_id: institutionId,
            exam_cycle_id: cycle.id,
            student_id: activeStudent.id,
            program_id: activeStudent.program_id,
            academic_period_id: activeStudent.current_period_id,
            registration_type: mode === 'SUMMER' ? 'SUMMER' : 'ODE',
            status: 'SUBMITTED',
            payment_status: utrRef.trim() ? 'PAID' : 'PENDING',
            payment_reference: utrRef.trim().toUpperCase() || null,
            total_fee: totalFee,
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

      const coursePayloads = chosen.map((c) => {
        const att =
          mode === 'ODE'
            ? (odeAttemptChoice[c.course_id] ?? (c.priorOdeAttempts >= 1 ? 2 : 1))
            : 1
        return {
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          registration_id: regRow.id as string,
          student_id: activeStudent.id,
          course_id: c.course_id,
          attempt_number: att,
          registration_category: mode === 'SUMMER' ? 'SUMMER' : 'ODE',
          rule_category:
            mode === 'SUMMER'
              ? c.summerRuleLabel
              : att === 1
                ? 'Attempt 1 (Rs 6000)'
                : 'Attempt 2+ (Rs 3000)',
          is_online_exempt: false,
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

      return { count: chosen.length, totalFee }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setNotice(
        `Saved ${mode} application for ${activeStudent?.registration_number} (${res.count} courses · ₹${res.totalFee.toLocaleString('en-IN')}) directly to ${cycle?.code}.`
      )
      queryClient.invalidateQueries({ queryKey: ['exam_cycle_stats', institutionId, cycle?.id] })
    },
    onError: (err) => {
      setNotice(null)
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit special cycle registration')
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
        ? `COURSE REGISTRATION FORM — ${activeTerm} SEMESTER ${academicYear}`
        : mode === 'SUMMER'
          ? `SUMMER SEMESTER APPLICATION FORM — ${cycle?.code ?? academicYear}`
          : `ON-DEMAND EXAMINATION (ODE) APPLICATION — ${cycle?.code ?? academicYear}`

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
      const picked = catalogCourses.filter((c) => selectedCourseIds.includes(c.id))
      const totalCr = picked.reduce((s, c) => s + c.default_credits, 0)
      rowsHtml = picked
        .map(
          (c, idx) => `<tr>
            <td style="text-align:center">${idx + 1}</td>
            <td style="font-family:monospace;font-weight:700">${escapeHtml(c.course_code)}</td>
            <td>${escapeHtml(c.title)}</td>
            <td style="text-align:center">${c.default_credits}</td>
            <td style="text-align:center">Registered</td>
          </tr>`
        )
        .join('')
      footerSummary = `<tr style="font-weight:700;background:#f8fafc"><td colspan="3" style="text-align:right">Total Credits</td><td style="text-align:center">${totalCr}</td><td></td></tr>`
    } else {
      const picked = failedCandidates.filter((c) => selectedCourseIds.includes(c.course_id))
      const feeTotal =
        mode === 'SUMMER'
          ? computeSummerFee(picked)
          : computeOdeFee(
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
              <tr><th>USN / Admin No.</th><th>Student Name</th><th>Branch / Track</th><th>Sem</th><th style="width:110px;text-align:center">Photo</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-family:monospace;font-weight:700">${escapeHtml(activeStudent.registration_number)}</td>
                <td><strong>${escapeHtml(activeStudent.full_name)}</strong></td>
                <td>${escapeHtml(activeStudent.program_code)}${activeStudent.specialization_code !== 'GENERAL' ? ` (${escapeHtml(activeStudent.specialization_code)})` : ''}</td>
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
  const summerTotalFee = computeSummerFee(chosenFailed)
  const odeSummary = computeOdeFee(
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
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium"
              placeholder="2026-27"
            />
            <select
              value={activeTerm}
              onChange={(e) => setActiveTerm(e.target.value as 'ODD' | 'EVEN')}
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
          <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-900 flex flex-wrap gap-3">
            <strong>{activeStudent.full_name}</strong>
            <span>USN: {activeStudent.registration_number}</span>
            <span>Branch: {activeStudent.program_code} ({activeStudent.program_level})</span>
            <span>Sem: {activeStudent.current_sem}</span>
            <span>Category: {activeStudent.student_category}</span>
            {activeStudent.specialization_code !== 'GENERAL' && (
              <span>Track: {activeStudent.specialization_code}</span>
            )}
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

      {/* PHASE 1 COURSE PICKER */}
      {activeStudent && mode === 'PHASE1' && !parityMismatch && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Select Semester Courses ({selectedCourseIds.length} selected ·{' '}
              {catalogCourses
                .filter((c) => selectedCourseIds.includes(c.id))
                .reduce((s, c) => s + c.default_credits, 0)}{' '}
              credits)
            </h3>
            {canManage && (
              <button
                type="button"
                disabled={savePhase1Mutation.isPending || selectedCourseIds.length === 0}
                onClick={() => savePhase1Mutation.mutate()}
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {savePhase1Mutation.isPending ? 'Saving...' : 'Save Phase 1 Registration'}
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
            {catalogCourses.map((c) => (
              <label key={c.id} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedCourseIds.includes(c.id)}
                    onChange={() => toggleCourse(c.id)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span className="font-mono font-semibold text-slate-900">{c.course_code}</span>
                  <span className="text-slate-700">{c.title}</span>
                  {c.is_online && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      ONLINE
                    </span>
                  )}
                </span>
                <span className="text-slate-500">{c.default_credits} Cr</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* SUMMER & ODE SPECIAL CYCLES */}
      {activeStudent && (mode === 'SUMMER' || mode === 'ODE') && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {mode === 'SUMMER'
                  ? 'Eligible Unpassed Courses (Summer Rules 1–3)'
                  : 'Eligible Unpassed Courses (On-Demand Examination)'}
              </h3>
              <p className="text-xs text-slate-500">
                {mode === 'SUMMER'
                  ? 'Base ₹400 · Rule 1 (CIE Fail) ₹5,600 · Rule 2 (AB) ₹2,000 / ₹1,000 · Rule 3 (SEE Fail) ₹600'
                  : 'Attempt 1: ₹6,000/subj · Attempt 2+: ₹3,000/subj · + ₹100 App Fee + ₹600 Grade Card Fee'}
              </p>
            </div>
            {cycle && (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                Target Cycle: {cycle.code}
              </span>
            )}
          </div>

          {failedCandidates.length === 0 ? (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
              No historical failed/absent courses found in M12 <code>exam_course_results</code> for{' '}
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
                      Total Payable: ₹{summerTotalFee.toLocaleString('en-IN')}
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
                    disabled={saveSpecialCycleMutation.isPending || chosenFailed.length === 0 || !cycle}
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
