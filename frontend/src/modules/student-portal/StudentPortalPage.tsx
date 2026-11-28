import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Smartphone,
  Monitor,
  Calendar,
  Ticket,
  Award,
  Search,
  Printer,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  Home,
  User,
  Bell,
  Download,
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

type PortalSection = 'home' | 'results' | 'exams' | 'hall-ticket' | 'subjects' | 'profile'

function fmtPortalTime12h(t: string | null | undefined): string {
  if (!t) return ''
  const [hStr, mStr = '00'] = t.slice(0, 5).split(':')
  const h24 = Number(hStr)
  if (Number.isNaN(h24)) return t.slice(0, 5)
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${String(h12).padStart(2, '0')}:${mStr} ${suffix}`
}

function fmtPortalSession(
  sessionCode: string | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const range = start && end ? `${fmtPortalTime12h(start)} – ${fmtPortalTime12h(end)}` : ''
  if (!sessionCode || sessionCode === 'CUSTOM') return range || '—'
  return range ? `${sessionCode} (${range})` : sessionCode
}

export function StudentPortalPage() {
  const { context, activeInstitutionId, memberships } = useAppStore()
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)

  const [section, setSection] = useState<PortalSection>('home')
  const [resultMode, setResultMode] = useState<'CONSOLIDATED' | 'CYCLE'>('CONSOLIDATED')
  const [selectedCycleId, setSelectedCycleId] = useState<string>('')
  const [usnInput, setUsnInput] = useState('')
  const [activePreviewUsn, setActivePreviewUsn] = useState('')
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null)
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => window.innerWidth >= 768)
  const [viewMode, setViewMode] = useState<'MOBILE' | 'DESKTOP'>('MOBILE')

  useEffect(() => {
    const onResize = () => setIsDesktopViewport(window.innerWidth >= 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // IMPORTANT: Never force global activeExamCycleId (e.g. LEGACY-C14) onto student results.
  // Passing null lets the RPC auto-resolve the student's own latest published cycle while
  // always returning all-cycles Consolidated Results (latest attempts) + published_cycles list.
  const { data: snapshot, isLoading, error } = useQuery<StudentPortalSnapshot>({
    queryKey: ['student_portal_snapshot', activeInstitutionId, selectedCycleId || null, activePreviewUsn],
    enabled: context === 'INSTITUTION' && Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_student_portal_snapshot', {
        p_institution_id: activeInstitutionId!,
        p_exam_cycle_id: selectedCycleId || null,
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
              <tr><th style="width:32px">Sl.</th><th style="width:92px">Code</th><th>Course Title</th><th style="width:84px">Date</th><th style="width:126px">Session &amp; Time</th><th style="width:74px">Room/Seat</th></tr>
            </thead>
            <tbody>
              ${courses
                .map(
                  (c, idx) => `<tr>
                    <td style="text-align:center">${idx + 1}</td>
                    <td style="font-family:monospace;font-weight:700">${escapeHtml(c.course_code)}</td>
                    <td>${escapeHtml(c.course_title)}</td>
                    <td style="text-align:center">${escapeHtml(c.exam_date || 'TBA')}</td>
                    <td style="text-align:center">${escapeHtml(fmtPortalSession(c.session_code, c.start_time, c.end_time))}</td>
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

  const printCycleStatement = async () => {
    if (!activeInstitutionId || !snapshot?.student || !snapshot.cycle) return
    const results = snapshot.course_results ?? []
    if (results.length === 0) return

    const branding = await fetchInstitutionBranding(
      activeInstitutionId,
      activeMembership?.institution.name ?? 'Institution'
    )
    const sigMap = await signPrivateAssets([branding.coe_signature_path])
    const coeSig = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null

    openBrandedPrintWindow({
      title: `Grade_Statement_${snapshot.student.registration_number}_${snapshot.cycle.code}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="border:1.5px solid #1e293b;padding:14px">
          ${renderBrandedHeaderHtml(
            branding,
            `PROVISIONAL STATEMENT OF GRADES — ${snapshot.cycle.name} (${snapshot.cycle.code})`,
            `${snapshot.student.full_name} (${snapshot.student.registration_number}) · ${snapshot.student.program_code} · Sem ${snapshot.student.current_sem}`
          )}
          <table>
            <thead>
              <tr><th style="width:98px">Course</th><th>Course Title (Regular &amp; Arrear)</th><th style="width:42px;text-align:center">Cr</th><th style="width:44px;text-align:center">CIE</th><th style="width:44px;text-align:center">SEE</th><th style="width:46px;text-align:center">Total</th><th style="width:44px;text-align:center">Grade</th><th style="width:62px;text-align:center">Result</th></tr>
            </thead>
            <tbody>
              ${results
                .map(
                  (r) => `<tr>
                    <td style="font-family:monospace;font-weight:700">${escapeHtml(r.course_code)}${r.is_arrear ? '<sup>*</sup>' : ''}</td>
                    <td>${escapeHtml(r.course_title)}${r.is_arrear ? ' <span style="font-size:9px;color:#92400e;font-weight:600">(Arrear / Repeat)</span>' : ''}${r.is_graced ? ` <span style="font-size:9px;color:#065f46">[G+${r.grace_marks_added ?? 0}]</span>` : ''}</td>
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
          ${
            snapshot.semester_result
              ? `<div class="meta">
                  <span><strong>Credits Earned:</strong> ${snapshot.semester_result.credits_earned} / ${snapshot.semester_result.credits_registered}</span>
                  <span><strong>SGPA:</strong> ${Number(snapshot.semester_result.sgpa).toFixed(2)}</span>
                  <span><strong>Cycle Result:</strong> ${escapeHtml(snapshot.semester_result.overall_status)}</span>
                </div>`
              : ''
          }
          <p style="font-size:9.5px;color:#475569;margin-top:8px">
            <sup>*</sup> Denotes Arrear / Supplementary / Repeat subject appeared in this Examination Cycle. This statement reflects all regular and arrear courses taken in ${escapeHtml(snapshot.cycle.code)}.
          </p>
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
        <Smartphone className="h-8 w-8 text-amber-500 mx-auto" />
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
  const consolidatedResults = snapshot?.consolidated_results ?? []
  const consolidatedSummary = snapshot?.consolidated_summary
  const publishedCycles = snapshot?.published_cycles ?? []
  const useMobileLayout = !isDesktopViewport || viewMode === 'MOBILE'

  const firstName = stu?.full_name?.trim().split(/\s+/)[0] || 'Student'
  const firstInitial = stu?.full_name?.trim().charAt(0).toUpperCase() || 'S'

  const renderResultsContent = () => (
    <div className="space-y-3">
      {/* Mode Switcher: Live Latest Attempts (*) vs Official Cycle-Wise Download */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-amber-50/80 border border-amber-200 p-1 text-xs">
        <button
          type="button"
          onClick={() => setResultMode('CONSOLIDATED')}
          className={cn(
            'rounded-lg py-1.5 font-bold transition',
            resultMode === 'CONSOLIDATED' ? 'bg-amber-500 text-white shadow-xs' : 'text-amber-900'
          )}
        >
          Live Results (Latest)
        </button>
        <button
          type="button"
          onClick={() => setResultMode('CYCLE')}
          className={cn(
            'rounded-lg py-1.5 font-bold transition',
            resultMode === 'CYCLE' ? 'bg-amber-500 text-white shadow-xs' : 'text-amber-900'
          )}
        >
          Cycle Print ({publishedCycles.length})
        </button>
      </div>

      {resultMode === 'CONSOLIDATED' ? (
        consolidatedResults.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
            No published results available for this student yet.
          </div>
        ) : (
          <div className="space-y-3">
            {consolidatedSummary && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-white border border-amber-200 p-2.5">
                  <p className="text-[10px] font-bold uppercase text-amber-700">CGPA</p>
                  <p className="text-lg font-extrabold text-slate-900">
                    {Number(consolidatedSummary.cgpa).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-2xl bg-white border border-emerald-200 p-2.5">
                  <p className="text-[10px] font-bold uppercase text-emerald-700">Credits</p>
                  <p className="text-lg font-extrabold text-emerald-900">
                    {consolidatedSummary.credits_earned}/{consolidatedSummary.credits_attempted}
                  </p>
                </div>
                <div
                  className={cn(
                    'rounded-2xl bg-white border p-2.5',
                    consolidatedSummary.active_backlogs > 0 ? 'border-red-200' : 'border-emerald-200'
                  )}
                >
                  <p className="text-[10px] font-bold uppercase text-slate-500">Backlogs</p>
                  <p
                    className={cn(
                      'text-lg font-extrabold',
                      consolidatedSummary.active_backlogs > 0 ? 'text-red-600' : 'text-emerald-700'
                    )}
                  >
                    {consolidatedSummary.active_backlogs}
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-2.5 py-2">Course</th>
                      <th className="px-1.5 py-2 text-center">CIE</th>
                      <th className="px-1.5 py-2 text-center">SEE</th>
                      <th className="px-1.5 py-2 text-center">Tot</th>
                      <th className="px-2 py-2 text-center">Grd</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {consolidatedResults.map((r) => {
                      const passed = r.result_status === 'PASS' || r.result_status === 'EXEMPT'
                      return (
                        <tr key={r.course_id}>
                          <td className="px-2.5 py-2">
                            <div className="flex items-center gap-1">
                              <span className="font-mono font-bold text-slate-900">
                                {r.course_code}
                                {r.is_reattempt && (
                                  <sup
                                    className="ml-0.5 text-amber-600 font-extrabold"
                                    title={`Re-attempt / Arrear in ${r.latest_cycle_code}`}
                                  >
                                    *
                                  </sup>
                                )}
                              </span>
                              <span className="text-[9px] rounded bg-slate-100 px-1 text-slate-500">
                                S{r.semester_number}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 line-clamp-1">{r.course_title}</p>
                          </td>
                          <td className="px-1.5 py-2 text-center text-slate-600">{r.cie_marks ?? '—'}</td>
                          <td className="px-1.5 py-2 text-center text-slate-600">{r.see_marks ?? '—'}</td>
                          <td className="px-1.5 py-2 text-center font-bold text-slate-900">{r.total_marks ?? '—'}</td>
                          <td className="px-2 py-2 text-center">
                            <span
                              className={cn(
                                'rounded-md px-1.5 py-0.5 text-[11px] font-extrabold',
                                passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                              )}
                            >
                              {r.grade_code ?? r.result_status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2 bg-amber-50/60 border-t border-amber-100 text-[10px] text-amber-900">
                <strong>*</strong> Latest attempt from Arrear / Supplementary / Summer / ODE exam. Tap{' '}
                <strong>Cycle Print</strong> above for official exam-cycle downloads (combined Regular + Arrear).
              </div>
            </div>
          </div>
        )
      ) : (
        /* Cycle-Wise Official Download & Combined Regular + Arrear Statement */
        <div className="space-y-3">
          {publishedCycles.length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-2">
              <label className="block text-[10px] font-bold uppercase text-slate-500">
                Select Published Exam Cycle
              </label>
              <select
                value={selectedCycleId || snapshot?.cycle?.id || ''}
                onChange={(e) => setSelectedCycleId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-800"
              >
                {publishedCycles.map((pc) => (
                  <option key={pc.id} value={pc.id}>
                    {pc.code} — {pc.name} ({pc.course_count} subj)
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={courseResults.length === 0 || Boolean(snapshot?.withheld_notice?.is_withheld)}
                onClick={printCycleStatement}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />
                Download / Print Official Cycle Statement (A4)
              </button>
            </div>
          )}

          {snapshot?.withheld_notice?.is_withheld ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Result Withheld — {snapshot.cycle?.code}</p>
                <p className="mt-1">
                  {snapshot.withheld_notice.reason || 'Please contact the Controller of Examinations (COE) Office.'}
                </p>
              </div>
            </div>
          ) : courseResults.length === 0 ? (
            <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
              No published cycle statement found.
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              {snapshot?.semester_result && (
                <div className="px-3.5 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between text-xs">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-amber-700">{snapshot.cycle?.code} · SGPA</p>
                    <p className="text-lg font-extrabold text-amber-950">
                      {Number(snapshot.semester_result.sgpa).toFixed(2)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-900">{snapshot.semester_result.overall_status}</p>
                    <p className="text-[11px] text-slate-600">
                      Cr: {snapshot.semester_result.credits_earned}/{snapshot.semester_result.credits_registered}
                    </p>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-2.5 py-2">Course (Reg + Arrear)</th>
                      <th className="px-1.5 py-2 text-center">CIE</th>
                      <th className="px-1.5 py-2 text-center">SEE</th>
                      <th className="px-1.5 py-2 text-center">Tot</th>
                      <th className="px-2 py-2 text-center">Grd</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {courseResults.map((r) => (
                      <tr key={`${r.course_code}-${r.attempt_number ?? 1}`}>
                        <td className="px-2.5 py-2">
                          <span className="font-mono font-bold text-slate-900">
                            {r.course_code}
                            {r.is_arrear && <sup className="ml-0.5 text-amber-600 font-extrabold">*</sup>}
                          </span>
                          {r.is_arrear && (
                            <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900">
                              ARREAR
                            </span>
                          )}
                          <p className="text-[10px] text-slate-500 line-clamp-1">{r.course_title}</p>
                        </td>
                        <td className="px-1.5 py-2 text-center text-slate-600">{r.cie_marks ?? '—'}</td>
                        <td className="px-1.5 py-2 text-center text-slate-600">{r.see_marks ?? '—'}</td>
                        <td className="px-1.5 py-2 text-center font-bold">{r.total_marks ?? '—'}</td>
                        <td className="px-2 py-2 text-center font-extrabold text-indigo-700">
                          {r.grade_code ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const renderExamsContent = () => (
    <div className="space-y-2.5">
      {courses.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
          No upcoming exam timetable slots found for {snapshot?.cycle?.code ?? 'active cycle'}.
        </div>
      ) : (
        courses.map((c) => (
          <div key={c.course_id} className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-1.5 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-xs font-bold text-indigo-800">{c.course_code}</span>
                <p className="text-xs font-semibold text-slate-900">{c.course_title}</p>
              </div>
              {c.is_omr_exam && (
                <span className="rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[9px] font-bold">OMR</span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[11px]">
              <span className="inline-flex items-center gap-1 text-slate-600">
                <Calendar className="h-3.5 w-3.5 text-amber-500" />
                {c.exam_date ? `${c.exam_date} · ${fmtPortalSession(c.session_code, c.start_time, c.end_time)}` : 'Date TBA'}
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                <MapPin className="h-3.5 w-3.5" />
                {c.room_number ? `Rm ${c.room_number} · Seat ${c.seat_label ?? ''}` : 'Seat Pending'}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  )

  const renderHallTicketContent = () => (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
      {!snapshot?.hall_ticket ? (
        <p className="text-xs text-slate-500 text-center py-6">
          Hall Ticket has not been issued for {snapshot?.cycle?.code ?? 'this cycle'} yet.
        </p>
      ) : snapshot.hall_ticket.status === 'ISSUED' ? (
        <>
          <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold">
            <CheckCircle2 className="h-4 w-4" />
            Hall Ticket Issued &amp; Ready ({snapshot.cycle?.code})
          </div>
          <div className="rounded-xl bg-amber-50/60 border border-amber-200 p-3 text-xs space-y-1">
            <p><strong>Ticket No:</strong> <span className="font-mono">{snapshot.hall_ticket.ticket_number}</span></p>
            <p><strong>Verify Code:</strong> <span className="font-mono">{snapshot.hall_ticket.verification_code}</span></p>
            <p><strong>Eligible Subjects:</strong> {snapshot.hall_ticket.eligible_course_count}</p>
          </div>
          <button
            type="button"
            onClick={printHallTicket}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-amber-600"
          >
            <Printer className="h-4 w-4" /> Download / Print A4 Hall Ticket
          </button>
        </>
      ) : (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Hall Ticket {snapshot.hall_ticket.status}</p>
            <p className="mt-1">{snapshot.hall_ticket.withheld_reason || 'Contact COE / Accounts Desk.'}</p>
          </div>
        </div>
      )}
    </div>
  )

  const renderSubjectsContent = () => (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
      <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
        Academic Subjects ({consolidatedResults.length || courses.length})
      </h3>
      {courses.length === 0 && consolidatedResults.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">No registered subjects found.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-xs">
          {(courses.length > 0 ? courses : consolidatedResults).map((c) => (
            <li key={c.course_id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono font-bold text-indigo-900">{c.course_code}</span>
                <p className="text-slate-600 truncate">{c.course_title}</p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                {c.credits} Cr
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const renderProfileContent = () =>
    stu && (
      <div className="rounded-2xl bg-white border border-slate-200 p-5 text-center space-y-3">
        <div className="mx-auto h-20 w-20 rounded-full bg-amber-200 border-2 border-amber-400 overflow-hidden flex items-center justify-center text-2xl font-extrabold text-amber-800">
          {signedPhotoUrl ? (
            <img src={signedPhotoUrl} alt={stu.full_name} className="h-full w-full object-cover" />
          ) : (
            firstInitial
          )}
        </div>
        <div>
          <h3 className="text-base font-extrabold text-slate-900">{stu.full_name}</h3>
          <p className="text-xs font-mono font-bold text-amber-700">{stu.registration_number}</p>
          <p className="text-xs text-slate-500 mt-1">
            {stu.program_name || stu.program_code} · Sem {stu.current_sem}
            {stu.section_name ? ` · Sec ${stu.section_name}` : ''}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-left text-xs pt-2 border-t border-slate-100">
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">Category</p>
            <p className="font-bold text-slate-800">{stu.student_category}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">Published Cycles</p>
            <p className="font-bold text-slate-800">{publishedCycles.length}</p>
          </div>
        </div>
      </div>
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Student Portal</h1>
          <p className="text-xs text-slate-500">
            Mobile-first campus view for Live Results (*), Official Cycle Statements, Hall Tickets &amp; Seat Locator.
          </p>
        </div>
        {isDesktopViewport && stu && (
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'MOBILE' ? 'DESKTOP' : 'MOBILE'))}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {viewMode === 'MOBILE' ? (
              <>
                <Monitor className="h-3.5 w-3.5" /> Switch to Desktop View
              </>
            ) : (
              <>
                <Smartphone className="h-3.5 w-3.5" /> Switch to Mobile View
              </>
            )}
          </button>
        )}
      </div>

      {/* Staff/Admin USN Preview Bar */}
      {(snapshot?.can_preview || !snapshot?.found) && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSelectedCycleId('')
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
                setSelectedCycleId('')
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
      ) : useMobileLayout ? (
        /* MOBILE-FIRST APP FRAME (matches BOS-BOE StudentPortal.jsx) */
        <div className="mx-auto w-full max-w-[420px] min-h-[760px] rounded-[36px] border-[6px] border-slate-800 bg-[#FDFBF7] shadow-2xl relative overflow-hidden flex flex-col">
          {/* Top App Bar */}
          <div className="px-5 pt-6 pb-3 flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">Welcome Back</p>
              <h2 className="text-2xl font-extrabold text-[#1a1c4b]">Hi, {firstName}</h2>
            </div>
            <button
              type="button"
              onClick={() => setSection('results')}
              className="relative h-10 w-10 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center"
              title="Latest Results"
            >
              <Bell className="h-4 w-4 text-[#1a1c4b]" />
              {consolidatedResults.length > 0 && (
                <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-amber-500" />
              )}
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-4">
            {section === 'home' && (
              <>
                {/* Profile + Semester / CGPA / Backlogs Card */}
                <div className="rounded-3xl bg-white p-4 shadow-sm border border-slate-100 space-y-4">
                  <div className="flex items-center gap-3.5">
                    <div className="h-14 w-14 rounded-full bg-amber-200 overflow-hidden flex items-center justify-center font-extrabold text-xl text-amber-800 shrink-0">
                      {signedPhotoUrl ? (
                        <img src={signedPhotoUrl} alt={stu.full_name} className="h-full w-full object-cover" />
                      ) : (
                        firstInitial
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold text-slate-900 truncate">{stu.full_name}</p>
                      <p className="text-xs text-slate-500 truncate">{stu.program_name || stu.program_code}</p>
                      <p className="text-[11px] font-mono text-slate-400">USN: {stu.registration_number}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 rounded-2xl bg-[#fff7ed] p-3 text-center">
                    <div className="border-r border-amber-200/80">
                      <p className="text-[10px] font-semibold text-amber-600">Semester</p>
                      <p className="text-xl font-extrabold text-amber-700">
                        {String(stu.current_sem).padStart(2, '0')}
                      </p>
                    </div>
                    <div className="border-r border-amber-200/80">
                      <p className="text-[10px] font-semibold text-amber-600">CGPA</p>
                      <p className="text-xl font-extrabold text-amber-700">
                        {consolidatedSummary && consolidatedSummary.total_courses > 0
                          ? Number(consolidatedSummary.cgpa).toFixed(2)
                          : 'TBD'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-amber-600">Backlogs</p>
                      <p
                        className={cn(
                          'text-xl font-extrabold',
                          (consolidatedSummary?.active_backlogs ?? 0) > 0 ? 'text-red-600' : 'text-emerald-700'
                        )}
                      >
                        {consolidatedSummary?.active_backlogs ?? 0}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quick Actions Grid (3×2 matching BOS-BOE StudentPortal.jsx) */}
                <div className="space-y-2.5">
                  <h3 className="text-sm font-extrabold text-slate-900">Your campus, simplified</h3>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      {
                        label: 'Live Results (*)',
                        icon: Award,
                        color: 'text-amber-600',
                        onClick: () => {
                          setResultMode('CONSOLIDATED')
                          setSection('results')
                        },
                      },
                      {
                        label: 'Cycle Print',
                        icon: Download,
                        color: 'text-indigo-600',
                        onClick: () => {
                          setResultMode('CYCLE')
                          setSection('results')
                        },
                      },
                      {
                        label: 'Exams & Seat',
                        icon: Calendar,
                        color: 'text-teal-600',
                        onClick: () => setSection('exams'),
                      },
                      {
                        label: 'Hall Ticket',
                        icon: Ticket,
                        color: 'text-violet-600',
                        onClick: () => setSection('hall-ticket'),
                      },
                      {
                        label: 'My Subjects',
                        icon: BookOpen,
                        color: 'text-blue-600',
                        onClick: () => setSection('subjects'),
                      },
                      {
                        label: 'My Profile',
                        icon: User,
                        color: 'text-pink-600',
                        onClick: () => setSection('profile'),
                      },
                    ].map(({ label, icon: Icon, color, onClick }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={onClick}
                        className="rounded-2xl bg-white p-3 shadow-xs border border-slate-100 flex flex-col items-center gap-2 hover:border-amber-300 transition"
                      >
                        <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center">
                          <Icon className={cn('h-5 w-5', color)} />
                        </div>
                        <span className="text-[11px] font-semibold text-slate-700 text-center leading-tight">
                          {label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Snapshot of Latest Consolidated Results */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-slate-900">Latest Result Summary</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setResultMode('CONSOLIDATED')
                        setSection('results')
                      }}
                      className="text-xs font-bold text-amber-600 hover:underline"
                    >
                      View all →
                    </button>
                  </div>
                  {consolidatedResults.length === 0 ? (
                    <div className="rounded-2xl bg-white p-4 text-center text-xs text-slate-400 border border-slate-100">
                      No published results yet.
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-white p-3.5 border border-slate-100 space-y-2">
                      {consolidatedResults.slice(0, 4).map((r) => (
                        <div key={r.course_id} className="flex items-center justify-between text-xs">
                          <div className="min-w-0 pr-2">
                            <span className="font-mono font-bold text-slate-900">
                              {r.course_code}
                              {r.is_reattempt && <sup className="text-amber-600">*</sup>}
                            </span>
                            <p className="text-[10px] text-slate-500 truncate">{r.course_title}</p>
                          </div>
                          <span className="font-extrabold text-indigo-700 shrink-0">
                            {r.grade_code ?? r.result_status} ({r.total_marks ?? '—'})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {section === 'results' && renderResultsContent()}
            {section === 'exams' && renderExamsContent()}
            {section === 'hall-ticket' && renderHallTicketContent()}
            {section === 'subjects' && renderSubjectsContent()}
            {section === 'profile' && renderProfileContent()}
          </div>

          {/* Floating Rounded Bottom Nav Bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-slate-200/70 rounded-t-3xl px-6 py-3 flex justify-between">
            {(
              [
                { id: 'home', label: 'Home', icon: Home },
                { id: 'results', label: 'Results', icon: Award },
                { id: 'exams', label: 'Exams', icon: Calendar },
                { id: 'profile', label: 'Profile', icon: User },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const active = section === id || (id === 'exams' && section === 'hall-ticket')
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  className="flex flex-col items-center gap-1 w-14"
                >
                  <Icon className={cn('h-5 w-5 transition', active ? 'text-amber-500' : 'text-slate-400')} />
                  <span className={cn('text-[10px] font-bold', active ? 'text-amber-600' : 'text-slate-400')}>
                    {label}
                  </span>
                  <span className={cn('h-1 w-5 rounded-full', active ? 'bg-amber-500' : 'bg-transparent')} />
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        /* DESKTOP VIEW (optional toggle on wide screens) */
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="rounded-2xl bg-slate-900 text-white p-4 flex items-center gap-4 shadow-sm">
            <div className="h-16 w-14 rounded-xl bg-slate-800 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0 font-bold text-xl text-amber-300">
              {signedPhotoUrl ? (
                <img src={signedPhotoUrl} alt={stu.full_name} className="h-full w-full object-cover" />
              ) : (
                firstInitial
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold truncate">{stu.full_name}</p>
              <p className="text-xs font-mono text-amber-300">{stu.registration_number}</p>
              <p className="text-xs text-slate-300 mt-0.5 truncate">
                {stu.program_code ?? 'GEN'} · Sem {stu.current_sem}
                {stu.section_name ? ` · Sec ${stu.section_name}` : ''} · {stu.student_category}
              </p>
            </div>
            {consolidatedSummary && (
              <div className="hidden sm:flex gap-3 text-right text-xs">
                <div className="rounded-xl bg-white/10 px-3 py-1.5">
                  <p className="text-[10px] text-amber-200">CGPA</p>
                  <p className="text-base font-extrabold">{Number(consolidatedSummary.cgpa).toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-white/10 px-3 py-1.5">
                  <p className="text-[10px] text-slate-300">Backlogs</p>
                  <p className="text-base font-extrabold">{consolidatedSummary.active_backlogs}</p>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-5 gap-1.5 bg-white p-1.5 rounded-xl border border-slate-200 text-xs">
            {(
              [
                { id: 'results', label: 'Results (*)', icon: Award },
                { id: 'exams', label: 'Exams & Seat', icon: Calendar },
                { id: 'hall-ticket', label: 'Hall Ticket', icon: Ticket },
                { id: 'subjects', label: 'My Subjects', icon: BookOpen },
                { id: 'profile', label: 'Profile', icon: User },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg font-semibold transition',
                  (section === 'home' && id === 'results') || section === id
                    ? 'bg-amber-500 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {(section === 'home' || section === 'results') && renderResultsContent()}
          {section === 'exams' && renderExamsContent()}
          {section === 'hall-ticket' && renderHallTicketContent()}
          {section === 'subjects' && renderSubjectsContent()}
          {section === 'profile' && renderProfileContent()}
        </div>
      )}
    </div>
  )
}
