import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  ClipboardCheck,
  Sparkles,
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
import { printOfficialCourseRegistrationForms } from '@/modules/front-office/courseRegPrint'
import { cn } from '@/utils/cn'

type PortalSection = 'home' | 'course-reg' | 'results' | 'exams' | 'hall-ticket' | 'subjects' | 'profile'

interface StudentCourseRegContext {
  found: boolean
  student?: {
    id: string
    registration_number: string
    admission_number: string | null
    full_name: string
    photo_url: string | null
    photo_pin: string | null
    program_code: string
    program_level: string
    current_sem: number
    scheme_batch: number | null
    student_category: string
    specialization_code: string
  }
  active_window?: {
    id: string
    title: string
    academic_year: string
    term: string
    closes_at: string | null
    instructions: string | null
  } | null
  curriculum?: { code: string; name: string; scheme_batch: number | null } | null
  target_academic_year: string
  target_term: string
  has_submitted: boolean
  submitted_at: string | null
  is_high_priority_pending: boolean
  mandatory_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string }>
  lateral_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string }>
  pe_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string }>
  oe_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string; branch_code: string }>
  submitted_courses: Array<{ course_id: string; course_code: string; course_title: string; credits: number; course_type: string }>
}

const NON_CREDIT_GRADES = new Set(['PP', 'NP', 'EX'])

