import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer, Search, Layers, Users } from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import type { AppearingRow, ExamCycle, ExamSessionCode, PaymentStatus, RegistrationCourseCategory, RegistrationStatus, EligibilityStatus } from '@/types/exams'
import { fetchInstitutionBranding, openBrandedPrintWindow, renderBrandedHeaderHtml, renderSignatureBlockHtml, signPrivateAssets } from './printBranding'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
}

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = String(val ?? '').trim()
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function escapeHtml(val: string | number | null | undefined): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function AppearingListsTab({ institutionId, institutionName, cycle }: Props) {
  const [viewMode, setViewMode] = useState<'SUMMARY' | 'ROSTER'>('SUMMARY')
  const [programFilter, setProgramFilter] = useState('ALL')
  const [periodFilter, setPeriodFilter] = useState('ALL')
  const [courseFilter, setCourseFilter] = useState('ALL')
  const [dateFilter, setDateFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [approvedOnly, setApprovedOnly] = useState(true)
  const [includeExcluded, setIncludeExcluded] = useState(false)

  const { data: rows = [], isLoading } = useQuery<AppearingRow[]>({
    queryKey: ['exam_appearing_rows', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const [regCoursesRes, slotsRes] = await Promise.all([
        fetchAllRows<Record<string, unknown>>((from, to) =>
          supabase
            .from('exam_registration_courses')
            .select(`
              id, registration_id, student_id, course_id, attempt_number,
              registration_category, is_online_exempt, eligibility_status,
              course_catalog (course_code, title),
              exam_registrations!inner (
                id, status, payment_status, program_id, academic_period_id,
                students (registration_number, full_name),
                programs (code, name),
                academic_periods (name),
                student_enrollments (academic_sections (section_name))
              )
            `)
            .eq('institution_id', institutionId)
            .eq('exam_cycle_id', cycle!.id)
            .order('id', { ascending: true })
            .range(from, to)
        ).then((data) => ({ data, error: null as Error | null })),
        supabase
          .from('exam_timetable_slots')
          .select('course_id, exam_date, session_code, start_time, end_time, is_omr_exam')
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle!.id),
      ])

      if (regCoursesRes.error) throw regCoursesRes.error
      if (slotsRes.error) throw slotsRes.error

      const slotMap = new Map<
        string,
        { exam_date: string; session_code: ExamSessionCode; start_time: string; end_time: string; is_omr_exam: boolean }
      >()
      for (const s of slotsRes.data ?? []) {
        slotMap.set(s.course_id as string, {
          exam_date: s.exam_date as string,
          session_code: s.session_code as ExamSessionCode,
          start_time: s.start_time as string,
          end_time: s.end_time as string,
          is_omr_exam: Boolean(s.is_omr_exam),
        })
      }

      const mapped: AppearingRow[] = (regCoursesRes.data ?? []).map((rc) => {
        const cc = unwrap(
          rc.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null
        )
        const er = unwrap(rc.exam_registrations as Record<string, unknown> | Record<string, unknown>[] | null)
        const stu = er
          ? unwrap(er.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null)
          : null
        const prog = er
          ? unwrap(er.programs as { code: string; name: string } | { code: string; name: string }[] | null)
          : null
        const per = er ? unwrap(er.academic_periods as { name: string } | { name: string }[] | null) : null
        const enr = er ? unwrap(er.student_enrollments as Record<string, unknown> | Record<string, unknown>[] | null) : null
        const sec = enr ? unwrap(enr.academic_sections as { section_name: string } | { section_name: string }[] | null) : null
        const slot = slotMap.get(rc.course_id as string)

        return {
          reg_course_id: rc.id as string,
          registration_id: rc.registration_id as string,
          registration_status: (er?.status as RegistrationStatus) ?? 'DRAFT',
          payment_status: (er?.payment_status as PaymentStatus) ?? 'PENDING',
          student_id: rc.student_id as string,
          student_reg_no: stu?.registration_number ?? '—',
          student_name: stu?.full_name ?? '—',
          program_id: (er?.program_id as string) ?? '',
          program_code: prog?.code ?? '—',
          program_name: prog?.name ?? '—',
          period_id: (er?.academic_period_id as string | null) ?? null,
          period_name: per?.name ?? null,
          section_name: sec?.section_name ?? null,
          course_id: rc.course_id as string,
          course_code: cc?.course_code ?? '—',
          course_title: cc?.title ?? '—',
          attempt_number: Number(rc.attempt_number ?? 1),
          registration_category: rc.registration_category as RegistrationCourseCategory,
          is_online_exempt: Boolean(rc.is_online_exempt),
          eligibility_status: rc.eligibility_status as EligibilityStatus,
          exam_date: slot?.exam_date ?? null,
          session_code: slot?.session_code ?? null,
          start_time: slot?.start_time ?? null,
          end_time: slot?.end_time ?? null,
          is_omr_exam: slot?.is_omr_exam ?? false,
        }
      })

      return mapped.sort((a, b) => {
        const dCmp = (a.exam_date ?? '9999-12-31').localeCompare(b.exam_date ?? '9999-12-31')
        if (dCmp !== 0) return dCmp
        const cCmp = a.course_code.localeCompare(b.course_code)
        if (cCmp !== 0) return cCmp
        return a.student_reg_no.localeCompare(b.student_reg_no)
      })
    },
  })

  const filterOptions = useMemo(() => {
    const progs = new Map<string, string>()
    const periods = new Map<string, string>()
    const courses = new Map<string, string>()
    const dates = new Set<string>()
    for (const r of rows) {
      if (r.program_code !== '—') progs.set(r.program_code, r.program_name)
      if (r.period_name) periods.set(r.period_name, r.period_name)
      courses.set(r.course_code, r.course_title)
      if (r.exam_date) dates.add(`${r.exam_date} ${r.session_code ?? ''}`.trim())
    }
    return {
      programs: Array.from(progs.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      periods: Array.from(periods.keys()).sort(),
      courses: Array.from(courses.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      dates: Array.from(dates).sort(),
    }
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((r) => {
      if (approvedOnly && r.registration_status !== 'APPROVED') return false
      if (!includeExcluded && (r.is_online_exempt || r.eligibility_status !== 'ELIGIBLE')) return false
      if (programFilter !== 'ALL' && r.program_code !== programFilter) return false
      if (periodFilter !== 'ALL' && (r.period_name ?? '') !== periodFilter) return false
      if (courseFilter !== 'ALL' && r.course_code !== courseFilter) return false
      if (dateFilter !== 'ALL') {
        const key = r.exam_date ? `${r.exam_date} ${r.session_code ?? ''}`.trim() : 'UNSCHEDULED'
        if (key !== dateFilter) return false
      }
      if (q) {
        const hay = `${r.student_reg_no} ${r.student_name} ${r.course_code} ${r.course_title} ${r.program_code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, approvedOnly, includeExcluded, programFilter, periodFilter, courseFilter, dateFilter, searchQuery])

  const courseSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        course_code: string
        course_title: string
        exam_date: string | null
        session_code: ExamSessionCode | null
        is_omr_exam: boolean
        total: number
        byBranch: Map<string, number>
      }
    >()
    for (const r of filteredRows) {
      const existing = map.get(r.course_code) ?? {
        course_code: r.course_code,
        course_title: r.course_title,
        exam_date: r.exam_date,
        session_code: r.session_code,
        is_omr_exam: r.is_omr_exam,
        total: 0,
        byBranch: new Map<string, number>(),
      }
      existing.total += 1
      existing.byBranch.set(r.program_code, (existing.byBranch.get(r.program_code) ?? 0) + 1)
      map.set(r.course_code, existing)
    }
    return Array.from(map.values()).sort((a, b) => {
      const d = (a.exam_date ?? '9999-12-31').localeCompare(b.exam_date ?? '9999-12-31')
      if (d !== 0) return d
      return a.course_code.localeCompare(b.course_code)
    })
  }, [filteredRows])

  const exportCsv = () => {
    if (!cycle) return
    const headers =
      viewMode === 'SUMMARY'
        ? ['Exam_Date', 'Session', 'Course_Code', 'Course_Title', 'Mode', 'Total_Appearing', 'Branch_Breakdown']
        : [
            'USN',
            'Student_Name',
            'Program',
            'Period',
            'Section',
            'Course_Code',
            'Course_Title',
            'Exam_Date',
            'Session',
            'Attempt',
            'Category',
            'Eligibility',
          ]

    const dataLines =
      viewMode === 'SUMMARY'
        ? courseSummary.map((s) => {
            const breakdown = Array.from(s.byBranch.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([br, cnt]) => `${br}:${cnt}`)
              .join(' | ')
            return [
              s.exam_date ?? 'TBD',
              s.session_code ?? '',
              s.course_code,
              s.course_title,
              s.is_omr_exam ? 'OMR' : 'DESCRIPTIVE',
              s.total,
              breakdown,
            ]
          })
        : filteredRows.map((r) => [
            r.student_reg_no,
            r.student_name,
            r.program_code,
            r.period_name ?? '',
            r.section_name ?? '',
            r.course_code,
            r.course_title,
            r.exam_date ?? 'TBD',
            r.session_code ?? '',
            r.attempt_number,
            r.registration_category,
            r.is_online_exempt ? 'ONLINE_EXEMPT' : r.eligibility_status,
          ])

    const csvBody = [headers, ...dataLines].map((line) => line.map(escapeCsvCell).join(',')).join('\r\n')
    const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${cycle.code}_appearing_${viewMode.toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printAppearingList = async () => {
    if (!cycle) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigs = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? sigs.get(branding.coe_signature_path) : null

    const tableHtml =
      viewMode === 'SUMMARY'
        ? `<table>
            <thead>
              <tr><th>Sl.No</th><th>Date / Session</th><th>Course Code</th><th>Course Title</th><th>Mode</th><th>Branch Breakdown</th><th>Total</th></tr>
            </thead>
            <tbody>
              ${courseSummary
                .map((s, idx) => {
                  const breakdown = Array.from(s.byBranch.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([br, cnt]) => `${br}: ${cnt}`)
                    .join(', ')
                  return `<tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(s.exam_date ?? 'TBD')} ${escapeHtml(s.session_code ?? '')}</td>
                    <td><strong>${escapeHtml(s.course_code)}</strong></td>
                    <td>${escapeHtml(s.course_title)}</td>
                    <td>${s.is_omr_exam ? 'OMR' : 'Written'}</td>
                    <td>${escapeHtml(breakdown)}</td>
                    <td style="text-align:right;font-weight:700">${s.total}</td>
                  </tr>`
                })
                .join('')}
            </tbody>
          </table>`
        : `<table>
            <thead>
              <tr><th>Sl.No</th><th>USN</th><th>Student Name</th><th>Program / Sem</th><th>Course Code</th><th>Course Title</th><th>Date / Session</th><th>Attempt</th></tr>
            </thead>
            <tbody>
              ${filteredRows
                .map(
                  (r, idx) => `<tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHtml(r.student_reg_no)}</strong></td>
                    <td>${escapeHtml(r.student_name)}</td>
                    <td>${escapeHtml(r.program_code)} ${escapeHtml(r.period_name ?? '')} ${r.section_name ? `(${escapeHtml(r.section_name)})` : ''}</td>
                    <td><strong>${escapeHtml(r.course_code)}</strong></td>
                    <td>${escapeHtml(r.course_title)}</td>
                    <td>${escapeHtml(r.exam_date ?? 'TBD')} ${escapeHtml(r.session_code ?? '')}</td>
                    <td style="text-align:center">${r.attempt_number}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>`

    const badge = `${cycle.name} (${cycle.code}) — ${viewMode === 'SUMMARY' ? 'Course-Wise Appearing Summary' : 'Student-Wise Appearing Roster'}`
    openBrandedPrintWindow({
      title: `${cycle.code} — Appearing List`,
      landscape: false,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: `
        ${renderBrandedHeaderHtml(branding, badge)}
        <div class="meta">
          <span>Filter: Program=${escapeHtml(programFilter)} | Period=${escapeHtml(periodFilter)} | Course=${escapeHtml(courseFilter)}</span>
          <span>Total Entries: ${filteredRows.length} · Generated: ${new Date().toLocaleString('en-IN')}</span>
        </div>
        ${tableHtml}
        <div class="signatures">
          ${renderSignatureBlockHtml('Prepared By (Exam Section)', null)}
          ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSigUrl)}
        </div>
      `,
    })
  }

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to generate Appearing Lists.
      </div>
    )
  }

  const uniqueStudents = new Set(filteredRows.map((r) => r.student_id)).size

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Appearing Lists — {cycle.code}</h2>
          <p className="text-xs text-slate-500">
            {uniqueStudents} unique student{uniqueStudents === 1 ? '' : 's'} · {filteredRows.length} subject-sitting
            entries across {courseSummary.length} course{courseSummary.length === 1 ? '' : 's'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('SUMMARY')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
                viewMode === 'SUMMARY' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              Course Summary
            </button>
            <button
              type="button"
              onClick={() => setViewMode('ROSTER')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium',
                viewMode === 'ROSTER' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Users className="h-3.5 w-3.5" />
              Student Roster
            </button>
          </div>

          <button
            type="button"
            disabled={filteredRows.length === 0}
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            disabled={filteredRows.length === 0}
            onClick={printAppearingList}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / A4 PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Search USN, student name, or course..."
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
            <option value="ALL">All Programs</option>
            {filterOptions.programs.map(([code, name]) => (
              <option key={code} value={code}>
                {code} — {name}
              </option>
            ))}
          </select>
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="ALL">All Semesters</option>
            {filterOptions.periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs max-w-[220px]"
          >
            <option value="ALL">All Courses</option>
            {filterOptions.courses.map(([code, title]) => (
              <option key={code} value={code}>
                {code} — {title}
              </option>
            ))}
          </select>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="ALL">All Dates</option>
            {filterOptions.dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="UNSCHEDULED">Unscheduled (TBD)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={approvedOnly}
              onChange={(e) => setApprovedOnly(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            COE Approved Registrations Only
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeExcluded}
              onChange={(e) => setIncludeExcluded(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            Show ONLINE-Exempt & Detained Entries
          </label>
        </div>
      </div>

      {/* Results Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          {viewMode === 'SUMMARY' ? (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Exam Date / Session</th>
                  <th className="px-4 py-2.5 font-semibold">Course</th>
                  <th className="px-4 py-2.5 font-semibold">Mode</th>
                  <th className="px-4 py-2.5 font-semibold">Branch Breakdown</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Appearing Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Building appearing list...
                    </td>
                  </tr>
                ) : courseSummary.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No matching eligible appearing entries. Approve student registrations first (or uncheck "COE
                      Approved Only" to preview drafts).
                    </td>
                  </tr>
                ) : (
                  courseSummary.map((s) => (
                    <tr key={s.course_code} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        {s.exam_date ? (
                          <span>
                            <strong className="text-slate-900">{s.exam_date}</strong>{' '}
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                              {s.session_code}
                            </span>
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium">Unscheduled (TBD)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-slate-900">{s.course_code}</span>
                        <p className="text-slate-600">{s.course_title}</p>
                      </td>
                      <td className="px-4 py-3">
                        {s.is_omr_exam ? (
                          <span className="rounded bg-purple-50 border border-purple-200 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                            OMR
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">Written</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Array.from(s.byBranch.entries())
                            .sort((a, b) => a[0].localeCompare(b[0]))
                            .map(([br, cnt]) => (
                              <span
                                key={br}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
                              >
                                {br}: {cnt}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{s.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">USN</th>
                  <th className="px-4 py-2.5 font-semibold">Student Name</th>
                  <th className="px-4 py-2.5 font-semibold">Program / Sem</th>
                  <th className="px-4 py-2.5 font-semibold">Course</th>
                  <th className="px-4 py-2.5 font-semibold">Exam Slot</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Loading student roster...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      No matching student appearing records.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => (
                    <tr key={r.reg_course_id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{r.student_reg_no}</td>
                      <td className="px-4 py-2.5 text-slate-800">{r.student_name}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {r.program_code} {r.period_name ? `· ${r.period_name}` : ''}
                        {r.section_name ? ` (Sec ${r.section_name})` : ''}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-slate-900">{r.course_code}</span>
                        <span className="ml-1.5 text-slate-600">{r.course_title}</span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {r.exam_date ? `${r.exam_date} (${r.session_code})` : 'TBD'}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.is_online_exempt ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            ONLINE Exempt
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {r.eligibility_status} · #{r.attempt_number}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
