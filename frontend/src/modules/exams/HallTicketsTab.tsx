import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ticket,
  Printer,
  Search,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  EligibilityStatus,
  ExamCycle,
  ExamCycleType,
  ExamSessionCode,
  HallTicketCourseLine,
  HallTicketItem,
  HallTicketStatus,
  PaymentStatus,
  RegistrationCourseCategory,
} from '@/types/exams'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
} from './printBranding'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  canIssue: boolean
  canPrint: boolean
}

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function fmtTime(t: string | null): string {
  return t ? t.slice(0, 5) : ''
}

const TICKET_STATUS_STYLES: Record<HallTicketStatus, string> = {
  ISSUED: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  WITHHELD: 'bg-amber-50 text-amber-800 border border-amber-200',
  REVOKED: 'bg-red-50 text-red-700 border border-red-200',
}

export function HallTicketsTab({ institutionId, cycle, canIssue, canPrint }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [requirePaid, setRequirePaid] = useState(true)
  const [programFilter, setProgramFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [issueNotice, setIssueNotice] = useState<string | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)

  const { data: tickets = [], isLoading } = useQuery<HallTicketItem[]>({
    queryKey: ['exam_hall_tickets', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const [ticketsRes, slotsRes] = await Promise.all([
        supabase
          .from('hall_tickets')
          .select(`
            id, institution_id, exam_cycle_id, registration_id, student_id,
            ticket_number, verification_code, status, withheld_reason,
            eligible_course_count, print_count, last_printed_at, issued_at,
            students (registration_number, full_name, photo_url),
            exam_registrations (
              registration_type, payment_status, program_id,
              programs (code, name),
              academic_periods (name),
              student_enrollments (academic_sections (section_name)),
              exam_registration_courses (
                course_id, attempt_number, registration_category, is_online_exempt, eligibility_status,
                course_catalog (course_code, title)
              )
            )
          `)
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle!.id)
          .order('ticket_number', { ascending: true }),
        supabase
          .from('exam_timetable_slots')
          .select('course_id, exam_date, session_code, start_time, end_time, is_omr_exam')
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle!.id),
      ])

      if (ticketsRes.error) throw ticketsRes.error
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

      return (ticketsRes.data ?? []).map((row) => {
        const stu = unwrap(
          row.students as
            | { registration_number: string; full_name: string; photo_url: string | null }
            | { registration_number: string; full_name: string; photo_url: string | null }[]
            | null
        )
        const er = unwrap(row.exam_registrations as Record<string, unknown> | Record<string, unknown>[] | null)
        const prog = er
          ? unwrap(er.programs as { code: string; name: string } | { code: string; name: string }[] | null)
          : null
        const per = er ? unwrap(er.academic_periods as { name: string } | { name: string }[] | null) : null
        const enr = er
          ? unwrap(er.student_enrollments as Record<string, unknown> | Record<string, unknown>[] | null)
          : null
        const sec = enr
          ? unwrap(enr.academic_sections as { section_name: string } | { section_name: string }[] | null)
          : null
        const rawCourses = (er?.exam_registration_courses as Array<Record<string, unknown>>) ?? []

        const courses: HallTicketCourseLine[] = rawCourses
          .map((rc) => {
            const cc = unwrap(
              rc.course_catalog as
                | { course_code: string; title: string }
                | { course_code: string; title: string }[]
                | null
            )
            const slot = slotMap.get(rc.course_id as string)
            return {
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
          .sort((a, b) => {
            const d = (a.exam_date ?? '9999-12-31').localeCompare(b.exam_date ?? '9999-12-31')
            if (d !== 0) return d
            return a.course_code.localeCompare(b.course_code)
          })

        return {
          id: row.id as string,
          institution_id: row.institution_id as string,
          exam_cycle_id: row.exam_cycle_id as string,
          registration_id: row.registration_id as string,
          student_id: row.student_id as string,
          ticket_number: row.ticket_number as string,
          verification_code: row.verification_code as string,
          status: row.status as HallTicketStatus,
          withheld_reason: (row.withheld_reason as string | null) ?? null,
          eligible_course_count: Number(row.eligible_course_count ?? 0),
          print_count: Number(row.print_count ?? 0),
          last_printed_at: (row.last_printed_at as string | null) ?? null,
          issued_at: row.issued_at as string,
          student_reg_no: stu?.registration_number ?? '—',
          student_name: stu?.full_name ?? '—',
          student_photo_url: stu?.photo_url ?? null,
          program_id: (er?.program_id as string) ?? '',
          program_code: prog?.code ?? '—',
          program_name: prog?.name ?? '—',
          period_name: per?.name ?? null,
          section_name: sec?.section_name ?? null,
          registration_type: (er?.registration_type as ExamCycleType) ?? cycle!.cycle_type,
          payment_status: (er?.payment_status as PaymentStatus) ?? 'PENDING',
          courses,
        }
      })
    },
  })

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('No active exam cycle.')
      const { data, error } = await supabase.rpc('issue_hall_tickets_for_cycle', {
        p_institution_id: institutionId,
        p_exam_cycle_id: cycle.id,
        p_require_paid: requirePaid,
        p_program_id: null,
      })
      if (error) throw error
      return data as { issued: number; refreshed: number; skipped_no_eligible_courses: number }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['exam_hall_tickets', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_cycle_stats', institutionId, cycle?.id] })
      setIssueNotice(
        `Hall Ticket run complete: ${res.issued} newly issued, ${res.refreshed} course counts refreshed, ${res.skipped_no_eligible_courses} skipped (no eligible written/lab courses).`
      )
    },
    onError: (err) => {
      setIssueNotice(err instanceof Error ? err.message : 'Failed to issue hall tickets')
    },
  })

  const updateTicketStatusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: string
      status: HallTicketStatus
      reason: string | null
    }) => {
      const { error } = await supabase
        .from('hall_tickets')
        .update({
          status,
          withheld_reason: reason,
          updated_by: session?.user.id ?? null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_hall_tickets', institutionId, cycle?.id] })
    },
  })

  const programOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tickets) {
      if (t.program_code !== '—') map.set(t.program_code, t.program_name)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [tickets])

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return tickets.filter((t) => {
      if (programFilter !== 'ALL' && t.program_code !== programFilter) return false
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false
      if (q) {
        const hay = `${t.student_reg_no} ${t.student_name} ${t.ticket_number} ${t.program_code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tickets, programFilter, statusFilter, searchQuery])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleSelectAllVisible = () => {
    const visibleIssued = filteredTickets.filter((t) => t.status === 'ISSUED').map((t) => t.id)
    const allSelected = visibleIssued.length > 0 && visibleIssued.every((id) => selectedIds.includes(id))
    setSelectedIds(allSelected ? [] : visibleIssued)
  }

  const printHallTickets = async (batch: HallTicketItem[]) => {
    if (!cycle) return
    const printable = batch.filter((t) => t.status === 'ISSUED')
    if (printable.length === 0) {
      window.alert('Only hall tickets with status ISSUED can be printed.')
      return
    }

    setIsPrinting(true)
    try {
      const branding = await fetchInstitutionBranding(institutionId)
      const signedMap = await signPrivateAssets([
        branding.coe_signature_path,
        branding.principal_signature_path,
        ...printable.map((t) => t.student_photo_url),
      ])

      const coeSigUrl = branding.coe_signature_path ? signedMap.get(branding.coe_signature_path) : null
      const principalSigUrl = branding.principal_signature_path
        ? signedMap.get(branding.principal_signature_path)
        : null

      const pagesHtml = printable
        .map((t) => {
          const writtenCourses = t.courses.filter((c) => !c.is_online_exempt && c.eligibility_status === 'ELIGIBLE')
          const onlineExempt = t.courses.filter((c) => c.is_online_exempt)
          const photoSrc = t.student_photo_url ? signedMap.get(t.student_photo_url) ?? null : null

          const rowsHtml = writtenCourses
            .map(
              (c, idx) => `<tr>
                <td style="text-align:center">${idx + 1}</td>
                <td><strong>${escapeHtml(c.course_code)}</strong>${c.is_omr_exam ? ' <span class="omr">OMR</span>' : ''}</td>
                <td>${escapeHtml(c.course_title)}</td>
                <td style="text-align:center">${escapeHtml(c.exam_date ?? 'TBD')}</td>
                <td style="text-align:center">${c.session_code ? `${escapeHtml(c.session_code)} (${fmtTime(c.start_time)}–${fmtTime(c.end_time)})` : 'TBD'}</td>
                <td style="text-align:center">${c.attempt_number}</td>
                <td></td>
              </tr>`
            )
            .join('')

          const photoBlock = photoSrc
            ? `<img src="${escapeHtml(photoSrc)}" alt="Photo" style="width:100%;height:100%;object-fit:cover" />`
            : `<div class="photo-placeholder">Affix Recent<br/>Passport Size<br/>Photograph</div>`

          return `<section class="page">
            ${renderWatermarkHtml(branding, 'per-page')}
            <div class="border-box doc-body">
              ${renderBrandedHeaderHtml(branding, `EXAMINATION HALL TICKET — ${cycle.name} (${cycle.code})`)}

              <div class="meta">
                <span><strong>Hall Ticket No:</strong> ${escapeHtml(t.ticket_number)}</span>
                <span><strong>Cycle Type:</strong> ${escapeHtml(t.registration_type)}</span>
                <span><strong>Verify Code:</strong> ${escapeHtml(t.verification_code)}</span>
              </div>

              <div class="student-grid">
                <table class="info-table">
                  <tr><td class="lbl">USN / Reg. No.</td><td><strong>${escapeHtml(t.student_reg_no)}</strong></td></tr>
                  <tr><td class="lbl">Candidate Name</td><td><strong>${escapeHtml(t.student_name)}</strong></td></tr>
                  <tr><td class="lbl">Program / Branch</td><td>${escapeHtml(t.program_code)} — ${escapeHtml(t.program_name)}</td></tr>
                  <tr><td class="lbl">Semester / Section</td><td>${escapeHtml(t.period_name ?? '—')}${t.section_name ? ` / Section ${escapeHtml(t.section_name)}` : ''}</td></tr>
                </table>
                <div class="photo-box">${photoBlock}</div>
              </div>

              <table>
                <thead>
                  <tr>
                    <th style="width:36px">Sl.</th>
                    <th style="width:105px">Course Code</th>
                    <th>Course Title</th>
                    <th style="width:82px">Exam Date</th>
                    <th style="width:128px">Session & Timing</th>
                    <th style="width:48px">Att.</th>
                    <th style="width:92px">Invigilator Sign</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>

              ${
                onlineExempt.length > 0
                  ? `<p class="exempt-note"><strong>Note (ONLINE Courses Exempt from Written Seating):</strong> ${onlineExempt
                      .map((c) => `${escapeHtml(c.course_code)} — ${escapeHtml(c.course_title)}`)
                      .join('; ')}</p>`
                  : ''
              }

              <div class="instructions">
                <strong>Instructions to Candidates:</strong>
                <ol>
                  <li>Candidates must carry this Hall Ticket along with their valid College Identity Card to every examination session.</li>
                  <li>Report to the examination hall at least 15 minutes before the scheduled start time.</li>
                  <li>Mobile phones, smartwatches, and programmable devices are strictly prohibited inside the examination hall.</li>
                  <li>Verify Course Code and Question Paper Version Code before answering.</li>
                </ol>
              </div>

              <div class="signatures">
                ${renderSignatureBlockHtml('Signature of Candidate', null)}
                ${renderSignatureBlockHtml('Principal / Head of Institution', principalSigUrl)}
                ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSigUrl)}
              </div>
            </div>
          </section>`
        })
        .join('')

      openBrandedPrintWindow({
        title: `${cycle.code} — Hall Tickets (${printable.length})`,
        landscape: false,
        branding,
        watermarkMode: 'per-page',
        extraCss: `
          .border-box { border: 1.5px solid #1e293b; padding: 14px; background: transparent; }
          .student-grid { display: flex; gap: 12px; margin-bottom: 12px; align-items: stretch; }
          .info-table { flex: 1; margin-bottom: 0; }
          .info-table .lbl { width: 135px; background: #f1f5f9; font-weight: 600; color: #334155; }
          .photo-box { width: 102px; height: 122px; border: 1px solid #64748b; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #fff; }
          .photo-placeholder { text-align: center; font-size: 9.5px; color: #64748b; line-height: 1.4; }
          .omr { display: inline-block; font-size: 9px; font-weight: 700; border: 1px solid #334155; padding: 0 3px; border-radius: 2px; margin-left: 3px; }
          .exempt-note { font-size: 10px; color: #475569; background: #fffbeb; border: 1px solid #fde68a; padding: 5px 8px; margin: 6px 0 10px; }
          .instructions { border-top: 1px dashed #94a3b8; padding-top: 8px; font-size: 10px; color: #334155; }
          .instructions ol { margin: 4px 0 0 16px; padding: 0; line-height: 1.45; }
        `,
        bodyHtml: pagesHtml,
      })

      if (canPrint) {
        await supabase.rpc('record_hall_ticket_prints', {
          p_institution_id: institutionId,
          p_ticket_ids: printable.map((t) => t.id),
        })
        queryClient.invalidateQueries({ queryKey: ['exam_hall_tickets', institutionId, cycle.id] })
      }
    } finally {
      setIsPrinting(false)
    }
  }

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to issue and print Hall Tickets.
      </div>
    )
  }

  const selectedBatch =
    selectedIds.length > 0
      ? filteredTickets.filter((t) => selectedIds.includes(t.id))
      : filteredTickets.filter((t) => t.status === 'ISSUED')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Hall Tickets — {cycle.code}</h2>
          <p className="text-xs text-slate-500">
            Bulk-issue hall tickets and print A4 PDFs with tenant top-left/top-right logos, watermark, signed student
            photos, and COE/Principal signatures.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canIssue && (
            <>
              <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={requirePaid}
                  onChange={(e) => setRequirePaid(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Require Paid/Waived Fee
              </label>
              <button
                type="button"
                disabled={issueMutation.isPending}
                onClick={() => issueMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', issueMutation.isPending && 'animate-spin')} />
                {issueMutation.isPending ? 'Issuing...' : 'Bulk Issue Hall Tickets'}
              </button>
            </>
          )}
          <button
            type="button"
            disabled={selectedBatch.length === 0 || isPrinting}
            onClick={() => printHallTickets(selectedBatch)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" />
            {isPrinting
              ? 'Signing Assets...'
              : `Print ${selectedIds.length > 0 ? `Selected (${selectedBatch.length})` : `All Issued (${selectedBatch.length})`}`}
          </button>
        </div>
      </div>

      {issueNotice && (
        <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-800">
          {issueNotice}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder="Search by USN, student name, or hall ticket number..."
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
          {programOptions.map(([code, name]) => (
            <option key={code} value={code}>
              {code} — {name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
        >
          <option value="ALL">All Statuses</option>
          <option value="ISSUED">Issued</option>
          <option value="WITHHELD">Withheld</option>
          <option value="REVOKED">Revoked</option>
        </select>
      </div>

      {/* Tickets Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    onChange={toggleSelectAllVisible}
                    checked={
                      filteredTickets.some((t) => t.status === 'ISSUED') &&
                      filteredTickets
                        .filter((t) => t.status === 'ISSUED')
                        .every((t) => selectedIds.includes(t.id))
                    }
                    className="rounded border-slate-300 text-indigo-600"
                  />
                </th>
                <th className="px-4 py-2.5 font-semibold">Student</th>
                <th className="px-4 py-2.5 font-semibold">Hall Ticket / Verify</th>
                <th className="px-4 py-2.5 font-semibold">Program / Sem</th>
                <th className="px-4 py-2.5 font-semibold">Subjects</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Prints</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    Loading hall tickets...
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    <Ticket className="h-6 w-6 text-slate-300 mx-auto mb-1" />
                    No hall tickets issued for {cycle.code} yet. Click <strong>Bulk Issue Hall Tickets</strong> above
                    after approving student registrations.
                  </td>
                </tr>
              ) : (
                filteredTickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        disabled={t.status !== 'ISSUED'}
                        checked={selectedIds.includes(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        className="rounded border-slate-300 text-indigo-600 disabled:opacity-40"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono font-semibold text-slate-900">{t.student_reg_no}</p>
                      <p className="text-slate-600">{t.student_name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium text-slate-800">{t.ticket_number}</p>
                      <p className="text-[10px] font-mono text-slate-500">Code: {t.verification_code}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="font-medium text-slate-800">{t.program_code}</span>
                      <p>
                        {t.period_name ?? '—'}
                        {t.section_name ? ` · Sec ${t.section_name}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {t.eligible_course_count} written/lab
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          TICKET_STATUS_STYLES[t.status]
                        )}
                      >
                        {t.status}
                      </span>
                      {t.withheld_reason && (
                        <p className="text-[10px] text-amber-800 mt-0.5 max-w-[160px] truncate" title={t.withheld_reason}>
                          {t.withheld_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t.print_count}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {t.status === 'ISSUED' && (
                          <button
                            type="button"
                            disabled={isPrinting}
                            title="Print Branded A4 Hall Ticket"
                            onClick={() => printHallTickets([t])}
                            className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canIssue && t.status === 'ISSUED' && (
                          <button
                            type="button"
                            title="Withhold Hall Ticket"
                            onClick={() => {
                              const reason = window.prompt(
                                `Enter reason to withhold hall ticket for ${t.student_reg_no}:`,
                                'Attendance shortage / Fee clearance pending'
                              )
                              if (reason !== null) {
                                updateTicketStatusMutation.mutate({
                                  id: t.id,
                                  status: 'WITHHELD',
                                  reason: reason.trim() || 'Withheld by COE',
                                })
                              }
                            }}
                            className="p-1.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canIssue && t.status !== 'ISSUED' && (
                          <button
                            type="button"
                            title="Release / Re-issue Hall Ticket"
                            onClick={() =>
                              updateTicketStatusMutation.mutate({
                                id: t.id,
                                status: 'ISSUED',
                                reason: null,
                              })
                            }
                            className="p-1.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
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
  )
}
