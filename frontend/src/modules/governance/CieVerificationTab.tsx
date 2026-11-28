import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardCheck,
  Lock,
  RotateCcw,
  Printer,
  Save,
  Send,
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type {
  CieMarkRow,
  CieSubmissionRow,
  GovernanceProgramRow,
  SectionAllocationRow,
} from '@/types/governance'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
} from '@/modules/exams/printBranding'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  academicYear: string
  term: 'ODD' | 'EVEN'
  programs: GovernanceProgramRow[]
  allocations: SectionAllocationRow[]
  isFirstYearDean: boolean
  scopedUnitId: string | null
  canEnterCie: boolean
  canApproveCie: boolean
}

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function CieVerificationTab({
  institutionId,
  cycle,
  academicYear,
  term,
  programs,
  allocations,
  isFirstYearDean,
  scopedUnitId,
  canEnterCie,
  canApproveCie,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [subView, setSubView] = useState<'VERIFY' | 'ENTRY'>(canApproveCie ? 'VERIFY' : 'ENTRY')
  const [selectedAllocationId, setSelectedAllocationId] = useState('')
  const [entryRows, setEntryRows] = useState<CieMarkRow[]>([])
  const [entryLoadedFor, setEntryLoadedFor] = useState('')
  const [reviewSubmission, setReviewSubmission] = useState<CieSubmissionRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: submissions = [], isLoading: loadingSubs } = useQuery<CieSubmissionRow[]>({
    queryKey: ['cie_submissions', institutionId, academicYear, term],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cie_submissions')
        .select(`
          id, exam_cycle_id, allocation_id, academic_year, term, program_id, academic_unit_id,
          course_id, course_code, semester_number, section_name, staff_profile_id, faculty_code,
          max_cie_marks, status, submitted_at, approved_at,
          programs (code),
          course_catalog (title),
          staff_profiles (full_name)
        `)
        .eq('institution_id', institutionId)
        .eq('academic_year', academicYear)
        .eq('term', term)
        .order('submitted_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      return (data ?? []).map((row) => {
        const prog = unwrap(row.programs as { code: string } | { code: string }[] | null)
        const crs = unwrap(row.course_catalog as { title: string } | { title: string }[] | null)
        const st = unwrap(row.staff_profiles as { full_name: string } | { full_name: string }[] | null)
        return {
          id: row.id as string,
          exam_cycle_id: (row.exam_cycle_id as string | null) ?? null,
          allocation_id: (row.allocation_id as string | null) ?? null,
          academic_year: row.academic_year as string,
          term: row.term as 'ODD' | 'EVEN' | 'SUMMER',
          program_id: row.program_id as string,
          program_code: prog?.code ?? 'GEN',
          academic_unit_id: (row.academic_unit_id as string | null) ?? null,
          course_id: row.course_id as string,
          course_code: row.course_code as string,
          course_title: crs?.title ?? 'Course',
          semester_number: Number(row.semester_number),
          section_name: row.section_name as string,
          staff_profile_id: (row.staff_profile_id as string | null) ?? null,
          faculty_code: row.faculty_code as string,
          faculty_name: st?.full_name ?? (row.faculty_code as string),
          max_cie_marks: Number(row.max_cie_marks ?? 50),
          status: row.status as 'DRAFT' | 'SUBMITTED' | 'APPROVED',
          submitted_at: (row.submitted_at as string | null) ?? null,
          approved_at: (row.approved_at as string | null) ?? null,
        }
      })
    },
  })

  const visibleSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (isFirstYearDean && s.semester_number > 2) return false
      if (!isFirstYearDean && scopedUnitId && s.academic_unit_id && s.academic_unit_id !== scopedUnitId) {
        return false
      }
      return true
    })
  }, [submissions, isFirstYearDean, scopedUnitId])

  const { data: reviewMarks = [], isLoading: loadingReviewMarks } = useQuery<CieMarkRow[]>({
    queryKey: ['cie_review_marks', reviewSubmission?.id],
    enabled: Boolean(reviewSubmission?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cie_marks')
        .select('student_id, usn, theory_marks, practical_marks, total_marks, is_absent, students(full_name)')
        .eq('submission_id', reviewSubmission!.id)
        .order('usn', { ascending: true })
      if (error) throw error
      return (data ?? []).map((m) => {
        const st = unwrap(m.students as { full_name: string } | { full_name: string }[] | null)
        return {
          student_id: m.student_id as string,
          usn: m.usn as string,
          full_name: st?.full_name ?? 'Student',
          theory_marks: Number(m.theory_marks ?? 0),
          practical_marks: Number(m.practical_marks ?? 0),
          total_marks: Number(m.total_marks ?? 0),
          is_absent: Boolean(m.is_absent),
        }
      })
    },
  })

  const loadSectionRoster = async (allocId: string) => {
    setSelectedAllocationId(allocId)
    setNotice(null)
    setErrorMsg(null)
    if (!allocId) {
      setEntryRows([])
      setEntryLoadedFor('')
      return
    }
    const alloc = allocations.find((a) => a.id === allocId)
    if (!alloc) return

    try {
      // Load existing submission marks if any
      const existingSub = submissions.find(
        (s) =>
          s.program_id === alloc.program_id &&
          s.semester_number === alloc.semester_number &&
          s.section_name === alloc.section_name &&
          s.course_id === alloc.course_id
      )

      const existingMap = new Map<string, CieMarkRow>()
      if (existingSub) {
        const { data: saved } = await supabase
          .from('cie_marks')
          .select('student_id, usn, theory_marks, practical_marks, total_marks, is_absent, students(full_name)')
          .eq('submission_id', existingSub.id)
        for (const m of saved ?? []) {
          const st = unwrap(m.students as { full_name: string } | { full_name: string }[] | null)
          existingMap.set(m.student_id as string, {
            student_id: m.student_id as string,
            usn: m.usn as string,
            full_name: st?.full_name ?? 'Student',
            theory_marks: Number(m.theory_marks ?? 0),
            practical_marks: Number(m.practical_marks ?? 0),
            total_marks: Number(m.total_marks ?? 0),
            is_absent: Boolean(m.is_absent),
          })
        }
      }

      // Fetch active enrolled students in this program & semester/section
      const enrollData = await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from('student_enrollments')
          .select(`
            student_id,
            students (registration_number, full_name, deleted_at),
            academic_periods (sequence_number, legacy_semester_id),
            academic_sections (section_name)
          `)
          .eq('institution_id', institutionId)
          .eq('program_id', alloc.program_id)
          .eq('is_current', true)
          .order('id', { ascending: true })
          .range(from, to)
      )

      const rows: CieMarkRow[] = []
      const seen = new Set<string>()
      for (const e of enrollData ?? []) {
        const stu = unwrap(
          e.students as
            | { registration_number: string; full_name: string; deleted_at: string | null }
            | { registration_number: string; full_name: string; deleted_at: string | null }[]
            | null
        )
        if (!stu || stu.deleted_at) continue
        const per = unwrap(
          e.academic_periods as
            | { sequence_number: number; legacy_semester_id: number | null }
            | { sequence_number: number; legacy_semester_id: number | null }[]
            | null
        )
        const sec = unwrap(e.academic_sections as { section_name: string } | { section_name: string }[] | null)
        const stuSem = Number(per?.legacy_semester_id ?? per?.sequence_number ?? 0)
        if (stuSem !== alloc.semester_number) continue
        if (sec?.section_name && sec.section_name.toUpperCase() !== alloc.section_name.toUpperCase()) continue

        const sid = e.student_id as string
        seen.add(sid)
        const prev = existingMap.get(sid)
        rows.push(
          prev ?? {
            student_id: sid,
            usn: stu.registration_number,
            full_name: stu.full_name,
            theory_marks: 0,
            practical_marks: 0,
            total_marks: 0,
            is_absent: false,
          }
        )
      }

      // Include any previously saved students even if section changed later
      for (const [sid, prev] of existingMap.entries()) {
        if (!seen.has(sid)) rows.push(prev)
      }

      rows.sort((a, b) => a.usn.localeCompare(b.usn))
      setEntryRows(rows)
      setEntryLoadedFor(allocId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load section roster')
    }
  }

  const saveEntryMutation = useMutation({
    mutationFn: async (targetStatus: 'DRAFT' | 'SUBMITTED') => {
      const alloc = allocations.find((a) => a.id === selectedAllocationId)
      if (!alloc) throw new Error('Select an allocated section first.')
      if (entryRows.length === 0) throw new Error('No students found in this section.')
      const prog = programs.find((p) => p.id === alloc.program_id)

      const { data: subRow, error: subErr } = await supabase
        .from('cie_submissions')
        .upsert(
          {
            institution_id: institutionId,
            exam_cycle_id: cycle?.id ?? alloc.exam_cycle_id ?? null,
            allocation_id: alloc.id,
            academic_year: academicYear,
            term,
            program_id: alloc.program_id,
            academic_unit_id: prog?.academic_unit_id ?? null,
            course_id: alloc.course_id,
            course_code: alloc.course_code,
            semester_number: alloc.semester_number,
            section_name: alloc.section_name,
            staff_profile_id: alloc.staff_profile_id,
            faculty_code: alloc.faculty_code,
            status: targetStatus,
            submitted_at: targetStatus === 'SUBMITTED' ? new Date().toISOString() : null,
            created_by: session?.user.id ?? null,
            updated_by: session?.user.id ?? null,
          },
          { onConflict: 'institution_id,academic_year,term,program_id,semester_number,section_name,course_id' }
        )
        .select('id')
        .single()
      if (subErr) throw subErr

      const markPayloads = entryRows.map((r) => ({
        institution_id: institutionId,
        submission_id: subRow.id as string,
        student_id: r.student_id,
        usn: r.usn,
        theory_marks: r.is_absent ? 0 : Number(r.theory_marks) || 0,
        practical_marks: r.is_absent ? 0 : Number(r.practical_marks) || 0,
        total_marks: r.is_absent ? 0 : (Number(r.theory_marks) || 0) + (Number(r.practical_marks) || 0),
        is_absent: r.is_absent,
        updated_by: session?.user.id ?? null,
      }))

      const { error: mErr } = await supabase
        .from('cie_marks')
        .upsert(markPayloads, { onConflict: 'submission_id,student_id' })
      if (mErr) throw mErr

      return { targetStatus, count: markPayloads.length }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setNotice(
        res.targetStatus === 'SUBMITTED'
          ? `Submitted CIE marks for ${res.count} students to HOD / Dean for verification.`
          : `Saved CIE draft for ${res.count} students.`
      )
      queryClient.invalidateQueries({ queryKey: ['cie_submissions', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to save CIE marks'),
  })

  const returnToDraftMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const { error } = await supabase
        .from('cie_submissions')
        .update({ status: 'DRAFT', submitted_at: null, updated_by: session?.user.id ?? null })
        .eq('id', submissionId)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      setNotice('Submission returned to faculty as DRAFT for corrections.')
      setReviewSubmission(null)
      queryClient.invalidateQueries({ queryKey: ['cie_submissions', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Return failed'),
  })

  const approveAndSyncMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const { data, error } = await supabase.rpc('approve_and_sync_cie_submission', {
        p_institution_id: institutionId,
        p_submission_id: submissionId,
      })
      if (error) throw error
      return data as { total_students: number; synced_to_m12: number }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setNotice(
        `Approved & locked CIE marks (${res.total_students} students; ${res.synced_to_m12} synced directly to M12 exam_course_results).`
      )
      setReviewSubmission(null)
      queryClient.invalidateQueries({ queryKey: ['cie_submissions', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Approval failed'),
  })

  const printOfficialCiePdf = async (sub: CieSubmissionRow, marks: CieMarkRow[]) => {
    const branding = await fetchInstitutionBranding(institutionId)
    const sigMap = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null

    const rowsHtml = marks
      .map(
        (m, idx) => `<tr>
          <td style="text-align:center">${idx + 1}</td>
          <td style="font-family:monospace;font-weight:700">${escapeHtml(m.usn)}</td>
          <td>${escapeHtml(m.full_name)}</td>
          <td style="text-align:center">${m.is_absent ? 'AB' : m.theory_marks}</td>
          <td style="text-align:center">${m.is_absent ? 'AB' : m.practical_marks}</td>
          <td style="text-align:center;font-weight:700">${m.is_absent ? 'AB' : m.total_marks}</td>
        </tr>`
      )
      .join('')

    openBrandedPrintWindow({
      title: `CIE_Marks_${sub.course_code}_Sec${sub.section_name}`,
      landscape: false,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: `
        ${renderWatermarkHtml(branding, 'per-page')}
        ${renderBrandedHeaderHtml(
          branding,
          `OFFICIAL INTERNAL ASSESSMENT (CIE) MARKS — ${sub.academic_year} (${sub.term})`,
          `Branch: ${sub.program_code} · Sem ${sub.semester_number} · Section ${sub.section_name}`
        )}
        <div class="meta">
          <span><strong>Course:</strong> ${escapeHtml(sub.course_code)} — ${escapeHtml(sub.course_title)}</span>
          <span><strong>Faculty:</strong> ${escapeHtml(sub.faculty_name)} (${escapeHtml(sub.faculty_code)})</span>
          <span><strong>Status:</strong> ${escapeHtml(sub.status)}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:42px;text-align:center">Sl.</th>
              <th style="width:110px">USN</th>
              <th>Student Name</th>
              <th style="width:72px;text-align:center">Theory</th>
              <th style="width:72px;text-align:center">Practical</th>
              <th style="width:72px;text-align:center">Total CIE</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="signatures">
          ${renderSignatureBlockHtml('Signature of Faculty', null)}
          ${renderSignatureBlockHtml('Signature of HOD / Dean', null)}
          ${renderSignatureBlockHtml('Controller of Examinations', coeSigUrl)}
        </div>
      `,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setSubView('VERIFY')
              setReviewSubmission(null)
            }}
            className={cn(
              'rounded px-3 py-1.5 font-medium transition',
              subView === 'VERIFY' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            HOD / Dean Verification ({visibleSubmissions.filter((s) => s.status === 'SUBMITTED').length} Pending)
          </button>
          {canEnterCie && (
            <button
              type="button"
              onClick={() => setSubView('ENTRY')}
              className={cn(
                'rounded px-3 py-1.5 font-medium transition',
                subView === 'ENTRY' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Faculty CIE Marks Entry
            </button>
          )}
        </div>
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

      {/* SUBVIEW 1: HOD / DEAN VERIFICATION QUEUE */}
      {subView === 'VERIFY' && (
        reviewSubmission ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <button
                  type="button"
                  onClick={() => setReviewSubmission(null)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 mb-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Back to Verification List
                </button>
                <h3 className="text-base font-bold text-indigo-900">
                  {reviewSubmission.course_code} — {reviewSubmission.course_title}
                </h3>
                <p className="text-xs text-slate-500">
                  {reviewSubmission.program_code} · Sem {reviewSubmission.semester_number} · Sec{' '}
                  {reviewSubmission.section_name} · Faculty: {reviewSubmission.faculty_name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                  {reviewSubmission.status}
                </span>
                <button
                  type="button"
                  onClick={() => printOfficialCiePdf(reviewSubmission, reviewMarks)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Official CIE PDF
                </button>
              </div>
            </div>

            {loadingReviewMarks ? (
              <p className="text-xs text-slate-500 py-6 text-center">Loading student marks...</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">USN</th>
                        <th className="px-3 py-2">Student Name</th>
                        <th className="px-3 py-2 text-center">Theory</th>
                        <th className="px-3 py-2 text-center">Practical</th>
                        <th className="px-3 py-2 text-center">Total CIE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reviewMarks.map((m) => (
                        <tr key={m.student_id} className={m.is_absent ? 'bg-red-50/50' : ''}>
                          <td className="px-3 py-2 font-mono font-semibold text-slate-900">{m.usn}</td>
                          <td className="px-3 py-2 text-slate-700">{m.full_name}</td>
                          <td className="px-3 py-2 text-center">{m.is_absent ? 'AB' : m.theory_marks}</td>
                          <td className="px-3 py-2 text-center">{m.is_absent ? 'AB' : m.practical_marks}</td>
                          <td className="px-3 py-2 text-center font-bold text-emerald-700">
                            {m.is_absent ? 'AB' : m.total_marks}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canApproveCie && reviewSubmission.status !== 'APPROVED' && (
                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      disabled={returnToDraftMutation.isPending}
                      onClick={() => {
                        if (window.confirm('Return these CIE marks to the faculty for corrections?')) {
                          returnToDraftMutation.mutate(reviewSubmission.id)
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Return for Corrections
                    </button>
                    <button
                      type="button"
                      disabled={approveAndSyncMutation.isPending}
                      onClick={() => {
                        if (window.confirm('Approve, lock, and sync these CIE marks into M12 exam_course_results?')) {
                          approveAndSyncMutation.mutate(reviewSubmission.id)
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      {approveAndSyncMutation.isPending ? 'Syncing...' : 'Approve, Lock & Sync to M12'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Course</th>
                    <th className="px-4 py-2.5 font-semibold">Branch / Sem / Sec</th>
                    <th className="px-4 py-2.5 font-semibold">Faculty</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingSubs ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        Loading CIE submissions...
                      </td>
                    </tr>
                  ) : visibleSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        No CIE marks submissions recorded for {academicYear} ({term}) yet.
                      </td>
                    </tr>
                  ) : (
                    visibleSubmissions.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <span className="font-mono font-semibold text-indigo-900">{s.course_code}</span>
                          <p className="text-slate-600">{s.course_title}</p>
                        </td>
                        <td className="px-4 py-2.5">
                          {s.program_code} · Sem {s.semester_number} · Sec {s.section_name}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {s.faculty_name} <span className="font-mono text-slate-400">({s.faculty_code})</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              s.status === 'APPROVED'
                                ? 'bg-emerald-50 text-emerald-700'
                                : s.status === 'SUBMITTED'
                                  ? 'bg-indigo-50 text-indigo-700'
                                  : 'bg-amber-50 text-amber-800'
                            )}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setReviewSubmission(s)}
                            className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                          >
                            <ClipboardCheck className="h-3.5 w-3.5" />
                            {s.status === 'APPROVED' ? 'View / Print' : 'Review & Approve'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* SUBVIEW 2: FACULTY CIE ENTRY */}
      {subView === 'ENTRY' && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Allocated Section to Enter CIE Marks
              </label>
              <select
                value={selectedAllocationId}
                onChange={(e) => loadSectionRoster(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              >
                <option value="">-- Choose allocated course &amp; section --</option>
                {allocations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.course_code} ({a.program_code} · Sem {a.semester_number} · Sec {a.section_name}) — {a.faculty_name}
                  </option>
                ))}
              </select>
            </div>

            {entryLoadedFor && entryRows.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saveEntryMutation.isPending}
                  onClick={() => saveEntryMutation.mutate('DRAFT')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={saveEntryMutation.isPending}
                  onClick={() => saveEntryMutation.mutate('SUBMITTED')}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  <Send className="h-3.5 w-3.5" />
                  Submit to HOD / Dean
                </button>
              </div>
            )}
          </div>

          {entryLoadedFor && (
            entryRows.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                No active students found matching this program, semester, and section.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded-md">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">USN</th>
                      <th className="px-3 py-2">Student Name</th>
                      <th className="px-3 py-2 w-24 text-center">Theory</th>
                      <th className="px-3 py-2 w-24 text-center">Practical</th>
                      <th className="px-3 py-2 w-20 text-center">Absent</th>
                      <th className="px-3 py-2 w-24 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entryRows.map((r, idx) => (
                      <tr key={r.student_id} className={r.is_absent ? 'bg-red-50/40' : ''}>
                        <td className="px-3 py-1.5 font-mono font-semibold text-slate-900">{r.usn}</td>
                        <td className="px-3 py-1.5 text-slate-700">{r.full_name}</td>
                        <td className="px-3 py-1.5 text-center">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            disabled={r.is_absent}
                            value={r.theory_marks}
                            onChange={(e) => {
                              const th = Number(e.target.value) || 0
                              setEntryRows((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, theory_marks: th, total_marks: th + item.practical_marks }
                                    : item
                                )
                              )
                            }}
                            className="w-16 rounded border border-slate-300 px-1.5 py-1 text-center text-xs"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            disabled={r.is_absent}
                            value={r.practical_marks}
                            onChange={(e) => {
                              const pr = Number(e.target.value) || 0
                              setEntryRows((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, practical_marks: pr, total_marks: item.theory_marks + pr }
                                    : item
                                )
                              )
                            }}
                            className="w-16 rounded border border-slate-300 px-1.5 py-1 text-center text-xs"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={r.is_absent}
                            onChange={(e) => {
                              const ab = e.target.checked
                              setEntryRows((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        is_absent: ab,
                                        total_marks: ab ? 0 : item.theory_marks + item.practical_marks,
                                      }
                                    : item
                                )
                              )
                            }}
                            className="rounded border-slate-300 text-red-600"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center font-bold text-indigo-800">
                          {r.is_absent ? 'AB' : r.total_marks}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
