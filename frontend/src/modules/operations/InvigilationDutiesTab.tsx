import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, Sparkles, Printer, Trash2, CheckCircle2, AlertTriangle, Plus } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type { DutyNominationRow, DutyRole, InvigilationDutyRow } from '@/types/operations'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
} from '@/modules/exams/printBranding'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  nominations: DutyNominationRow[]
  leaves: Array<{ staff_profile_id: string; start_date: string; end_date: string }>
  canManage: boolean
}

interface SlotSummary {
  key: string
  exam_date: string
  session_code: 'FN' | 'AN' | 'CUSTOM'
  coursesCount: number
  roomsNeeded: number
  studentsCount: number
}

function classifyRoleFromDesignation(designation: string): DutyRole {
  const d = designation.toLowerCase()
  if (d.includes('associate')) return 'RELIEVER'
  if (d.includes('professor') && !d.includes('assistant')) return 'DCS'
  return 'INVIGILATOR'
}

export function InvigilationDutiesTab({
  institutionId,
  institutionName,
  cycle,
  nominations,
  leaves,
  canManage,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [selectedSlotKey, setSelectedSlotKey] = useState('')
  const [manualStaffId, setManualStaffId] = useState('')
  const [manualRole, setManualRole] = useState<DutyRole>('INVIGILATOR')
  const [manualRoomId, setManualRoomId] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: timetableSlots = [] } = useQuery({
    queryKey: ['ops_timetable_slots', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_timetable_slots')
        .select('exam_date, session_code, course_id')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('exam_date', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })

  const { data: allotmentRuns = [] } = useQuery({
    queryKey: ['ops_allotment_runs', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_room_allotment_runs')
        .select('exam_date, session_code, total_students, total_rooms_used')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
      if (error) throw error
      return data ?? []
    },
  })

  const { data: rooms = [] } = useQuery<Array<{ id: string; room_number: string; capacity: number }>>({
    queryKey: ['ops_exam_rooms', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_rooms')
        .select('id, room_number, capacity')
        .eq('institution_id', institutionId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .order('room_number', { ascending: true })
      if (error) throw error
      return (data ?? []) as Array<{ id: string; room_number: string; capacity: number }>
    },
  })

  const { data: duties = [] } = useQuery<InvigilationDutyRow[]>({
    queryKey: ['exam_invigilation_duties', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_invigilation_duties')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('exam_date', { ascending: true })
        .order('duty_role', { ascending: true })
      if (error) throw error
      return (data ?? []) as InvigilationDutyRow[]
    },
  })

  const slots = useMemo<SlotSummary[]>(() => {
    const runMap = new Map<string, { rooms: number; students: number }>()
    for (const r of allotmentRuns) {
      const k = `${r.exam_date}__${r.session_code}`
      runMap.set(k, { rooms: Number(r.total_rooms_used ?? 0), students: Number(r.total_students ?? 0) })
    }
    const grouped = new Map<string, SlotSummary>()
    for (const t of timetableSlots) {
      const k = `${t.exam_date}__${t.session_code}`
      const existing = grouped.get(k)
      const runInfo = runMap.get(k)
      if (!existing) {
        grouped.set(k, {
          key: k,
          exam_date: t.exam_date as string,
          session_code: t.session_code as 'FN' | 'AN' | 'CUSTOM',
          coursesCount: 1,
          roomsNeeded: runInfo?.rooms || Math.min(rooms.length, 4) || 1,
          studentsCount: runInfo?.students || 0,
        })
      } else {
        existing.coursesCount += 1
      }
    }
    return Array.from(grouped.values())
  }, [timetableSlots, allotmentRuns, rooms.length])

  const activeSlot = slots.find((s) => s.key === selectedSlotKey) ?? slots[0] ?? null

  const slotDuties = useMemo(() => {
    if (!activeSlot) return []
    return duties.filter(
      (d) => d.exam_date === activeSlot.exam_date && d.session_code === activeSlot.session_code
    )
  }, [duties, activeSlot])

  const isOnLeave = (staffId: string, examDate: string) =>
    leaves.some((l) => l.staff_profile_id === staffId && l.start_date <= examDate && l.end_date >= examDate)

  const invigPool = useMemo(() => {
    const seen = new Set<string>()
    return nominations.filter((n) => {
      if (n.duty_type !== 'INVIGILATION' && n.duty_type !== 'BOTH') return false
      if (seen.has(n.staff_profile_id)) return false
      seen.add(n.staff_profile_id)
      return true
    })
  }, [nominations])

  const requiredCounts = useMemo(() => {
    const r = activeSlot?.roomsNeeded ?? 0
    return {
      rooms: r,
      dcs: r > 0 ? Math.max(1, Math.ceil(r / 5)) : 0,
      relievers: r > 0 ? Math.max(1, Math.ceil(r / 4)) : 0,
      invigilators: r,
    }
  }, [activeSlot])

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      if (!cycle || !activeSlot) throw new Error('Select a valid exam date/session first.')
      const alreadyAssigned = new Set(slotDuties.map((d) => d.staff_profile_id))
      const available = invigPool.filter(
        (n) => !alreadyAssigned.has(n.staff_profile_id) && !isOnLeave(n.staff_profile_id, activeSlot.exam_date)
      )
      if (available.length === 0) throw new Error('No unassigned leave-free nominees available for this session.')

      // Fair-load sort: staff with fewest existing duties in this cycle go first
      const loadCount = new Map<string, number>()
      for (const d of duties) {
        loadCount.set(d.staff_profile_id, (loadCount.get(d.staff_profile_id) ?? 0) + 1)
      }
      available.sort(
        (a, b) => (loadCount.get(a.staff_profile_id) ?? 0) - (loadCount.get(b.staff_profile_id) ?? 0)
      )

      const curDcs = slotDuties.filter((d) => d.duty_role === 'DCS').length
      const curRel = slotDuties.filter((d) => d.duty_role === 'RELIEVER').length
      const curInv = slotDuties.filter((d) => d.duty_role === 'INVIGILATOR').length

      const needDcs = Math.max(0, requiredCounts.dcs - curDcs)
      const needRel = Math.max(0, requiredCounts.relievers - curRel)
      const needInv = Math.max(0, requiredCounts.invigilators - curInv)

      const usedIds = new Set<string>()
      const payloads: Array<Record<string, unknown>> = []

      const pickRole = (role: DutyRole, needed: number, preferMatches: boolean) => {
        if (needed <= 0) return
        const candidates = available.filter(
          (n) =>
            !usedIds.has(n.staff_profile_id) &&
            (!preferMatches || classifyRoleFromDesignation(n.designation) === role)
        )
        for (const c of candidates.slice(0, needed)) {
          usedIds.add(c.staff_profile_id)
          const roomObj =
            role === 'INVIGILATOR' ? rooms[curInv + payloads.filter((p) => p.duty_role === 'INVIGILATOR').length] : null
          payloads.push({
            institution_id: institutionId,
            exam_cycle_id: cycle.id,
            exam_date: activeSlot.exam_date,
            session_code: activeSlot.session_code,
            staff_profile_id: c.staff_profile_id,
            faculty_code: c.faculty_code,
            faculty_name: c.faculty_name,
            designation: c.designation,
            department_name: c.department_name,
            duty_role: role,
            room_id: roomObj?.id ?? null,
            room_number: roomObj?.room_number ?? null,
            status: 'ASSIGNED',
            created_by: session?.user.id ?? null,
            updated_by: session?.user.id ?? null,
          })
        }
      }

      pickRole('DCS', needDcs, true)
      pickRole('RELIEVER', needRel, true)
      pickRole('INVIGILATOR', needInv, false)

      if (payloads.length === 0) throw new Error('All required DCS, Reliever, and Invigilator slots are already filled.')

      const { error } = await supabase.from('exam_invigilation_duties').insert(payloads)
      if (error) throw error
      return payloads.length
    },
    onSuccess: (count) => {
      setErrorMsg(null)
      setNotice(`Auto-assigned ${count} leave-free faculty members for ${activeSlot?.exam_date} (${activeSlot?.session_code}).`)
      queryClient.invalidateQueries({ queryKey: ['exam_invigilation_duties', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Auto-assign failed'),
  })

  const manualAddMutation = useMutation({
    mutationFn: async () => {
      if (!cycle || !activeSlot || !manualStaffId) throw new Error('Select a session and faculty member.')
      const nom = invigPool.find((n) => n.staff_profile_id === manualStaffId)
      if (!nom) throw new Error('Faculty not found in invigilation nominations.')
      if (isOnLeave(nom.staff_profile_id, activeSlot.exam_date)) {
        throw new Error(`${nom.faculty_name} has a logged planned leave on ${activeSlot.exam_date}.`)
      }
      const room = manualRoomId ? rooms.find((r) => r.id === manualRoomId) : null
      const { error } = await supabase.from('exam_invigilation_duties').insert({
        institution_id: institutionId,
        exam_cycle_id: cycle.id,
        exam_date: activeSlot.exam_date,
        session_code: activeSlot.session_code,
        staff_profile_id: nom.staff_profile_id,
        faculty_code: nom.faculty_code,
        faculty_name: nom.faculty_name,
        designation: nom.designation,
        department_name: nom.department_name,
        duty_role: manualRole,
        room_id: room?.id ?? null,
        room_number: room?.room_number ?? null,
        status: 'ASSIGNED',
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('Duty added to session roster.')
      setManualStaffId('')
      queryClient.invalidateQueries({ queryKey: ['exam_invigilation_duties', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Unable to add duty'),
  })

  const deleteDutyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('exam_invigilation_duties')
        .delete()
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_invigilation_duties', institutionId, cycle?.id] })
    },
  })

  const printDutyOrder = async () => {
    if (!activeSlot || slotDuties.length === 0) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigMap = await signPrivateAssets([branding.coe_signature_path, branding.principal_signature_path])
    const coeSig = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null
    const prinSig = branding.principal_signature_path ? (sigMap.get(branding.principal_signature_path) ?? null) : null

    const rowsHtml = slotDuties
      .map(
        (d, idx) => `<tr>
          <td style="text-align:center">${idx + 1}</td>
          <td style="font-family:monospace;font-weight:700">${escapeHtml(d.faculty_code)}</td>
          <td><strong>${escapeHtml(d.faculty_name)}</strong><br/><span style="font-size:9.5px;color:#475569">${escapeHtml(d.designation)} · ${escapeHtml(d.department_name)}</span></td>
          <td style="text-align:center;font-weight:700">${escapeHtml(d.duty_role)}</td>
          <td style="text-align:center">${escapeHtml(d.room_number || 'Floor Duty')}</td>
          <td></td>
        </tr>`
      )
      .join('')

    openBrandedPrintWindow({
      title: `Invigilation_Duty_${activeSlot.exam_date}_${activeSlot.session_code}`,
      landscape: false,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: `
        ${renderWatermarkHtml(branding, 'per-page')}
        ${renderBrandedHeaderHtml(
          branding,
          `EXAMINATION INVIGILATION DUTY ORDER — ${cycle?.code ?? ''}`,
          `Date: ${activeSlot.exam_date} | Session: ${activeSlot.session_code} | Rooms Required: ${requiredCounts.rooms}`
        )}
        <table>
          <thead>
            <tr>
              <th style="width:36px;text-align:center">Sl.</th>
              <th style="width:92px">Emp Code</th>
              <th>Faculty Name, Designation &amp; Dept</th>
              <th style="width:88px;text-align:center">Duty Role</th>
              <th style="width:82px;text-align:center">Room</th>
              <th style="width:90px;text-align:center">Signature</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="font-size:10px;color:#334155"><strong>Instructions:</strong> Report to the Chief Superintendent / COE Control Room 30 minutes prior to the examination start time.</p>
        <div class="signatures">
          ${renderSignatureBlockHtml('Controller of Examinations', coeSig)}
          ${renderSignatureBlockHtml('Principal / Chief Superintendent', prinSig)}
        </div>
      `,
    })
  }

  return (
    <div className="space-y-4">
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

      {slots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
          No timetable slots found for <strong>{cycle?.code ?? 'this cycle'}</strong>. Configure Exam Dates in{' '}
          <strong>Examinations → Timetable</strong> first.
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-600" />
                <select
                  value={activeSlot?.key ?? ''}
                  onChange={(e) => setSelectedSlotKey(e.target.value)}
                  className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900"
                >
                  {slots.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.exam_date} · {s.session_code} ({s.coursesCount} courses · {s.roomsNeeded} rooms)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canManage && (
                  <button
                    type="button"
                    disabled={autoAssignMutation.isPending}
                    onClick={() => autoAssignMutation.mutate()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Auto-Assign DCS / Relievers / Invigilators
                  </button>
                )}
                <button
                  type="button"
                  disabled={slotDuties.length === 0}
                  onClick={printDutyOrder}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Duty Order PDF
                </button>
              </div>
            </div>

            {/* Required vs Assigned Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="rounded bg-slate-50 border border-slate-200 p-2.5">
                <p className="text-slate-500">Exam Rooms Needed</p>
                <p className="text-lg font-bold text-slate-900">{requiredCounts.rooms}</p>
              </div>
              <div className="rounded bg-purple-50 border border-purple-200 p-2.5">
                <p className="text-purple-700">DCS (Professors)</p>
                <p className="text-lg font-bold text-purple-900">
                  {slotDuties.filter((d) => d.duty_role === 'DCS').length} / {requiredCounts.dcs}
                </p>
              </div>
              <div className="rounded bg-blue-50 border border-blue-200 p-2.5">
                <p className="text-blue-700">Relievers (Assoc. Prof)</p>
                <p className="text-lg font-bold text-blue-900">
                  {slotDuties.filter((d) => d.duty_role === 'RELIEVER').length} / {requiredCounts.relievers}
                </p>
              </div>
              <div className="rounded bg-emerald-50 border border-emerald-200 p-2.5">
                <p className="text-emerald-700">Room Invigilators</p>
                <p className="text-lg font-bold text-emerald-900">
                  {slotDuties.filter((d) => d.duty_role === 'INVIGILATOR').length} / {requiredCounts.invigilators}
                </p>
              </div>
            </div>

            {canManage && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
                <select
                  value={manualStaffId}
                  onChange={(e) => setManualStaffId(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1.5"
                >
                  <option value="">Add nominated faculty manually...</option>
                  {invigPool.map((n) => (
                    <option key={n.staff_profile_id} value={n.staff_profile_id}>
                      {n.faculty_name} ({n.designation})
                    </option>
                  ))}
                </select>
                <select
                  value={manualRole}
                  onChange={(e) => setManualRole(e.target.value as DutyRole)}
                  className="rounded border border-slate-300 px-2 py-1.5"
                >
                  <option value="INVIGILATOR">Room Invigilator</option>
                  <option value="RELIEVER">Reliever (Assoc. Prof)</option>
                  <option value="DCS">DCS (Professor)</option>
                </select>
                <select
                  value={manualRoomId}
                  onChange={(e) => setManualRoomId(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1.5"
                >
                  <option value="">Floor / Unassigned Room</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.room_number} (Cap {r.capacity})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={manualAddMutation.isPending || !manualStaffId}
                  onClick={() => manualAddMutation.mutate()}
                  className="inline-flex items-center justify-center gap-1 rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Duty
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Faculty</th>
                    <th className="px-4 py-2.5">Department</th>
                    <th className="px-4 py-2.5">Duty Role</th>
                    <th className="px-4 py-2.5">Room</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {slotDuties.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        No invigilation duties assigned for {activeSlot?.exam_date} ({activeSlot?.session_code}) yet.
                      </td>
                    </tr>
                  ) : (
                    slotDuties.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-900">{d.faculty_name}</p>
                          <p className="text-[11px] text-slate-500">
                            {d.designation} · <span className="font-mono">{d.faculty_code}</span>
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{d.department_name}</td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-indigo-50 text-indigo-800 px-2.5 py-0.5 text-[10px] font-bold">
                            {d.duty_role}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-800">{d.room_number ?? 'Floor / Squad'}</td>
                        <td className="px-4 py-2.5 text-right">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => deleteDutyMutation.mutate(d.id)}
                              className="p-1 text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
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
  )
}
