import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Smartphone,
  Calendar,
  Ticket,
  Award,
  Search,
  Printer,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { StudentPortalSnapshot } from '@/types/operations'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
  signStudentPhotosWithFallback,
} from '@/modules/exams/printBranding'
import { cn } from '@/utils/cn'

type PortalSection = 'overview' | 'timetable' | 'hall-ticket' | 'results'

export function StudentPortalPage() {
  const { context, activeInstitutionId, activeExamCycleId, memberships } = useAppStore()
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)

  const [section, setSection] = useState<PortalSection>('overview')
  const [usnInput, setUsnInput] = useState('')
  const [activePreviewUsn, setActivePreviewUsn] = useState('')
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null)

  const { data: snapshot, isLoading, error } = useQuery<StudentPortalSnapshot>({
    queryKey: ['student_portal_snapshot', activeInstitutionId, activeExamCycleId, activePreviewUsn],
    enabled: context === 'INSTITUTION' && Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_student_portal_snapshot', {
        p_institution_id: activeInstitutionId!,
        p_exam_cycle_id: activeExamCycleId ?? null,
        p_preview_usn: activePreviewUsn.trim() || null,
      })
      if (rpcErr) throw rpcErr
      return data as StudentPortalSnapshot
    },
  })

  useEffect(() => {
    const stu = snapshot?.student
    if (!activeInstitutionId || !stu) {
      setSignedPhotoUrl(null)
      return
    }
    let cancelled = false
    signStudentPhotosWithFallback(activeInstitutionId, [
      {
        key: stu.id,
        photo_url: stu.photo_url,
        registration_number: stu.registration_number,
        admission_number: stu.admission_number,
      },
    ]).then((map) => {
      if (!cancelled) setSignedPhotoUrl(map.get(stu.id) ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [activeInstitutionId, snapshot?.student])

  const printHallTicket = async () => {
    if (!activeInstitutionId || !snapshot?.student || !snapshot.hall_ticket || !snapshot.cycle) return
    const branding = await fetchInstitutionBranding(
      activeInstitutionId,
      activeMembership?.institution.name ?? 'Institution'
    )
    const sigMap = await signPrivateAssets([
      branding.coe_signature_path,
      branding.principal_signature_path,
    ])
    const coeSig = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null
    const prinSig = branding.principal_signature_path ? (sigMap.get(branding.principal_signature_path) ?? null) : null
    const courses = snapshot.registered_courses ?? []

    openBrandedPrintWindow({
      title: `Hall_Ticket_${snapshot.student.registration_number}_${snapshot.cycle.code}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="border:1.5px solid #1e293b;padding:14px">
          ${renderBrandedHeaderHtml(
            branding,
            `PROVISIONAL ADMISSION / HALL TICKET — ${snapshot.cycle.code}`,
            `${snapshot.cycle.name} (${snapshot.cycle.cycle_type})`
          )}
          <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:10px">
            <table style="flex:1;margin:0">
              <tbody>
                <tr><th style="width:120px">USN</th><td style="font-family:monospace;font-weight:700">${escapeHtml(snapshot.student.registration_number)}</td></tr>
                <tr><th>Student Name</th><td><strong>${escapeHtml(snapshot.student.full_name)}</strong></td></tr>
                <tr><th>Program / Sem</th><td>${escapeHtml(snapshot.student.program_code)} — Sem ${snapshot.student.current_sem}</td></tr>
                <tr><th>Ticket / Code</th><td style="font-family:monospace">${escapeHtml(snapshot.hall_ticket.ticket_number)} · ${escapeHtml(snapshot.hall_ticket.verification_code)}</td></tr>
              </tbody>
            </table>
            <div style="width:88px;height:106px;border:1px solid #475569;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
              ${signedPhotoUrl ? `<img src="${escapeHtml(signedPhotoUrl)}" style="width:100%;height:100%;object-fit:cover" alt="" />` : '<span style="font-size:9px;color:#64748b">PHOTO</span>'}
            </div>
          </div>
          <table>
            <thead>
              <tr><th style="width:32px">Sl.</th><th style="width:92px">Code</th><th>Course Title</th><th style="width:86px">Date</th><th style="width:74px">Session</th><th style="width:74px">Room/Seat</th></tr>
            </thead>
            <tbody>
              ${courses
                .map(
                  (c, idx) => `<tr>
                    <td style="text-align:center">${idx + 1}</td>
                    <td style="font-family:monospace;font-weight:700">${escapeHtml(c.course_code)}</td>
                    <td>${escapeHtml(c.course_title)}</td>
                    <td style="text-align:center">${escapeHtml(c.exam_date || 'TBA')}</td>
                    <td style="text-align:center">${escapeHtml(c.session_code || '—')}</td>
                    <td style="text-align:center">${escapeHtml(c.room_number ? `${c.room_number} / ${c.seat_label ?? ''}` : 'TBA')}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
          <div class="signatures">
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Signature of Candidate</span></div>
            ${renderSignatureBlockHtml('Controller of Examinations', coeSig)}
            ${renderSignatureBlockHtml('Principal', prinSig)}
          </div>
        </div>
      </section>`,
    })
  }

  const printGradeCard = async () => {
    if (!activeInstitutionId || !snapshot?.student || !snapshot.semester_result || !snapshot.cycle) return
    const branding = await fetchInstitutionBranding(
      activeInstitutionId,
      activeMembership?.institution.name ?? 'Institution'
    )
    const sigMap = await signPrivateAssets([branding.coe_signature_path])
    const coeSig = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null
    const results = snapshot.course_results ?? []

    openBrandedPrintWindow({
      title: `Grade_Card_${snapshot.student.registration_number}_${snapshot.cycle.code}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="border:1.5px solid #1e293b;padding:14px">
          ${renderBrandedHeaderHtml(
            branding,
            `PROVISIONAL STATEMENT OF GRADES — ${snapshot.cycle.code}`,
            `${snapshot.student.full_name} (${snapshot.student.registration_number}) · ${snapshot.student.program_code} · Sem ${snapshot.student.current_sem}`
          )}
          <table>
            <thead>
              <tr><th style="width:92px">Course</th><th>Title</th><th style="width:46px;text-align:center">Cr</th><th style="width:46px;text-align:center">CIE</th><th style="width:46px;text-align:center">SEE</th><th style="width:48px;text-align:center">Total</th><th style="width:46px;text-align:center">Grade</th><th style="width:62px;text-align:center">Result</th></tr>
            </thead>
            <tbody>
              ${results
                .map(
                  (r) => `<tr>
                    <td style="font-family:monospace;font-weight:700">${escapeHtml(r.course_code)}</td>
                    <td>${escapeHtml(r.course_title)}</td>
                    <td style="text-align:center">${r.credits}</td>
                    <td style="text-align:center">${r.cie_marks ?? '—'}</td>
                    <td style="text-align:center">${r.see_marks ?? '—'}</td>
                    <td style="text-align:center;font-weight:700">${r.total_marks ?? '—'}</td>
                    <td style="text-align:center;font-weight:700">${escapeHtml(r.grade_code ?? '—')}</td>
                    <td style="text-align:center">${escapeHtml(r.result_status)}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
          <div class="meta">
            <span><strong>Credits Earned:</strong> ${snapshot.semester_result.credits_earned} / ${snapshot.semester_result.credits_registered}</span>
            <span><strong>SGPA:</strong> ${Number(snapshot.semester_result.sgpa).toFixed(2)}</span>
            <span><strong>Overall Result:</strong> ${escapeHtml(snapshot.semester_result.overall_status)}</span>
          </div>
          <div class="signatures">
            <div class="sig-col"></div>
            ${renderSignatureBlockHtml('Controller of Examinations', coeSig)}
          </div>
        </div>
      </section>`,
    })
  }

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <Smartphone className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to open the Mobile-First Student Portal.
        </p>
      </div>
    )
  }

  const stu = snapshot?.student
  const courses = snapshot?.registered_courses ?? []
  const courseResults = snapshot?.course_results ?? []

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-16 sm:pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Student Portal</h1>
          <p className="text-xs text-slate-500">
            Authenticated self-service timetable, room/seat locator, hall ticket &amp; published grade card.
          </p>
        </div>
      </div>

      {/* Staff/Admin USN Preview Bar */}
      {(snapshot?.can_preview || !snapshot?.found) && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setActivePreviewUsn(usnInput.trim().toUpperCase())
          }}
          className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 flex flex-wrap items-center gap-2"
        >
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Staff Preview: enter Student USN (e.g. 1AM25CS001)..."
              value={usnInput}
              onChange={(e) => setUsnInput(e.target.value.toUpperCase())}
              className="w-full rounded-md border border-indigo-300 bg-white pl-8 pr-3 py-1.5 text-xs font-mono uppercase"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            Load Student View
          </button>
          {activePreviewUsn && (
            <button
              type="button"
              onClick={() => {
                setUsnInput('')
                setActivePreviewUsn('')
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
            >
              Reset
            </button>
          )}
        </form>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error instanceof Error ? error.message : 'Unable to load student portal'}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          Loading student portal...
        </div>
      ) : !snapshot?.found || !stu ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center space-y-2">
          <Smartphone className="h-8 w-8 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">No Student Profile Linked</p>
          <p className="text-xs text-slate-500">{snapshot?.reason}</p>
        </div>
      ) : (
        <>
          {/* Student Digital ID Header Card */}
          <div className="rounded-xl bg-slate-900 text-white p-4 flex items-center gap-4 shadow-sm">
            <div className="h-16 w-14 rounded-lg bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
              {signedPhotoUrl ? (
                <img src={signedPhotoUrl} alt={stu.full_name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] text-slate-400 font-semibold">NO PHOTO</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold truncate">{stu.full_name}</p>
              <p className="text-xs font-mono text-indigo-300">{stu.registration_number}</p>
              <p className="text-xs text-slate-300 mt-0.5 truncate">
                {stu.program_code ?? 'GEN'} · Sem {stu.current_sem}
                {stu.section_name ? ` · Sec ${stu.section_name}` : ''} · {stu.student_category}
              </p>
            </div>
            {snapshot.cycle && (
              <span className="hidden sm:inline-block rounded-full bg-indigo-600/30 border border-indigo-400/40 px-3 py-1 text-[11px] font-semibold text-indigo-100 shrink-0">
                {snapshot.cycle.code}
              </span>
            )}
          </div>

          {/* Mobile-Friendly Section Switcher */}
          <div className="grid grid-cols-4 gap-1.5 bg-white p-1.5 rounded-xl border border-slate-200 text-xs">
            {(
              [
                { id: 'overview', label: 'Overview', icon: BookOpen },
                { id: 'timetable', label: 'Exams & Seat', icon: Calendar },
                { id: 'hall-ticket', label: 'Hall Ticket', icon: Ticket },
                { id: 'results', label: 'Results', icon: Award },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  'flex flex-col sm:flex-row items-center justify-center gap-1 py-2 px-1 rounded-lg font-medium transition',
                  section === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-[11px] sm:text-xs">{label}</span>
              </button>
            ))}
          </div>

          {/* OVERVIEW */}
          {section === 'overview' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] uppercase text-slate-500 font-semibold">Exam Registration</p>
                  <p className="text-base font-bold text-slate-900 mt-1">
                    {snapshot.registration ? snapshot.registration.status : 'Not Registered'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {snapshot.registration
                      ? `${snapshot.registration.payment_status} · ₹${Number(snapshot.registration.total_fee ?? 0).toLocaleString('en-IN')}`
                      : 'Contact Front Office'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] uppercase text-slate-500 font-semibold">Hall Ticket</p>
                  <p className="text-base font-bold text-slate-900 mt-1">
                    {snapshot.hall_ticket ? snapshot.hall_ticket.status : 'Pending'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {snapshot.hall_ticket
                      ? `${snapshot.hall_ticket.eligible_course_count} eligible courses`
                      : 'Issued by COE prior to exams'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Registered Courses ({courses.length})
                </h2>
                {courses.length === 0 ? (
                  <p className="text-xs text-slate-500">No exam courses registered in {snapshot.cycle?.code ?? 'this cycle'}.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-xs">
                    {courses.map((c) => (
                      <li key={c.course_id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-indigo-900">{c.course_code}</span>
                          <p className="text-slate-700">{c.course_title}</p>
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 shrink-0">
                          {c.registration_category}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* TIMETABLE & SEAT LOCATOR */}
          {section === 'timetable' && (
            <div className="space-y-3">
              {courses.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                  No scheduled exams found for this cycle.
                </div>
              ) : (
                courses.map((c) => (
                  <div key={c.course_id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs font-bold text-indigo-800">{c.course_code}</span>
                        <h3 className="text-sm font-semibold text-slate-900">{c.course_title}</h3>
                      </div>
                      {c.is_omr_exam && (
                        <span className="rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[10px] font-bold">
                          OMR
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 pt-1 border-t border-slate-100">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                        {c.exam_date ? `${c.exam_date} · ${c.session_code} (${c.start_time?.slice(0, 5)}–${c.end_time?.slice(0, 5)})` : 'Date TBA'}
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <MapPin className="h-3.5 w-3.5" />
                        {c.room_number
                          ? `Room ${c.room_number}${c.block_name ? ` (${c.block_name})` : ''} · Seat ${c.seat_label}`
                          : 'Room Allotment Pending'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* HALL TICKET */}
          {section === 'hall-ticket' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              {!snapshot.hall_ticket ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  Hall Ticket has not been generated for {snapshot.cycle?.code ?? 'this cycle'} yet.
                </p>
              ) : snapshot.hall_ticket.status === 'ISSUED' ? (
                <>
                  <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                    <CheckCircle2 className="h-4 w-4" />
                    Hall Ticket Issued &amp; Ready to Print
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                    <p><strong>Ticket Number:</strong> <span className="font-mono">{snapshot.hall_ticket.ticket_number}</span></p>
                    <p><strong>Verification Code:</strong> <span className="font-mono">{snapshot.hall_ticket.verification_code}</span></p>
                    <p><strong>Eligible Subjects:</strong> {snapshot.hall_ticket.eligible_course_count}</p>
                  </div>
                  <button
                    type="button"
                    onClick={printHallTicket}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    <Printer className="h-4 w-4" /> Download / Print Branded A4 Hall Ticket
                  </button>
                </>
              ) : (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Hall Ticket {snapshot.hall_ticket.status}</p>
                    <p className="mt-1">{snapshot.hall_ticket.withheld_reason || 'Please contact the COE / Accounts Desk.'}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PUBLISHED RESULTS */}
          {section === 'results' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              {!snapshot.semester_result && courseResults.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  Results for {snapshot.cycle?.code ?? 'this cycle'} have not been published yet.
                </p>
              ) : (
                <>
                  {snapshot.semester_result && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-indigo-50 border border-indigo-200 p-3 text-xs">
                      <div>
                        <p className="text-indigo-700 font-semibold">SGPA</p>
                        <p className="text-2xl font-bold text-indigo-950">
                          {Number(snapshot.semester_result.sgpa).toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-900">{snapshot.semester_result.overall_status}</p>
                        <p className="text-slate-600">
                          Credits: {snapshot.semester_result.credits_earned} / {snapshot.semester_result.credits_registered}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={printGradeCard}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                      >
                        <Printer className="h-3.5 w-3.5" /> Print Provisional Grade Card
                      </button>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Course</th>
                          <th className="px-3 py-2 text-center">CIE</th>
                          <th className="px-3 py-2 text-center">SEE</th>
                          <th className="px-3 py-2 text-center">Total</th>
                          <th className="px-3 py-2 text-center">Grade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {courseResults.map((r) => (
                          <tr key={r.course_code}>
                            <td className="px-3 py-2">
                              <span className="font-mono font-bold text-slate-900">{r.course_code}</span>
                              <p className="text-[11px] text-slate-500">{r.course_title}</p>
                            </td>
                            <td className="px-3 py-2 text-center">{r.cie_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-center">{r.see_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-center font-bold">{r.total_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-center font-bold text-indigo-700">{r.grade_code ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