function isNonCreditGrade(gradeCode: string | null | undefined, credits: number): boolean {
  const g = (gradeCode ?? '').trim().toUpperCase()
  return NON_CREDIT_GRADES.has(g) || credits === 0
}

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
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<'MOBILE' | 'DESKTOP'>('MOBILE')
  const [selectedPeId, setSelectedPeId] = useState('')
  const [selectedOeId, setSelectedOeId] = useState('')
  const [regNotice, setRegNotice] = useState<string | null>(null)
  const [regError, setRegError] = useState<string | null>(null)

  useEffect(() => {
    const onResize = () => setIsDesktopViewport(window.innerWidth >= 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const { data: courseRegCtx } = useQuery<StudentCourseRegContext>({
    queryKey: ['student_course_reg_ctx', activeInstitutionId, activePreviewUsn],
    enabled: context === 'INSTITUTION' && Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_student_course_reg_context', {
        p_institution_id: activeInstitutionId!,
        p_preview_usn: activePreviewUsn.trim() || null,
      })
      if (rpcErr) throw rpcErr
      return data as StudentCourseRegContext
    },
  })

  const submitStudentRegMutation = useMutation({
    mutationFn: async () => {
      if (!activeInstitutionId || !courseRegCtx?.active_window) {
        throw new Error('No open Course Registration Window found.')
      }
      const { data, error: rpcErr } = await supabase.rpc('submit_student_course_registration', {
        p_institution_id: activeInstitutionId,
        p_window_id: courseRegCtx.active_window.id,
        p_selected_pe_ids: selectedPeId ? [selectedPeId] : [],
        p_selected_oe_ids: selectedOeId ? [selectedOeId] : [],
        p_preview_usn: activePreviewUsn.trim() || null,
      })
      if (rpcErr) throw rpcErr
      return data as { courses_registered: number; academic_year: string; term: string; semester_number: number }
    },
    onSuccess: (res) => {
      setRegError(null)
      setRegNotice(
        `Course Registration submitted (${res.courses_registered} courses for Sem ${res.semester_number} · ${res.academic_year} ${res.term}). Download your Official Copy below.`
      )
      queryClient.invalidateQueries({ queryKey: ['student_course_reg_ctx', activeInstitutionId] })
      queryClient.invalidateQueries({ queryKey: ['student_portal_snapshot', activeInstitutionId] })
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : typeof (err as { message?: unknown })?.message === 'string'
            ? String((err as { message: string }).message)
            : 'Submission failed'
      setRegError(msg)
    },
  })

  // Group Consolidated Latest-Attempt Results cleanly by Curriculum Semester with per-semester SGPA, Credits & %
  const semesterGroups = useMemo(() => {
    const list = snapshot?.consolidated_results ?? []
    const bySem = new Map<number, typeof list>()
    for (const r of list) {
      const sNum = Number(r.semester_number || 1)
      const arr = bySem.get(sNum) ?? []
      arr.push(r)
      bySem.set(sNum, arr)
    }

    return Array.from(bySem.entries())
      .sort(([a], [b]) => a - b)
      .map(([semNumber, items]) => {
        let crReg = 0
        let crEarn = 0
        let gradedCr = 0
        let weightedGp = 0
        let marksObt = 0
        let marksMax = 0
        let hasFail = false

        for (const r of items) {
          const cr = Number(r.credits ?? 0)
          const nonCr = isNonCreditGrade(r.grade_code, cr)
          const passed = r.result_status === 'PASS' || r.result_status === 'EXEMPT'
          crReg += cr
          if (passed) crEarn += cr
          else hasFail = true

          if (!nonCr) {
            gradedCr += cr
            if (passed) weightedGp += cr * Number(r.grade_point ?? 0)
            marksObt += Number(r.total_marks ?? 0)
            marksMax += 100
          }
        }

        const sgpa = gradedCr > 0 ? Number((weightedGp / gradedCr).toFixed(2)) : 0
        const pct = marksMax > 0 ? Number(((marksObt / marksMax) * 100).toFixed(2)) : 0
        return {
          semNumber,
          items,
          crReg,
          crEarn,
          sgpa,
          marksObt,
          marksMax,
          pct,
          status: hasFail ? 'FAIL' : 'PASS',
        }
      })
  }, [snapshot?.consolidated_results])

  const printHallTicket = async () => {
    const htCycle = snapshot?.upcoming_cycle ?? snapshot?.cycle
    if (!activeInstitutionId || !snapshot?.student || !snapshot.hall_ticket || !htCycle) return
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
    const courses = (snapshot.registered_courses ?? []).filter((c) => !c.is_online_exempt && !c.is_cie_only)

    openBrandedPrintWindow({
      title: `Hall_Ticket_${snapshot.student.registration_number}_${htCycle.code}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="border:1.5px solid #1e293b;padding:14px">
          ${renderBrandedHeaderHtml(
            branding,
            `PROVISIONAL ADMISSION / HALL TICKET — ${htCycle.code}`,
            `${htCycle.name} (${htCycle.cycle_type})`
          )}
          <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:10px">
            <table style="flex:1;margin:0">
              <tbody>
                <tr><th style="width:120px">USN</th><td style="font-family:monospace;font-weight:700">${escapeHtml(snapshot.student.registration_number)}</td></tr>
                <tr><th>Student Name</th><td><strong>${escapeHtml(snapshot.student.full_name)}</strong></td></tr>
                <tr><th>Program / Sem</th><td>${escapeHtml(snapshot.student.program_code)} — ${escapeHtml(snapshot.upcoming_cycle ? `Sem ${snapshot.student.current_sem}` : (snapshot.cycle?.semester_label || `Sem ${snapshot.student.current_sem}`))}</td></tr>
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

    const regularRows = results.filter((r) => !r.is_arrear)
    const arrearRows = results.filter((r) => Boolean(r.is_arrear))
    const gradeCardSemLabel = snapshot.cycle.semester_label || `${snapshot.cycle.cycle_type} Examination`

    const renderRow = (r: (typeof results)[number]) => {
      const nonCr = isNonCreditGrade(r.grade_code, Number(r.credits ?? 0))
      const seeDisp = nonCr ? '—' : r.see_marks ?? '—'
      const isFail = !['PASS', 'EXEMPT'].includes(r.result_status)
      return `<tr>
        <td style="font-family:monospace;font-weight:700">${escapeHtml(r.course_code)}${r.is_arrear ? '<sup>*</sup>' : ''}</td>
        <td>${escapeHtml(r.course_title)}${r.is_arrear ? ` <span style="font-size:9px;color:#92400e;font-weight:600">(Sem ${r.course_semester ?? ''} Arrear)</span>` : ''}${r.is_graced ? ` <span style="font-size:9px;color:#065f46">[G+${r.grace_marks_added ?? 0}]</span>` : ''}</td>
        <td style="text-align:center">${r.credits}</td>
        <td style="text-align:center">${r.cie_marks ?? '—'}</td>
        <td style="text-align:center">${seeDisp}</td>
        <td style="text-align:center;font-weight:700">${r.total_marks ?? '—'}</td>
        <td style="text-align:center;font-weight:700;${isFail ? 'color:#b91c1c' : ''}">${escapeHtml(r.grade_code ?? '—')}</td>
        <td style="text-align:center;font-weight:600;${isFail ? 'color:#b91c1c' : ''}">${escapeHtml(r.result_status)}</td>
      </tr>`
    }

    const tbodySections: string[] = []
    if (regularRows.length > 0 && arrearRows.length > 0) {
      tbodySections.push(
        `<tr style="background:#f1f5f9"><td colspan="8" style="font-weight:700;font-size:10px;text-transform:uppercase;color:#1e293b">Part A — Regular Examination Subjects (Semester ${regularRows[0].course_semester ?? ''})</td></tr>`
      )
      tbodySections.push(...regularRows.map(renderRow))
      tbodySections.push(
        `<tr style="background:#fffbeb"><td colspan="8" style="font-weight:700;font-size:10px;text-transform:uppercase;color:#92400e">Part B — Arrear / Repeat Subjects Appeared in Same Cycle (*)</td></tr>`
      )
      tbodySections.push(...arrearRows.map(renderRow))
    } else {
      tbodySections.push(...results.map(renderRow))
    }

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
            `Academic Year: ${snapshot.cycle.academic_year}`
          )}
          <table style="margin-bottom:10px">
            <tbody>
              <tr>
                <th style="width:110px">Candidate Name</th>
                <td><strong>${escapeHtml(snapshot.student.full_name)}</strong></td>
                <th style="width:95px">USN</th>
                <td style="font-family:monospace;font-weight:700">${escapeHtml(snapshot.student.registration_number)}</td>
              </tr>
              <tr>
                <th>Program / Branch</th>
                <td>${escapeHtml(snapshot.student.program_code ?? '')}${snapshot.student.program_name ? ` — ${escapeHtml(snapshot.student.program_name)}` : ''}</td>
                <th>Exam Semester</th>
                <td><strong>${escapeHtml(gradeCardSemLabel)}</strong></td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr><th style="width:98px">Course Code</th><th>Course Title</th><th style="width:38px;text-align:center">Cr</th><th style="width:42px;text-align:center">CIE</th><th style="width:42px;text-align:center">SEE</th><th style="width:46px;text-align:center">Total</th><th style="width:44px;text-align:center">Grade</th><th style="width:62px;text-align:center">Result</th></tr>
            </thead>
            <tbody>
              ${tbodySections.join('')}
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
            <sup>*</sup> Denotes Arrear / Supplementary / Summer / Repeat subject appeared in this Examination Cycle.
            '—' in SEE denotes CIE-only mandatory non-credit course (PP/NP).
          </p>
          <div class="signatures">
            <div class="sig-col"></div>
            ${renderSignatureBlockHtml('Controller of Examinations', coeSig)}
          </div>
        </div>
      </section>`,
    })
  }

  const printConsolidatedTranscript = async () => {
    if (!activeInstitutionId || !snapshot?.student || semesterGroups.length === 0) return
    const branding = await fetchInstitutionBranding(
      activeInstitutionId,
      activeMembership?.institution.name ?? 'Institution'
    )
    const sigMap = await signPrivateAssets([branding.coe_signature_path])
    const coeSig = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null

    const sectionsHtml = semesterGroups
      .map(
        (grp) => `
        <div style="margin-bottom:12px">
          <div style="background:#f1f5f9;border:1px solid #475569;border-bottom:none;padding:4px 8px;display:flex;justify-content:space-between;font-weight:700;font-size:10.5px">
            <span>SEMESTER ${grp.semNumber}</span>
            <span>Credits: ${grp.crEarn}/${grp.crReg} · Marks: ${grp.marksObt}/${grp.marksMax} (${grp.pct.toFixed(2)}%) · SGPA: ${grp.sgpa.toFixed(2)} · ${grp.status}</span>
          </div>
          <table style="margin-bottom:0">
            <thead>
              <tr><th style="width:96px">Course Code</th><th>Course Title</th><th style="width:36px;text-align:center">Cr</th><th style="width:40px;text-align:center">CIE</th><th style="width:40px;text-align:center">SEE</th><th style="width:44px;text-align:center">Tot</th><th style="width:42px;text-align:center">Grd</th><th style="width:82px;text-align:center">Cycle</th></tr>
            </thead>
            <tbody>
              ${grp.items
                .map((r) => {
                  const nonCr = isNonCreditGrade(r.grade_code, Number(r.credits ?? 0))
                  const isFail = !['PASS', 'EXEMPT'].includes(r.result_status)
                  return `<tr>
                    <td style="font-family:monospace;font-weight:700">${escapeHtml(r.course_code)}${r.is_reattempt ? '<sup>*</sup>' : ''}</td>
                    <td>${escapeHtml(r.course_title)}</td>
                    <td style="text-align:center">${r.credits}</td>
                    <td style="text-align:center">${r.cie_marks ?? '—'}</td>
                    <td style="text-align:center">${nonCr ? '—' : r.see_marks ?? '—'}</td>
                    <td style="text-align:center;font-weight:700">${r.total_marks ?? '—'}</td>
                    <td style="text-align:center;font-weight:700;${isFail ? 'color:#b91c1c' : ''}">${escapeHtml(r.grade_code ?? r.result_status)}</td>
                    <td style="text-align:center;font-family:monospace;font-size:9.5px">${escapeHtml(r.latest_cycle_code)}</td>
                  </tr>`
                })
                .join('')}
            </tbody>
          </table>
        </div>`
      )
      .join('')

    openBrandedPrintWindow({
      title: `Consolidated_Results_${snapshot.student.registration_number}`,
      landscape: false,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: `
        ${renderBrandedHeaderHtml(branding, 'CONSOLIDATED PROVISIONAL RESULT SUMMARY (LATEST ATTEMPTS)')}
        <table style="margin-bottom:10px">
          <tbody>
            <tr>
              <th style="width:110px">Candidate Name</th>
              <td><strong>${escapeHtml(snapshot.student.full_name)}</strong></td>
              <th style="width:90px">USN</th>
              <td style="font-family:monospace;font-weight:700">${escapeHtml(snapshot.student.registration_number)}</td>
            </tr>
            <tr>
              <th>Program / Branch</th>
              <td>${escapeHtml(snapshot.student.program_code ?? '')}${snapshot.student.program_name ? ` — ${escapeHtml(snapshot.student.program_name)}` : ''}</td>
              <th>Cumulative</th>
              <td><strong>CGPA: ${Number(snapshot.consolidated_summary?.cgpa ?? 0).toFixed(2)} · Cr: ${snapshot.consolidated_summary?.credits_earned ?? 0}/${snapshot.consolidated_summary?.credits_attempted ?? 0} · Backlogs: ${snapshot.consolidated_summary?.active_backlogs ?? 0}</strong></td>
            </tr>
          </tbody>
        </table>
        ${sectionsHtml}
        <p style="font-size:9.5px;color:#475569">
          <sup>*</sup> Indicates latest attempt cleared/taken in an Arrear / Supplementary / Summer / ODE examination.
        </p>
        <div class="signatures">
          <div class="sig-col"></div>
          ${renderSignatureBlockHtml('Controller of Examinations', coeSig)}
        </div>
      `,
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
  const currentSubjects = snapshot?.current_subjects ?? []
  const upcomingCycle = snapshot?.upcoming_cycle ?? null
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
          Live Results (By Sem)
        </button>
        <button
          type="button"
          onClick={() => setResultMode('CYCLE')}
          className={cn(
            'rounded-lg py-1.5 font-bold transition',
            resultMode === 'CYCLE' ? 'bg-amber-500 text-white shadow-xs' : 'text-amber-900'
          )}
        >
          Cycle Statements ({publishedCycles.length})
        </button>
      </div>

      {resultMode === 'CONSOLIDATED' ? (
        semesterGroups.length === 0 ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center text-xs text-slate-500">
            No published results available for this student yet.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Cumulative KPI Strip + Consolidated Print Button */}
            {consolidatedSummary && (
              <div className="rounded-2xl bg-white border border-amber-200 p-3 space-y-2.5 shadow-xs">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-amber-50/70 p-2">
                    <p className="text-[10px] font-bold uppercase text-amber-700">CGPA</p>
                    <p className="text-lg font-extrabold text-slate-900">
                      {Number(consolidatedSummary.cgpa).toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-emerald-50/70 p-2">
                    <p className="text-[10px] font-bold uppercase text-emerald-700">Credits</p>
                    <p className="text-lg font-extrabold text-emerald-900">
                      {consolidatedSummary.credits_earned}/{consolidatedSummary.credits_attempted}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-xl p-2',
                      consolidatedSummary.active_backlogs > 0 ? 'bg-red-50' : 'bg-emerald-50/70'
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
                <button
                  type="button"
                  onClick={printConsolidatedTranscript}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-950 hover:bg-amber-100"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Semester-Wise Consolidated Summary (A4)
                </button>
              </div>
            )}

            {/* Rich Semester-by-Semester Result Cards */}
            {semesterGroups.map((grp) => (
              <div key={grp.semNumber} className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs">
                <div className="px-3.5 py-2.5 bg-[#1a1c4b] text-white flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold tracking-wide">SEMESTER {grp.semNumber}</p>
                    <p className="text-[10px] text-indigo-200">
                      Credits: {grp.crEarn}/{grp.crReg} · Marks: {grp.marksObt}/{grp.marksMax} ({grp.pct.toFixed(1)}%)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="text-[9px] uppercase text-amber-300 font-semibold leading-none">SGPA</p>
                      <p className="text-sm font-extrabold text-white">{grp.sgpa.toFixed(2)}</p>
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-extrabold',
                        grp.status === 'PASS' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                      )}
                    >
                      {grp.status}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500">
                      <tr>
                        <th className="px-2.5 py-1.5">Course</th>
                        <th className="px-1 py-1.5 text-center">Cr</th>
                        <th className="px-1.5 py-1.5 text-center">CIE</th>
                        <th className="px-1.5 py-1.5 text-center">SEE</th>
                        <th className="px-1.5 py-1.5 text-center">Tot</th>
                        <th className="px-2 py-1.5 text-center">Grd</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {grp.items.map((r) => {
                        const passed = r.result_status === 'PASS' || r.result_status === 'EXEMPT'
                        const nonCr = isNonCreditGrade(r.grade_code, Number(r.credits ?? 0))
                        return (
                          <tr key={r.course_id}>
                            <td className="px-2.5 py-2">
                              <div className="flex items-center gap-1">
                                <span className="font-mono font-bold text-slate-900">
                                  {r.course_code}
                                  {r.is_reattempt && (
                                    <sup
                                      className="ml-0.5 text-amber-600 font-extrabold"
                                      title={`Cleared/Attempted in ${r.latest_cycle_code}`}
                                    >
                                      *
                                    </sup>
                                  )}
                                </span>
                                {r.is_reattempt && (
                                  <span className="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-semibold text-amber-900">
                                    {r.latest_cycle_code}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500 line-clamp-1">{r.course_title}</p>
                            </td>
                            <td className="px-1 py-2 text-center text-slate-500">{r.credits}</td>
                            <td className="px-1.5 py-2 text-center text-slate-600">{r.cie_marks ?? '—'}</td>
                            <td className="px-1.5 py-2 text-center text-slate-600">
                              {nonCr ? '—' : r.see_marks ?? '—'}
                            </td>
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
              </div>
            ))}

            <div className="rounded-xl px-3 py-2 bg-amber-50/70 border border-amber-200 text-[10px] text-amber-900">
              <strong>*</strong> Denotes latest attempt cleared/taken in an Arrear / Supplementary / Summer / ODE
              examination. Switch to <strong>Cycle Statements</strong> above for exam-cycle printable grade cards.
            </div>
          </div>
        )
      ) : (
        /* Cycle-Wise Official Download & Combined Regular + Arrear Statement */
        <div className="space-y-3">
          {publishedCycles.length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 p-3 space-y-2 shadow-xs">
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
              {snapshot?.cycle?.semester_label && (
                <p className="text-[11px] font-semibold text-indigo-800">
                  Statement Scope: {snapshot.cycle.semester_label}
                </p>
              )}
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
            <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-xs">
              {snapshot?.semester_result && (
                <div className="px-3.5 py-2.5 bg-[#1a1c4b] text-white flex items-center justify-between text-xs">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-amber-300">
                      {snapshot.cycle?.semester_label || snapshot.cycle?.code}
                    </p>
                    <p className="text-lg font-extrabold">
                      SGPA {Number(snapshot.semester_result.sgpa).toFixed(2)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-extrabold',
                        snapshot.semester_result.overall_status === 'PASS'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-red-500 text-white'
                      )}
                    >
                      {snapshot.semester_result.overall_status}
                    </span>
                    <p className="text-[11px] text-indigo-200 mt-0.5">
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
                    {courseResults.map((r) => {
                      const nonCr = isNonCreditGrade(r.grade_code, Number(r.credits ?? 0))
                      const passed = r.result_status === 'PASS' || r.result_status === 'EXEMPT'
                      return (
                        <tr key={`${r.course_code}-${r.attempt_number ?? 1}`}>
                          <td className="px-2.5 py-2">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="font-mono font-bold text-slate-900">
                                {r.course_code}
                                {r.is_arrear && <sup className="ml-0.5 text-amber-600 font-extrabold">*</sup>}
                              </span>
                              {r.course_semester && (
                                <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-600">
                                  S{r.course_semester}
                                </span>
                              )}
                              {r.is_arrear && (
                                <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900">
                                  ARREAR
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 line-clamp-1">{r.course_title}</p>
                          </td>
                          <td className="px-1.5 py-2 text-center text-slate-600">{r.cie_marks ?? '—'}</td>
                          <td className="px-1.5 py-2 text-center text-slate-600">
                            {nonCr ? '—' : r.see_marks ?? '—'}
                          </td>
                          <td className="px-1.5 py-2 text-center font-bold">{r.total_marks ?? '—'}</td>
                          <td className="px-2 py-2 text-center">
                            <span
                              className={cn(
                                'rounded-md px-1.5 py-0.5 text-[11px] font-extrabold',
                                passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                              )}
                            >
                              {r.grade_code ?? '—'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const renderCourseRegContent = () => {
    const win = courseRegCtx?.active_window ?? null
    const regStu = courseRegCtx?.student
    const submitted = Boolean(courseRegCtx?.has_submitted)
    const mandatory = courseRegCtx?.mandatory_courses ?? []
    const lateral = courseRegCtx?.lateral_courses ?? []
    const peList = courseRegCtx?.pe_courses ?? []
    const oeList = courseRegCtx?.oe_courses ?? []
    const submittedList = courseRegCtx?.submitted_courses ?? []

    const handleDownloadCopy = () => {
      if (!activeInstitutionId || !regStu || submittedList.length === 0) return
      printOfficialCourseRegistrationForms({
        institutionId: activeInstitutionId,
        institutionName: activeMembership?.institution.name,
        academicYear: courseRegCtx?.target_academic_year || '2026-27',
        term: courseRegCtx?.target_term || 'ODD',
        items: [{ student: regStu, courses: submittedList }],
      })
    }

    return (
      <div className="space-y-3">
        {regNotice && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 font-semibold flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{regNotice}</span>
          </div>
        )}
        {regError && (
          <div className="rounded-2xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 font-semibold flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <span>{regError}</span>
          </div>
        )}

        {submitted ? (
          <div className="rounded-2xl bg-white border border-emerald-200 p-4 space-y-3 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-extrabold text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Semester {stu?.current_sem} Course Registration Completed
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  AY {courseRegCtx?.target_academic_year} ({courseRegCtx?.target_term}) · {submittedList.length} Courses
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadCopy}
                className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600 shrink-0"
              >
                <Printer className="h-3.5 w-3.5" /> Download Copy
              </button>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs">
              {submittedList.map((c) => (
                <div key={c.course_id} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-slate-900">{c.course_code}</span>
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-semibold text-slate-600">
                      {c.course_type}
                    </span>
                    <p className="text-[10px] text-slate-500 truncate">{c.course_title}</p>
                  </div>
                  <span className="font-mono font-semibold text-slate-700 shrink-0">{c.credits} Cr</span>
                </div>
              ))}
            </div>
          </div>
        ) : !win ? (
          <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-1.5">
            <ClipboardCheck className="h-7 w-7 text-slate-300 mx-auto" />
            <p className="text-xs font-bold text-slate-800">No Open Course Registration Window</p>
            <p className="text-[11px] text-slate-500">
              When COE triggers Course Registration for Semester {stu?.current_sem}, your mandatory courses and elective
              dropdowns will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-amber-300 p-4 space-y-3.5 shadow-xs">
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-900">
              <p className="font-extrabold">{win.title}</p>
              {win.closes_at && (
                <p className="text-[11px] font-semibold mt-0.5">Deadline: {win.closes_at.slice(0, 10)}</p>
              )}
              {win.instructions && <p className="text-[11px] mt-1 text-red-800">{win.instructions}</p>}
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-extrabold uppercase text-slate-700">
                1. Mandatory Courses (Auto-Selected · {mandatory.length + lateral.length})
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs">
                {[...mandatory, ...lateral].map((c) => (
                  <div key={c.course_id} className="px-3 py-2 flex items-center justify-between gap-2 bg-emerald-50/30">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-slate-900">{c.course_code}</span>
                      <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-800">
                        {c.course_type}
                      </span>
                      <p className="text-[10px] text-slate-600 truncate">{c.course_title}</p>
                    </div>
                    <span className="font-mono text-[11px] text-slate-600 shrink-0">{c.credits} Cr</span>
                  </div>
                ))}
              </div>
            </div>

            {peList.length > 0 && (
              <div className="space-y-1 text-xs">
                <label className="block font-extrabold text-slate-800">
                  2. Select Professional Elective (PE) *
                </label>
                <select
                  value={selectedPeId}
                  onChange={(e) => setSelectedPeId(e.target.value)}
                  className="w-full rounded-xl border border-amber-300 bg-amber-50/30 px-3 py-2 text-xs font-semibold text-slate-900"
                >
                  <option value="">-- Choose Approved Professional Elective --</option>
                  {peList.map((p) => (
                    <option key={p.course_id} value={p.course_id}>
                      {p.course_code} — {p.course_title} ({p.credits} Cr)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {oeList.length > 0 && (
              <div className="space-y-1 text-xs">
                <label className="block font-extrabold text-slate-800">
                  {peList.length > 0 ? '3' : '2'}. Select Open Elective (OE) *
                </label>
                <select
                  value={selectedOeId}
                  onChange={(e) => setSelectedOeId(e.target.value)}
                  className="w-full rounded-xl border border-amber-300 bg-amber-50/30 px-3 py-2 text-xs font-semibold text-slate-900"
                >
                  <option value="">-- Choose Approved Open Elective --</option>
                  {oeList.map((o) => (
                    <option key={o.course_id} value={o.course_id}>
                      {o.course_code} [{o.branch_code}] — {o.course_title} ({o.credits} Cr)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              disabled={
                submitStudentRegMutation.isPending ||
                (peList.length > 0 && !selectedPeId) ||
                (oeList.length > 0 && !selectedOeId)
              }
              onClick={() => submitStudentRegMutation.mutate()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" />
              {submitStudentRegMutation.isPending
                ? 'Submitting Registration...'
                : 'Confirm & Submit Course Registration'}
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderExamsContent = () => (
    <div className="space-y-2.5">
      {!upcomingCycle || courses.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center space-y-1.5">
          <Calendar className="h-7 w-7 text-slate-300 mx-auto" />
          <p className="text-xs font-bold text-slate-800">
            No Upcoming Exams Scheduled for Semester {stu?.current_sem ?? ''}
          </p>
          <p className="text-[11px] text-slate-500">
            Your upcoming timetable and hall seat will appear here once COE opens your Semester {stu?.current_sem ?? ''} exam
            registration and publishes seating. View past exam records under <strong>Results</strong>.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-[#1a1c4b] text-white px-3.5 py-2 text-xs flex items-center justify-between">
            <span className="font-bold truncate">{upcomingCycle.name}</span>
            <span className="font-mono text-[10px] text-amber-300 shrink-0 ml-2">{upcomingCycle.code}</span>
          </div>
          {courses.map((c) => {
            const noHallSeat = Boolean(c.is_online_exempt || c.is_cie_only)
            return (
              <div key={c.course_id} className="rounded-2xl bg-white border border-slate-200 p-3.5 space-y-1.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs font-bold text-indigo-800">{c.course_code}</span>
                    <p className="text-xs font-semibold text-slate-900">{c.course_title}</p>
                  </div>
                  {c.is_omr_exam && (
                    <span className="rounded-full bg-purple-100 text-purple-800 px-2 py-0.5 text-[9px] font-bold">OMR</span>
                  )}
                  {c.is_online_exempt && (
                    <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-[9px] font-bold">ONLINE</span>
                  )}
                  {!c.is_online_exempt && c.is_cie_only && (
                    <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[9px] font-bold">CIE-ONLY</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[11px]">
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <Calendar className="h-3.5 w-3.5 text-amber-500" />
                    {noHallSeat
                      ? 'No Written SEE Exam'
                      : c.exam_date
                        ? `${c.exam_date} · ${fmtPortalSession(c.session_code, c.start_time, c.end_time)}`
                        : 'Date TBA'}
                  </span>
                  <span className={cn('inline-flex items-center gap-1 font-bold', noHallSeat ? 'text-slate-500' : 'text-emerald-700')}>
                    <MapPin className="h-3.5 w-3.5" />
                    {noHallSeat
                      ? 'Exempt from Seating'
                      : c.room_number
                        ? `Rm ${c.room_number} · Seat ${c.seat_label ?? ''}`
                        : 'Seat Pending'}
                  </span>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )

  const renderHallTicketContent = () => (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
      {!snapshot?.hall_ticket ? (
        <p className="text-xs text-slate-500 text-center py-6">
          No active exam Hall Ticket issued for Semester {stu?.current_sem ?? ''} yet.
        </p>
      ) : snapshot.hall_ticket.status === 'ISSUED' ? (
        <>
          <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold">
            <CheckCircle2 className="h-4 w-4" />
            Hall Ticket Issued &amp; Ready ({upcomingCycle?.code ?? snapshot.cycle?.code})
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
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">
          Semester {stu?.current_sem ?? ''} Registered Subjects ({currentSubjects.length})
        </h3>
        {currentSubjects[0] && (
          <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
            AY {currentSubjects[0].academic_year} · {currentSubjects[0].term}
          </span>
        )}
      </div>
      {currentSubjects.length === 0 ? (
        <div className="text-center py-5 space-y-1">
          <p className="text-xs font-semibold text-slate-700">
            Semester {stu?.current_sem ?? ''} Course Registration Pending
          </p>
          <p className="text-[11px] text-slate-500">
            Register your Semester {stu?.current_sem ?? ''} courses at <strong>Front Office → Course Registration (Phase 1)</strong>.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 text-xs">
          {currentSubjects.map((c) => (
            <li key={c.course_id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-indigo-900">{c.course_code}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-semibold text-slate-600">
                    {c.course_type}
                  </span>
                </div>
                <p className="text-slate-600 truncate">{c.course_title}</p>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
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
            {stu.program_name || stu.program_code} · Current Sem {stu.current_sem}
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
            Mobile-first campus view for Semester-Wise Results (*), Official Cycle Statements, Hall Tickets &amp; Seat Locator.
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
              placeholder="Staff Preview: enter Student USN (e.g. 1AM25EC008)..."
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
          {error instanceof Error ? error.message : typeof (error as { message?: unknown })?.message === 'string' ? String((error as { message: string }).message) : 'Unable to load student portal'}
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
        /* MOBILE-FIRST APP FRAME */
        <div className="mx-auto w-full max-w-[420px] min-h-[760px] rounded-[36px] border-[6px] border-slate-800 bg-[#FDFBF7] shadow-2xl relative overflow-hidden flex flex-col">
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

          <div className="flex-1 overflow-y-auto px-5 pb-24 space-y-4">
            {courseRegCtx?.is_high_priority_pending && section !== 'course-reg' && (
              <button
                type="button"
                onClick={() => setSection('course-reg')}
                className="w-full text-left rounded-2xl bg-red-600 text-white p-3.5 shadow-md flex items-start gap-2.5 animate-pulse hover:bg-red-700 transition"
              >
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-200 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-200">
                    High Priority · Action Required
                  </p>
                  <p className="text-xs font-bold leading-snug">
                    Semester {stu.current_sem} Course Registration is OPEN
                    {courseRegCtx.active_window?.closes_at
                      ? ` (Closes ${courseRegCtx.active_window.closes_at.slice(0, 10)})`
                      : ''}
                    . Tap to submit now →
                  </p>
                </div>
              </button>
            )}

            {section === 'home' && (
              <>
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
                      <p className="text-[10px] font-semibold text-amber-600">Current Sem</p>
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
                        label: courseRegCtx?.is_high_priority_pending ? 'Course Reg !' : 'Course Reg',
                        icon: ClipboardCheck,
                        color: courseRegCtx?.is_high_priority_pending ? 'text-red-600' : 'text-emerald-600',
                        onClick: () => setSection('course-reg'),
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

                {/* Semester Performance Snapshot */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-slate-900">Semester Performance</h3>
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
                  {semesterGroups.length === 0 ? (
                    <div className="rounded-2xl bg-white p-4 text-center text-xs text-slate-400 border border-slate-100">
                      No published results yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {semesterGroups.map((g) => (
                        <button
                          key={g.semNumber}
                          type="button"
                          onClick={() => {
                            setResultMode('CONSOLIDATED')
                            setSection('results')
                          }}
                          className="text-left rounded-2xl bg-white p-3 border border-slate-100 shadow-xs hover:border-amber-300 transition"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-extrabold text-[#1a1c4b]">SEM {g.semNumber}</span>
                            <span
                              className={cn(
                                'rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                                g.status === 'PASS' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                              )}
                            >
                              {g.status}
                            </span>
                          </div>
                          <p className="text-lg font-extrabold text-amber-600 mt-1">SGPA {g.sgpa.toFixed(2)}</p>
                          <p className="text-[10px] text-slate-500">
                            {g.crEarn}/{g.crReg} Cr · {g.pct.toFixed(1)}%
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {section === 'course-reg' && renderCourseRegContent()}
            {section === 'results' && renderResultsContent()}
            {section === 'exams' && renderExamsContent()}
            {section === 'hall-ticket' && renderHallTicketContent()}
            {section === 'subjects' && renderSubjectsContent()}
            {section === 'profile' && renderProfileContent()}
          </div>

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
        /* DESKTOP VIEW */
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
                {stu.program_code ?? 'GEN'} · Current Sem {stu.current_sem}
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

          {courseRegCtx?.is_high_priority_pending && section !== 'course-reg' && (
            <button
              type="button"
              onClick={() => setSection('course-reg')}
              className="w-full text-left rounded-xl bg-red-600 text-white px-4 py-3 shadow-sm flex items-center justify-between gap-3 hover:bg-red-700"
            >
              <div className="flex items-center gap-2.5 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-200 shrink-0" />
                <span>
                  <strong>HIGH PRIORITY:</strong> Semester {stu.current_sem} Course Registration is open. Submit now to avoid Exam Application &amp; Hall Ticket delays.
                </span>
              </div>
              <span className="rounded-lg bg-white px-3 py-1 text-xs font-extrabold text-red-700 shrink-0">
                Complete Now →
              </span>
            </button>
          )}

          <div className="grid grid-cols-6 gap-1.5 bg-white p-1.5 rounded-xl border border-slate-200 text-xs">
            {(
              [
                { id: 'course-reg', label: courseRegCtx?.is_high_priority_pending ? 'Course Reg (!)' : 'Course Reg', icon: ClipboardCheck },
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

          {section === 'course-reg' && renderCourseRegContent()}
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
