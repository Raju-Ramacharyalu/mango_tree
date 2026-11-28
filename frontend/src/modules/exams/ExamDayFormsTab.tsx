import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer, Download, FileSpreadsheet, ClipboardCheck, LayoutGrid, FileText, Lock, Unlock } from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  AttendanceStatus,
  ExamCycle,
  ExamRoomAllotmentRun,
  ExamSeatAllotmentItem,
  ExamSessionCode,
} from '@/types/exams'
import { cleanRoomNumber } from './allocationEngine'
import { fetchInstitutionBranding, openBrandedPrintWindow, renderBrandedHeaderHtml, renderSignatureBlockHtml, renderWatermarkHtml, signPrivateAssets } from './printBranding'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  canManage: boolean
}

type DocSubTab = 'FORM_B' | 'FORM_A' | 'QPDS' | 'POSTERS'

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

const ATTENDANCE_STYLES: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ABSENT: 'bg-red-50 text-red-700 border-red-200',
  MALPRACTICE: 'bg-amber-50 text-amber-800 border-amber-300',
  EXEMPT: 'bg-slate-100 text-slate-600 border-slate-200',
}

export function ExamDayFormsTab({ institutionId, institutionName, cycle, canManage }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [subTab, setSubTab] = useState<DocSubTab>('FORM_B')
  const [selectedRunId, setSelectedRunId] = useState('')
  const [roomFilter, setRoomFilter] = useState('ALL')
  const [qpExtraPerRoom, setQpExtraPerRoom] = useState('1')

  const { data: runs = [] } = useQuery<ExamRoomAllotmentRun[]>({
    queryKey: ['exam_allotment_runs', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_room_allotment_runs')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('exam_date', { ascending: true })
        .order('session_code', { ascending: true })
      if (error) throw error
      return (data ?? []) as ExamRoomAllotmentRun[]
    },
  })

  const activeRun = useMemo(() => {
    if (selectedRunId) return runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null
    return runs[0] ?? null
  }, [runs, selectedRunId])

  const { data: seats = [], isLoading } = useQuery<ExamSeatAllotmentItem[]>({
    queryKey: ['exam_seat_allotments', institutionId, cycle?.id, activeRun?.id],
    enabled: Boolean(activeRun?.id),
    queryFn: async () => {
      const data = await fetchAllRows<Record<string, unknown>>((from, to) =>
        supabase
          .from('exam_seat_allotments')
          .select(`
            id, institution_id, exam_cycle_id, allotment_run_id, room_id, exam_date, session_code,
            seat_number, seat_label, student_id, registration_id, registration_course_id,
            course_id, program_id, effective_course_code, is_omr_exam,
            attendance_status, booklet_number, remarks,
            exam_rooms (room_number, room_name, block_name, floor_label, remarks),
            students (registration_number, full_name),
            course_catalog (course_code, title),
            programs (code, name)
          `)
          .eq('institution_id', institutionId)
          .eq('allotment_run_id', activeRun!.id)
          .order('seat_number', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      )

      return (data ?? [])
        .map((row) => {
          const rm = unwrap(
            row.exam_rooms as
              | { room_number: string; room_name: string | null; block_name: string | null; floor_label: string | null; remarks: string | null }
              | Array<{ room_number: string; room_name: string | null; block_name: string | null; floor_label: string | null; remarks: string | null }>
              | null
          )
          const stu = unwrap(
            row.students as
              | { registration_number: string; full_name: string }
              | Array<{ registration_number: string; full_name: string }>
              | null
          )
          const cc = unwrap(
            row.course_catalog as
              | { course_code: string; title: string }
              | Array<{ course_code: string; title: string }>
              | null
          )
          const prog = unwrap(
            row.programs as { code: string; name: string } | Array<{ code: string; name: string }> | null
          )
          return {
            id: row.id as string,
            institution_id: row.institution_id as string,
            exam_cycle_id: row.exam_cycle_id as string,
            allotment_run_id: row.allotment_run_id as string,
            room_id: row.room_id as string,
            room_number: cleanRoomNumber(rm?.room_number ?? '—'),
            room_name: rm?.room_name ?? null,
            block_name: rm?.block_name ?? null,
            floor_label: rm?.floor_label ?? null,
            room_remarks: rm?.remarks ?? null,
            exam_date: row.exam_date as string,
            session_code: row.session_code as ExamSessionCode,
            seat_number: Number(row.seat_number),
            seat_label: row.seat_label as string,
            student_id: row.student_id as string,
            student_reg_no: stu?.registration_number ?? '—',
            student_name: stu?.full_name ?? '—',
            registration_id: row.registration_id as string,
            registration_course_id: row.registration_course_id as string,
            course_id: row.course_id as string,
            course_code: cc?.course_code ?? '—',
            course_title: cc?.title ?? '—',
            effective_course_code: row.effective_course_code as string,
            program_id: row.program_id as string,
            program_code: prog?.code ?? '—',
            program_name: prog?.name ?? '—',
            is_omr_exam: Boolean(row.is_omr_exam),
            attendance_status: row.attendance_status as AttendanceStatus,
            booklet_number: (row.booklet_number as string | null) ?? null,
            remarks: (row.remarks as string | null) ?? null,
          }
        })
        .sort((a, b) => {
          const rCmp = a.room_number.localeCompare(b.room_number, undefined, { numeric: true })
          if (rCmp !== 0) return rCmp
          return a.seat_number - b.seat_number
        })
    },
  })

  const updateSeatMutation = useMutation({
    mutationFn: async (patch: { id: string; attendance_status?: AttendanceStatus; booklet_number?: string | null }) => {
      const updateObj: Record<string, unknown> = {
        marked_by: session?.user.id ?? null,
        marked_at: new Date().toISOString(),
        updated_by: session?.user.id ?? null,
      }
      if (patch.attendance_status !== undefined) updateObj.attendance_status = patch.attendance_status
      if (patch.booklet_number !== undefined) updateObj.booklet_number = patch.booklet_number

      const { error } = await supabase.from('exam_seat_allotments').update(updateObj).eq('id', patch.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_seat_allotments', institutionId, cycle?.id, activeRun?.id] })
    },
  })

  const isRunLocked = activeRun?.status === 'LOCKED'

  const toggleFormALockMutation = useMutation({
    mutationFn: async (nextLocked: boolean) => {
      if (!activeRun) return
      const { error } = await supabase
        .from('exam_room_allotment_runs')
        .update({
          status: nextLocked ? 'LOCKED' : 'PUBLISHED',
          updated_by: session?.user.id ?? null,
        })
        .eq('id', activeRun.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_allotment_runs', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_bundle_sources', institutionId, cycle?.id] })
    },
  })

  // Distinct sorted rooms
  const roomNumbers = useMemo(() => {
    return Array.from(new Set(seats.map((s) => s.room_number))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    )
  }, [seats])

  // Distinct sorted effective courses
  const effectiveCourses = useMemo(() => {
    const map = new Map<string, { code: string; title: string; isOmr: boolean }>()
    for (const s of seats) {
      if (!map.has(s.effective_course_code)) {
        map.set(s.effective_course_code, {
          code: s.effective_course_code,
          title: s.course_title,
          isOmr: s.is_omr_exam,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code))
  }, [seats])

  // Filtered seats for Form B
  const formBSeats = useMemo(() => {
    return seats.filter((s) => roomFilter === 'ALL' || s.room_number === roomFilter)
  }, [seats, roomFilter])

  // Form A: Course-Branch Consolidated Rollup (live-synced from Form B absentees)
  const formARows = useMemo(() => {
    const map = new Map<
      string,
      {
        effective_course_code: string
        course_title: string
        program_code: string
        is_omr_exam: boolean
        total: number
        present: number
        absentUsns: string[]
        malpracticeUsns: string[]
        rooms: Set<string>
      }
    >()
    for (const s of seats) {
      const key = `${s.effective_course_code}::${s.program_code}`
      const row = map.get(key) ?? {
        effective_course_code: s.effective_course_code,
        course_title: s.course_title,
        program_code: s.program_code,
        is_omr_exam: s.is_omr_exam,
        total: 0,
        present: 0,
        absentUsns: [],
        malpracticeUsns: [],
        rooms: new Set<string>(),
      }
      row.total += 1
      row.rooms.add(s.room_number)
      if (s.attendance_status === 'ABSENT') {
        row.absentUsns.push(s.student_reg_no)
      } else if (s.attendance_status === 'MALPRACTICE') {
        row.malpracticeUsns.push(s.student_reg_no)
        row.present += 1
      } else if (s.attendance_status === 'PRESENT') {
        row.present += 1
      }
      map.set(key, row)
    }
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        absentUsns: r.absentUsns.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        malpracticeUsns: r.malpracticeUsns.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        roomList: Array.from(r.rooms).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      }))
      .sort(
        (a, b) =>
          a.effective_course_code.localeCompare(b.effective_course_code) ||
          a.program_code.localeCompare(b.program_code)
      )
  }, [seats])

  // QPDS Matrix: Room × Effective Course
  const qpdsData = useMemo(() => {
    const extra = Math.max(0, Number(qpExtraPerRoom) || 0)
    const rows = roomNumbers.map((rm) => {
      const roomSeats = seats.filter((s) => s.room_number === rm)
      const meta = roomSeats[0]
      const counts: Record<string, number> = {}
      let roomTotal = 0
      let roomIndentTotal = 0
      for (const c of effectiveCourses) {
        const cnt = roomSeats.filter((s) => s.effective_course_code === c.code).length
        counts[c.code] = cnt
        roomTotal += cnt
        if (cnt > 0) roomIndentTotal += cnt + extra
      }
      return {
        room_number: rm,
        block_floor: [meta?.block_name, meta?.floor_label].filter(Boolean).join(' · '),
        remarks: meta?.room_remarks ?? '',
        counts,
        roomTotal,
        roomIndentTotal,
      }
    })

    const colTotals: Record<string, { appearing: number; indent: number }> = {}
    for (const c of effectiveCourses) {
      let appearing = 0
      let indent = 0
      for (const r of rows) {
        const cnt = r.counts[c.code] ?? 0
        appearing += cnt
        if (cnt > 0) indent += cnt + extra
      }
      colTotals[c.code] = { appearing, indent }
    }

    return { extra, rows, colTotals }
  }, [roomNumbers, seats, effectiveCourses, qpExtraPerRoom])

  // Room Posters Data
  const posterRooms = useMemo(() => {
    return roomNumbers
      .filter((rm) => roomFilter === 'ALL' || rm === roomFilter)
      .map((rm) => {
        const roomSeats = seats.filter((s) => s.room_number === rm)
        const meta = roomSeats[0]
        const blockMap = new Map<
          string,
          { course: string; title: string; program: string; isOmr: boolean; usns: string[] }
        >()
        for (const s of roomSeats) {
          const key = `${s.effective_course_code}::${s.program_code}`
          const entry = blockMap.get(key) ?? {
            course: s.effective_course_code,
            title: s.course_title,
            program: s.program_code,
            isOmr: s.is_omr_exam,
            usns: [],
          }
          entry.usns.push(s.student_reg_no)
          blockMap.set(key, entry)
        }
        const blocks = Array.from(blockMap.values()).map((b) => {
          const sorted = [...b.usns].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
          return {
            ...b,
            count: sorted.length,
            firstUsn: sorted[0] ?? '—',
            lastUsn: sorted[sorted.length - 1] ?? '—',
          }
        })
        return {
          room_number: rm,
          block_floor: [meta?.block_name, meta?.floor_label].filter(Boolean).join(' · '),
          remarks: meta?.room_remarks ?? '',
          total: roomSeats.length,
          blocks,
          seats: roomSeats,
        }
      })
  }, [roomNumbers, seats, roomFilter])

  const printFormB = async () => {
    if (!cycle || !activeRun) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigs = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? sigs.get(branding.coe_signature_path) : null

    const sheetMap = new Map<string, ExamSeatAllotmentItem[]>()
    for (const s of formBSeats) {
      const key = `${s.room_number}::${s.effective_course_code}`
      const arr = sheetMap.get(key) ?? []
      arr.push(s)
      sheetMap.set(key, arr)
    }

    const pages = Array.from(sheetMap.entries())
      .map(([, list]) => {
        const first = list[0]
        const present = list.filter((s) => s.attendance_status === 'PRESENT' || s.attendance_status === 'MALPRACTICE').length
        const absent = list.filter((s) => s.attendance_status === 'ABSENT').length
        return `<section class="page">
          ${renderWatermarkHtml(branding, 'per-page')}
          <div class="doc-body">
            ${renderBrandedHeaderHtml(branding, `FORM B — ROOM ATTENDANCE & BOOKLET STATEMENT (${cycle.code})`)}
            <div class="meta">
              <span><strong>Date / Session:</strong> ${escapeHtml(activeRun.exam_date)} (${escapeHtml(activeRun.session_code)})</span>
              <span><strong>Room:</strong> ${escapeHtml(first.room_number)} ${first.block_name ? `(${escapeHtml(first.block_name)})` : ''}</span>
              <span><strong>Course:</strong> ${escapeHtml(first.effective_course_code)} — ${escapeHtml(first.course_title)}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width:36px">Seat</th>
                  <th style="width:110px">USN</th>
                  <th>Candidate Name</th>
                  <th style="width:62px">Branch</th>
                  <th style="width:110px">Booklet Sl. No.</th>
                  <th style="width:76px">Status</th>
                  <th style="width:115px">Candidate Signature</th>
                </tr>
              </thead>
              <tbody>
                ${list
                  .map(
                    (s) => `<tr>
                      <td style="text-align:center">${s.seat_number}</td>
                      <td><strong>${escapeHtml(s.student_reg_no)}</strong></td>
                      <td>${escapeHtml(s.student_name)}</td>
                      <td style="text-align:center">${escapeHtml(s.program_code)}</td>
                      <td>${escapeHtml(s.booklet_number ?? '')}</td>
                      <td style="text-align:center">${s.attendance_status === 'ABSENT' ? '<strong>ABSENT</strong>' : s.attendance_status === 'MALPRACTICE' ? '<strong>MP</strong>' : ''}</td>
                      <td></td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
            <div class="meta">
              <span><strong>Allotted:</strong> ${list.length}</span>
              <span><strong>Present:</strong> ${present}</span>
              <span><strong>Absent:</strong> ${absent}</span>
              <span><strong>Scripts Handed Over:</strong> ________</span>
            </div>
            <div class="signatures">
              ${renderSignatureBlockHtml('Room Invigilator Signature & Name', null)}
              ${renderSignatureBlockHtml('Deputy Chief Superintendent (DCS)', null)}
              ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSigUrl)}
            </div>
          </div>
        </section>`
      })
      .join('')

    openBrandedPrintWindow({
      title: `${cycle.code}_${activeRun.exam_date}_FormB`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: pages,
    })
  }

  const printFormA = async () => {
    if (!cycle || !activeRun) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigs = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? sigs.get(branding.coe_signature_path) : null

    const totals = formARows.reduce(
      (acc, r) => ({
        total: acc.total + r.total,
        present: acc.present + r.present,
        absent: acc.absent + r.absentUsns.length,
        mp: acc.mp + r.malpracticeUsns.length,
      }),
      { total: 0, present: 0, absent: 0, mp: 0 }
    )
    const html = `
      ${renderBrandedHeaderHtml(
        branding,
        'FORM A — CONSOLIDATED COURSE & BRANCH ATTENDANCE / ABSENTEE STATEMENT',
        `${cycle.name} (${cycle.code}) · Date: ${activeRun.exam_date} (${activeRun.session_code})`
      )}
      <table>
        <thead>
          <tr>
            <th style="width:32px">Sl.</th>
            <th style="width:92px">Course Code</th>
            <th>Course Title</th>
            <th style="width:55px">Branch</th>
            <th style="width:80px">Rooms</th>
            <th style="width:46px">Reg.</th>
            <th style="width:46px">Pres.</th>
            <th style="width:46px">Abs.</th>
            <th>Absentee / Malpractice USNs (Synced from Form B)</th>
          </tr>
        </thead>
        <tbody>
          ${formARows
            .map(
              (r, i) => `<tr>
                <td style="text-align:center">${i + 1}</td>
                <td><strong>${escapeHtml(r.effective_course_code)}</strong>${r.is_omr_exam ? ' (OMR)' : ''}</td>
                <td>${escapeHtml(r.course_title)}</td>
                <td style="text-align:center">${escapeHtml(r.program_code)}</td>
                <td>${escapeHtml(r.roomList.join(', '))}</td>
                <td style="text-align:center">${r.total}</td>
                <td style="text-align:center">${r.present}</td>
                <td style="text-align:center">${r.absentUsns.length}</td>
                <td>${[
                  r.absentUsns.length > 0 ? `ABS: ${r.absentUsns.join(', ')}` : '',
                  r.malpracticeUsns.length > 0 ? `MP: ${r.malpracticeUsns.join(', ')}` : '',
                ]
                  .filter(Boolean)
                  .join(' | ') || 'NIL'}</td>
              </tr>`
            )
            .join('')}
          <tr style="font-weight:700;background:#f8fafc">
            <td colspan="5" style="text-align:right">Session Totals</td>
            <td style="text-align:center">${totals.total}</td>
            <td style="text-align:center">${totals.present}</td>
            <td style="text-align:center">${totals.absent}</td>
            <td>Malpractice: ${totals.mp}</td>
          </tr>
        </tbody>
      </table>
      <div class="signatures">
        ${renderSignatureBlockHtml('Exam Section Coordinator', null)}
        ${renderSignatureBlockHtml('Chief Superintendent', null)}
        ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSigUrl)}
      </div>`

    openBrandedPrintWindow({
      title: `${cycle.code}_${activeRun.exam_date}_FormA`,
      landscape: true,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: html,
    })
  }

  const printQpds = async () => {
    if (!cycle || !activeRun) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigs = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? sigs.get(branding.coe_signature_path) : null

    const extra = qpdsData.extra
    const html = `
      ${renderBrandedHeaderHtml(
        branding,
        'ROOM-WISE QUESTION PAPER DISTRIBUTION STATEMENT (QPDS)',
        `${cycle.name} (${cycle.code}) · Date: ${activeRun.exam_date} (${activeRun.session_code}) · Buffer: +${extra} copy/course/room`
      )}
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Block / Floor</th>
            ${effectiveCourses.map((c) => `<th style="text-align:center">${escapeHtml(c.code)}${c.isOmr ? '<br/>(OMR)' : ''}</th>`).join('')}
            <th style="text-align:center">Appearing</th>
            <th style="text-align:center">QP Indent</th>
            <th style="width:110px">Invigilator Sign</th>
          </tr>
        </thead>
        <tbody>
          ${qpdsData.rows
            .map(
              (r) => `<tr>
                <td><strong>${escapeHtml(r.room_number)}</strong></td>
                <td>${escapeHtml(r.block_floor || '—')}</td>
                ${effectiveCourses
                  .map((c) => {
                    const cnt = r.counts[c.code] ?? 0
                    return `<td style="text-align:center">${cnt > 0 ? (extra > 0 ? `${cnt} (+${extra})` : `${cnt}`) : '—'}</td>`
                  })
                  .join('')}
                <td style="text-align:center;font-weight:700">${r.roomTotal}</td>
                <td style="text-align:center;font-weight:700">${r.roomIndentTotal}</td>
                <td></td>
              </tr>`
            )
            .join('')}
          <tr style="font-weight:700;background:#f8fafc">
            <td colspan="2" style="text-align:right">Total Appearing / Total QP Indent</td>
            ${effectiveCourses
              .map(
                (c) =>
                  `<td style="text-align:center">${qpdsData.colTotals[c.code].appearing} / ${qpdsData.colTotals[c.code].indent}</td>`
              )
              .join('')}
            <td style="text-align:center">${qpdsData.rows.reduce((s, r) => s + r.roomTotal, 0)}</td>
            <td style="text-align:center">${qpdsData.rows.reduce((s, r) => s + r.roomIndentTotal, 0)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <div class="signatures">
        ${renderSignatureBlockHtml('QP Custodian', null)}
        ${renderSignatureBlockHtml('Deputy Chief Superintendent', null)}
        ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSigUrl)}
      </div>`

    openBrandedPrintWindow({
      title: `${cycle.code}_${activeRun.exam_date}_QPDS`,
      landscape: true,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: html,
    })
  }

  const printRoomPosters = async () => {
    if (!cycle || !activeRun) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)

    const pages = posterRooms
      .map(
        (rm) => `<section class="page">
          ${renderWatermarkHtml(branding, 'per-page')}
          <div class="poster-box doc-body">
            ${renderBrandedHeaderHtml(
              branding,
              `EXAMINATION SEATING CHART — ${cycle.name} (${cycle.code})`,
              `Date: ${activeRun.exam_date} · Session: ${activeRun.session_code}`
            )}
            <div class="poster-room">ROOM NO: ${escapeHtml(rm.room_number)}</div>
            <div class="poster-sub">${escapeHtml(rm.block_floor || 'Examination Hall')}${rm.remarks ? ` · ${escapeHtml(rm.remarks)}` : ''}</div>
            <table>
              <thead>
                <tr>
                  <th>Course Code</th>
                  <th>Course Title</th>
                  <th style="width:70px;text-align:center">Branch</th>
                  <th style="width:120px;text-align:center">From USN</th>
                  <th style="width:120px;text-align:center">To USN</th>
                  <th style="width:65px;text-align:center">Count</th>
                </tr>
              </thead>
              <tbody>
                ${rm.blocks
                  .map(
                    (b) => `<tr>
                      <td><strong>${escapeHtml(b.course)}</strong>${b.isOmr ? ' (OMR)' : ''}</td>
                      <td>${escapeHtml(b.title)}</td>
                      <td style="text-align:center;font-weight:600">${escapeHtml(b.program)}</td>
                      <td style="text-align:center;font-family:monospace;font-weight:700">${escapeHtml(b.firstUsn)}</td>
                      <td style="text-align:center;font-family:monospace;font-weight:700">${escapeHtml(b.lastUsn)}</td>
                      <td style="text-align:center;font-weight:700">${b.count}</td>
                    </tr>`
                  )
                  .join('')}
                <tr style="background:#f8fafc;font-weight:700">
                  <td colspan="5" style="text-align:right">Total Candidates in Room ${escapeHtml(rm.room_number)}</td>
                  <td style="text-align:center">${rm.total}</td>
                </tr>
              </tbody>
            </table>
            <p style="font-size:10px;color:#475569;margin-top:12px">
              Candidates must occupy their allotted seat numbers 15 minutes before the commencement of examination.
            </p>
          </div>
        </section>`
      )
      .join('')

    openBrandedPrintWindow({
      title: `${cycle.code}_${activeRun.exam_date}_RoomPosters`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      extraCss: `
        .poster-box { border: 2px solid #1e293b; padding: 14px; }
        .poster-room { font-size: 28px; font-weight: 800; text-align: center; margin: 10px 0 4px; letter-spacing: 0.5px; }
        .poster-sub { text-align: center; font-size: 13px; color: #334155; margin-bottom: 14px; }
      `,
      bodyHtml: pages,
    })
  }

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to manage Form B, Form A, QPDS, and Room Posters.
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        No saved Room Allotments found for <strong>{cycle.code}</strong> yet. Generate and save a session in the{' '}
        <strong>Room Allotments</strong> tab first.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Exam-Day Forms & Room-Wise QPDS</h2>
          <p className="text-xs text-slate-500">
            Absentees marked in Form B automatically reconcile into Form A counts and absentee USN statements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeRun?.id ?? ''}
            onChange={(e) => {
              setSelectedRunId(e.target.value)
              setRoomFilter('ALL')
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.exam_date} · {r.session_code} ({r.total_students} seats / {r.total_rooms_used} rooms · {r.status})
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
            {(
              [
                { id: 'FORM_B', label: 'Form B (Absentees)', icon: ClipboardCheck },
                { id: 'FORM_A', label: 'Form A', icon: FileText },
                { id: 'QPDS', label: 'Room QPDS', icon: FileSpreadsheet },
                { id: 'POSTERS', label: 'Room Posters', icon: LayoutGrid },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium transition',
                  subTab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* FORM B: LIVE ABSENTEE & BOOKLET ENTRY */}
      {subTab === 'FORM_B' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Room:</label>
              <select
                value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value)}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="ALL">All Rooms ({roomNumbers.length})</option>
                {roomNumbers.map((rm) => (
                  <option key={rm} value={rm}>
                    Room {rm}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={formBSeats.length === 0}
              onClick={printFormB}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Form B (A4)
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Room / Seat</th>
                    <th className="px-3 py-2.5 font-semibold">USN & Candidate</th>
                    <th className="px-3 py-2.5 font-semibold">Course / Branch</th>
                    <th className="px-3 py-2.5 font-semibold">Booklet No.</th>
                    <th className="px-3 py-2.5 font-semibold">Attendance (Syncs to Form A)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        Loading room attendance sheets...
                      </td>
                    </tr>
                  ) : (
                    formBSeats.map((s) => (
                      <tr key={s.id} className={cn('hover:bg-slate-50', s.attendance_status === 'ABSENT' && 'bg-red-50/40')}>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-slate-900">Rm {s.room_number}</span>
                          <span className="ml-1.5 text-slate-500">
                            #{s.seat_number} ({s.seat_label})
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-semibold text-slate-900">{s.student_reg_no}</span>
                          <p className="text-slate-600">{s.student_name}</p>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-semibold text-slate-800">{s.effective_course_code}</span>
                          <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                            {s.program_code}
                          </span>
                          {s.is_omr_exam && (
                            <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
                              OMR
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            disabled={!canManage || isRunLocked}
                            defaultValue={s.booklet_number ?? ''}
                            placeholder="Optional Sl.No"
                            onBlur={(e) => {
                              const next = e.target.value.trim() || null
                              if (next !== s.booklet_number) {
                                updateSeatMutation.mutate({ id: s.id, booklet_number: next })
                              }
                            }}
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-xs font-mono disabled:bg-slate-100"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            disabled={!canManage || isRunLocked}
                            value={s.attendance_status}
                            onChange={(e) =>
                              updateSeatMutation.mutate({
                                id: s.id,
                                attendance_status: e.target.value as AttendanceStatus,
                              })
                            }
                            className={cn(
                              'rounded-md border px-2 py-1 text-[11px] font-semibold focus:outline-none',
                              ATTENDANCE_STYLES[s.attendance_status]
                            )}
                          >
                            <option value="PRESENT">PRESENT</option>
                            <option value="ABSENT">ABSENT</option>
                            <option value="MALPRACTICE">MALPRACTICE</option>
                          </select>
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

      {/* FORM A: AUTO-SYNCED CONSOLIDATED STATEMENT */}
      {subTab === 'FORM_A' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold',
                  isRunLocked
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                )}
              >
                {isRunLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                Form A Status: {isRunLocked ? 'LOCKED (Ready for Evaluation Bundles)' : activeRun?.status}
              </span>
              {canManage && (
                <button
                  type="button"
                  disabled={toggleFormALockMutation.isPending}
                  onClick={() => {
                    const msg = isRunLocked
                      ? 'Unlock Form A? This re-opens Form B absentee/MPC editing for this session.'
                      : 'Lock Form A now? Absentees and Malpractice (MPC) records will freeze and become eligible for Evaluation Bundles.'
                    if (window.confirm(msg)) toggleFormALockMutation.mutate(!isRunLocked)
                  }}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold',
                    isRunLocked
                      ? 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  )}
                >
                  {isRunLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {isRunLocked ? 'Unlock Form A' : 'Lock Form A (Freeze Absentees & MPC)'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `${cycle.code}_${activeRun?.exam_date}_${activeRun?.session_code}_FormA.csv`,
                  ['Course_Code', 'Course_Title', 'Branch', 'Rooms', 'Registered', 'Present', 'Absent_Count', 'Absentee_USNs', 'Malpractice_USNs'],
                  formARows.map((r) => [
                    r.effective_course_code,
                    r.course_title,
                    r.program_code,
                    r.roomList.join(' | '),
                    r.total,
                    r.present,
                    r.absentUsns.length,
                    r.absentUsns.join(' '),
                    r.malpracticeUsns.join(' '),
                  ])
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Export Form A CSV
            </button>
            <button
              type="button"
              onClick={printFormA}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Form A (A4 Landscape)
            </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Course</th>
                    <th className="px-4 py-2.5 font-semibold">Branch</th>
                    <th className="px-4 py-2.5 font-semibold">Rooms</th>
                    <th className="px-4 py-2.5 font-semibold text-center">Reg.</th>
                    <th className="px-4 py-2.5 font-semibold text-center">Present</th>
                    <th className="px-4 py-2.5 font-semibold text-center">Absent</th>
                    <th className="px-4 py-2.5 font-semibold">Absentee / MP USNs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {formARows.map((r) => (
                    <tr key={`${r.effective_course_code}-${r.program_code}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-slate-900">{r.effective_course_code}</span>
                        <p className="text-slate-500">{r.course_title}</p>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{r.program_code}</td>
                      <td className="px-4 py-2.5 text-slate-600">{r.roomList.join(', ')}</td>
                      <td className="px-4 py-2.5 text-center font-medium">{r.total}</td>
                      <td className="px-4 py-2.5 text-center font-semibold text-emerald-700">{r.present}</td>
                      <td className="px-4 py-2.5 text-center font-semibold text-red-600">{r.absentUsns.length}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-700">
                        {r.absentUsns.length === 0 && r.malpracticeUsns.length === 0 ? (
                          <span className="text-slate-400">NIL</span>
                        ) : (
                          <div className="space-y-0.5">
                            {r.absentUsns.length > 0 && (
                              <p className="text-red-700">ABS: {r.absentUsns.join(', ')}</p>
                            )}
                            {r.malpracticeUsns.length > 0 && (
                              <p className="text-amber-800">MP: {r.malpracticeUsns.join(', ')}</p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ROOM-WISE QPDS */}
      {subTab === 'QPDS' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2 text-xs">
              <label className="font-medium text-slate-700">Buffer / Extra QP Copies per Course per Room:</label>
              <input
                type="number"
                min={0}
                max={10}
                value={qpExtraPerRoom}
                onChange={(e) => setQpExtraPerRoom(e.target.value)}
                className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `${cycle.code}_${activeRun?.exam_date}_${activeRun?.session_code}_QPDS.csv`,
                    ['Room', 'Block_Floor', ...effectiveCourses.map((c) => c.code), 'Total_Appearing', 'Total_QP_Indent'],
                    qpdsData.rows.map((r) => [
                      r.room_number,
                      r.block_floor,
                      ...effectiveCourses.map((c) => {
                        const cnt = r.counts[c.code] ?? 0
                        return cnt > 0 ? cnt + qpdsData.extra : 0
                      }),
                      r.roomTotal,
                      r.roomIndentTotal,
                    ])
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export QPDS CSV
              </button>
              <button
                type="button"
                onClick={printQpds}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Printer className="h-3.5 w-3.5" />
                Print Room-Wise QPDS (A4)
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Room</th>
                    {effectiveCourses.map((c) => (
                      <th key={c.code} className="px-3 py-2.5 font-semibold text-center font-mono">
                        {c.code}
                        {c.isOmr && <span className="block text-[9px] text-purple-700">OMR</span>}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 font-semibold text-center">Appearing</th>
                    <th className="px-3 py-2.5 font-semibold text-center">QP Indent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {qpdsData.rows.map((r) => (
                    <tr key={r.room_number} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-semibold text-slate-900">
                        Rm {r.room_number}
                        {r.block_floor && <span className="block text-[10px] font-normal text-slate-500">{r.block_floor}</span>}
                      </td>
                      {effectiveCourses.map((c) => {
                        const cnt = r.counts[c.code] ?? 0
                        return (
                          <td key={c.code} className="px-3 py-2.5 text-center">
                            {cnt > 0 ? (
                              <span className="font-medium text-slate-900">
                                {cnt}
                                {qpdsData.extra > 0 && (
                                  <span className="text-[10px] text-indigo-600"> (+{qpdsData.extra})</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2.5 text-center font-bold text-slate-800">{r.roomTotal}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-indigo-700">{r.roomIndentTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ROOM POSTERS (DOOR CHARTS) */}
      {subTab === 'POSTERS' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Room:</label>
              <select
                value={roomFilter}
                onChange={(e) => setRoomFilter(e.target.value)}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="ALL">All Rooms ({roomNumbers.length})</option>
                {roomNumbers.map((rm) => (
                  <option key={rm} value={rm}>
                    Room {rm}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={posterRooms.length === 0}
              onClick={printRoomPosters}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Room Posters (1 per A4 Page)
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {posterRooms.map((rm) => (
              <div key={rm.room_number} className="rounded-lg border border-slate-200 bg-white p-4 space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Room {rm.room_number}</h3>
                    <p className="text-[11px] text-slate-500">
                      {rm.block_floor || 'Examination Hall'}
                      {rm.remarks ? ` · ${rm.remarks}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                    {rm.total} seats
                  </span>
                </div>
                <div className="space-y-1.5">
                  {rm.blocks.map((b) => (
                    <div
                      key={`${b.course}-${b.program}`}
                      className="flex items-center justify-between text-xs bg-slate-50 rounded px-2.5 py-1.5"
                    >
                      <div>
                        <span className="font-mono font-semibold text-slate-900">{b.course}</span>
                        <span className="ml-1.5 rounded bg-white border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {b.program}
                        </span>
                      </div>
                      <div className="text-right font-mono text-[11px] text-slate-600">
                        {b.firstUsn} → {b.lastUsn} <strong className="text-slate-900">({b.count})</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
