import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building,
  Plus,
  Play,
  Trash2,
  Edit2,
  Check,
  X,
  ArrowRightLeft,
  AlertTriangle,
  Lock,
  CheckCircle2,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  AllotmentRunStatus,
  ExamCourseAlias,
  ExamCycle,
  ExamRoom,
  ExamRoomAllotmentRun,
  ExamSessionCode,
} from '@/types/exams'
import {
  buildRoomAllotment,
  cleanRoomNumber,
  naturalRoomCompare,
  type AllocationCandidate,
} from './allocationEngine'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  canManage: boolean
  canDelete: boolean
}

interface SessionOption {
  key: string
  exam_date: string
  session_code: ExamSessionCode
  courses: Array<{ course_id: string; course_code: string; course_title: string; is_omr_exam: boolean }>
}

interface RoomFormState {
  room_number: string
  room_name: string
  block_name: string
  floor_label: string
  capacity: string
  rows_count: string
  columns_count: string
  sort_order: string
  remarks: string
  is_active: boolean
}

const emptyRoomForm = (): RoomFormState => ({
  room_number: '',
  room_name: '',
  block_name: '',
  floor_label: '',
  capacity: '30',
  rows_count: '6',
  columns_count: '5',
  sort_order: '0',
  remarks: '',
  is_active: true,
})

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function RoomAllotmentsTab({ institutionId, cycle, canManage, canDelete }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [subTab, setSubTab] = useState<'ENGINE' | 'ROOMS' | 'ALIASES'>('ENGINE')

  // Seating Engine state
  const [selectedSessionKey, setSelectedSessionKey] = useState('')
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[] | null>(null)
  const [smallBranchThreshold, setSmallBranchThreshold] = useState('15')
  const [interleaveDescriptive, setInterleaveDescriptive] = useState(true)
  const [omrSequential, setOmrSequential] = useState(true)
  const [approvedOnly, setApprovedOnly] = useState(true)
  const [engineNotice, setEngineNotice] = useState<string | null>(null)

  // Room Master form state
  const [showRoomForm, setShowRoomForm] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [roomForm, setRoomForm] = useState<RoomFormState>(emptyRoomForm())
  const [roomError, setRoomError] = useState<string | null>(null)

  // Course Alias form state
  const [aliasSource, setAliasSource] = useState('')
  const [aliasCanonical, setAliasCanonical] = useState('')
  const [aliasRemarks, setAliasRemarks] = useState('')
  const [aliasError, setAliasError] = useState<string | null>(null)

  const { data: rooms = [] } = useQuery<ExamRoom[]>({
    queryKey: ['exam_rooms', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_rooms')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
      if (error) throw error
      return ((data ?? []) as ExamRoom[]).sort(naturalRoomCompare)
    },
  })

  const { data: aliases = [] } = useQuery<ExamCourseAlias[]>({
    queryKey: ['exam_course_aliases', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_course_aliases')
        .select('*')
        .eq('institution_id', institutionId)
        .order('source_course_code')
      if (error) throw error
      return (data ?? []) as ExamCourseAlias[]
    },
  })

  const { data: sessionOptions = [] } = useQuery<SessionOption[]>({
    queryKey: ['exam_timetable_sessions', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_timetable_slots')
        .select('course_id, exam_date, session_code, is_omr_exam, course_catalog (course_code, title)')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('exam_date', { ascending: true })
        .order('session_code', { ascending: true })
      if (error) throw error

      const map = new Map<string, SessionOption>()
      for (const row of data ?? []) {
        const key = `${row.exam_date}::${row.session_code}`
        const cc = unwrap(
          row.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null
        )
        const existing = map.get(key) ?? {
          key,
          exam_date: row.exam_date as string,
          session_code: row.session_code as ExamSessionCode,
          courses: [],
        }
        existing.courses.push({
          course_id: row.course_id as string,
          course_code: cc?.course_code ?? '—',
          course_title: cc?.title ?? '—',
          is_omr_exam: Boolean(row.is_omr_exam),
        })
        map.set(key, existing)
      }
      return Array.from(map.values())
    },
  })

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

  const activeSession = useMemo(() => {
    if (selectedSessionKey) {
      return sessionOptions.find((s) => s.key === selectedSessionKey) ?? sessionOptions[0] ?? null
    }
    return sessionOptions[0] ?? null
  }, [sessionOptions, selectedSessionKey])

  const { data: sessionCandidates = [], isFetching: loadingCandidates } = useQuery<AllocationCandidate[]>({
    queryKey: ['exam_session_candidates', institutionId, cycle?.id, activeSession?.key, approvedOnly],
    enabled: Boolean(cycle?.id && activeSession && activeSession.courses.length > 0),
    queryFn: async () => {
      const courseIds = activeSession!.courses.map((c) => c.course_id)
      const omrLookup = new Map(activeSession!.courses.map((c) => [c.course_id, c.is_omr_exam]))

      const { data, error } = await supabase
        .from('exam_registration_courses')
        .select(`
          id, registration_id, student_id, course_id, is_online_exempt, eligibility_status,
          course_catalog (course_code, title),
          exam_registrations!inner (
            id, status, program_id,
            students (registration_number, full_name),
            programs (code)
          )
        `)
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .in('course_id', courseIds)
        .eq('is_online_exempt', false)
        .eq('eligibility_status', 'ELIGIBLE')

      if (error) throw error

      const list: AllocationCandidate[] = []
      for (const row of data ?? []) {
        const er = unwrap(row.exam_registrations as Record<string, unknown> | Record<string, unknown>[] | null)
        if (!er) continue
        if (approvedOnly && er.status !== 'APPROVED') continue
        const stu = unwrap(
          er.students as { registration_number: string; full_name: string } | { registration_number: string; full_name: string }[] | null
        )
        const prog = unwrap(er.programs as { code: string } | { code: string }[] | null)
        const cc = unwrap(
          row.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null
        )
        list.push({
          student_id: row.student_id as string,
          student_reg_no: stu?.registration_number ?? '—',
          student_name: stu?.full_name ?? '—',
          registration_id: row.registration_id as string,
          registration_course_id: row.id as string,
          course_id: row.course_id as string,
          course_code: cc?.course_code ?? '—',
          course_title: cc?.title ?? '—',
          program_id: er.program_id as string,
          program_code: prog?.code ?? '—',
          is_omr_exam: omrLookup.get(row.course_id as string) ?? false,
        })
      }
      return list
    },
  })

  const effectiveSelectedRooms = useMemo(() => {
    const activeRooms = rooms.filter((r) => r.is_active)
    if (selectedRoomIds === null) return activeRooms
    const set = new Set(selectedRoomIds)
    return activeRooms.filter((r) => set.has(r.id))
  }, [rooms, selectedRoomIds])

  const previewPlan = useMemo(() => {
    return buildRoomAllotment({
      candidates: sessionCandidates,
      rooms: effectiveSelectedRooms,
      aliases,
      smallBranchThreshold: Math.max(0, Number(smallBranchThreshold) || 0),
      interleaveDescriptive,
      omrSequential,
    })
  }, [sessionCandidates, effectiveSelectedRooms, aliases, smallBranchThreshold, interleaveDescriptive, omrSequential])

  const existingRunForSession = useMemo(() => {
    if (!activeSession) return null
    return (
      runs.find(
        (r) => r.exam_date === activeSession.exam_date && r.session_code === activeSession.session_code
      ) ?? null
    )
  }, [runs, activeSession])

  const saveAllotmentMutation = useMutation({
    mutationFn: async () => {
      if (!cycle || !activeSession) throw new Error('Select a scheduled exam date & session first.')
      if (existingRunForSession?.status === 'LOCKED') {
        throw new Error('This session allotment is LOCKED. Unlock it before regenerating seats.')
      }
      if (previewPlan.seats.length === 0) {
        throw new Error('No eligible students found to allocate for this session.')
      }
      if (previewPlan.unallocated.length > 0) {
        throw new Error(
          `Insufficient room capacity: ${previewPlan.unallocated.length} student(s) remain unallocated. Enable or add more rooms first.`
        )
      }

      const runPayload = {
        institution_id: institutionId,
        exam_cycle_id: cycle.id,
        exam_date: activeSession.exam_date,
        session_code: activeSession.session_code,
        status: 'DRAFT' as AllotmentRunStatus,
        small_branch_threshold: Math.max(0, Number(smallBranchThreshold) || 0),
        interleave_descriptive: interleaveDescriptive,
        omr_sequential: omrSequential,
        total_students: previewPlan.seats.length,
        total_rooms_used: previewPlan.totalRoomsUsed,
        summary: {
          rooms: previewPlan.roomSummaries.map((rs) => ({
            room_number: cleanRoomNumber(rs.room.room_number),
            assigned: rs.assignedCount,
            capacity: rs.room.capacity,
          })),
        },
        updated_by: session?.user.id ?? null,
      }

      let runId: string
      if (existingRunForSession) {
        const { error: updErr } = await supabase
          .from('exam_room_allotment_runs')
          .update(runPayload)
          .eq('id', existingRunForSession.id)
        if (updErr) throw updErr
        runId = existingRunForSession.id

        const { error: delErr } = await supabase
          .from('exam_seat_allotments')
          .delete()
          .eq('allotment_run_id', runId)
        if (delErr) throw delErr
      } else {
        const { data: created, error: insErr } = await supabase
          .from('exam_room_allotment_runs')
          .insert({ ...runPayload, created_by: session?.user.id ?? null })
          .select('id')
          .single()
        if (insErr) throw insErr
        runId = created.id as string
      }

      // Insert seats in 400-row chunks to prevent statement timeouts on large cohorts
      const chunkSize = 400
      for (let i = 0; i < previewPlan.seats.length; i += chunkSize) {
        const batch = previewPlan.seats.slice(i, i + chunkSize).map((s) => ({
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          allotment_run_id: runId,
          room_id: s.room_id,
          exam_date: activeSession.exam_date,
          session_code: activeSession.session_code,
          seat_number: s.seat_number,
          seat_label: s.seat_label,
          student_id: s.student_id,
          registration_id: s.registration_id,
          registration_course_id: s.registration_course_id,
          course_id: s.course_id,
          program_id: s.program_id,
          effective_course_code: s.effective_course_code,
          is_omr_exam: s.is_omr_exam,
          attendance_status: 'PRESENT',
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        }))
        const { error: seatErr } = await supabase.from('exam_seat_allotments').insert(batch)
        if (seatErr) throw seatErr
      }

      return { seats: previewPlan.seats.length, roomsUsed: previewPlan.totalRoomsUsed }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['exam_allotment_runs', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_seat_allotments', institutionId, cycle?.id] })
      setEngineNotice(
        `Saved ${res.seats} seat allotments across ${res.roomsUsed} rooms for ${activeSession?.exam_date} (${activeSession?.session_code}). Switch to "A/B Forms & QPDS" to print posters, Form B, Form A, and Room-Wise QPDS.`
      )
    },
    onError: (err) => {
      setEngineNotice(err instanceof Error ? err.message : 'Failed to save room allotment')
    },
  })

  const updateRunStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AllotmentRunStatus }) => {
      const { error } = await supabase
        .from('exam_room_allotment_runs')
        .update({ status, updated_by: session?.user.id ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_allotment_runs', institutionId, cycle?.id] })
    },
  })

  const saveRoomMutation = useMutation({
    mutationFn: async () => {
      const num = cleanRoomNumber(roomForm.room_number)
      const cap = Number(roomForm.capacity)
      if (!num || !cap || cap <= 0) throw new Error('Room number and positive capacity are required.')

      const payload = {
        institution_id: institutionId,
        room_number: num,
        room_name: roomForm.room_name.trim() || null,
        block_name: roomForm.block_name.trim() || null,
        floor_label: roomForm.floor_label.trim() || null,
        capacity: cap,
        rows_count: Math.max(1, Number(roomForm.rows_count) || 6),
        columns_count: Math.max(1, Number(roomForm.columns_count) || 5),
        sort_order: Number(roomForm.sort_order) || 0,
        remarks: roomForm.remarks.trim() || null,
        is_active: roomForm.is_active,
        updated_by: session?.user.id ?? null,
      }

      if (editingRoomId) {
        const { error } = await supabase.from('exam_rooms').update(payload).eq('id', editingRoomId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('exam_rooms')
          .insert({ ...payload, created_by: session?.user.id ?? null })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_rooms', institutionId] })
      setShowRoomForm(false)
      setEditingRoomId(null)
      setRoomForm(emptyRoomForm())
      setRoomError(null)
    },
    onError: (err) => {
      setRoomError(err instanceof Error ? err.message : 'Failed to save room')
    },
  })

  const deleteRoomMutation = useMutation({
    mutationFn: async (roomId: string) => {
      const { error } = await supabase
        .from('exam_rooms')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', roomId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_rooms', institutionId] })
    },
  })

  const saveAliasMutation = useMutation({
    mutationFn: async () => {
      const src = aliasSource.trim().toUpperCase()
      const dst = aliasCanonical.trim().toUpperCase()
      if (!src || !dst) throw new Error('Source course code and canonical code are required.')
      const { error } = await supabase.from('exam_course_aliases').insert({
        institution_id: institutionId,
        source_course_code: src,
        canonical_course_code: dst,
        remarks: aliasRemarks.trim() || null,
        is_active: true,
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_course_aliases', institutionId] })
      setAliasSource('')
      setAliasCanonical('')
      setAliasRemarks('')
      setAliasError(null)
    },
    onError: (err) => {
      setAliasError(err instanceof Error ? err.message : 'Failed to add course alias')
    },
  })

  const deleteAliasMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('exam_course_aliases').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_course_aliases', institutionId] })
    },
  })

  const toggleRoomSelection = (roomId: string) => {
    const activeIds = rooms.filter((r) => r.is_active).map((r) => r.id)
    const current = selectedRoomIds ?? activeIds
    const next = current.includes(roomId) ? current.filter((x) => x !== roomId) : [...current, roomId]
    setSelectedRoomIds(next)
  }

  const totalSelectedCapacity = effectiveSelectedRooms.reduce((sum, r) => sum + r.capacity, 0)

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to run Room Allotments.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Room Allotments & Venue Setup — {cycle.code}</h2>
          <p className="text-xs text-slate-500">
            Numerically sorted rooms, sequential un-shuffled OMR seating, small-branch consolidation, and course alias
            grouping.
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          {(
            [
              { id: 'ENGINE', label: 'Seating Engine' },
              { id: 'ROOMS', label: `Rooms (${rooms.length})` },
              { id: 'ALIASES', label: `Course Aliases (${aliases.length})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={cn(
                'rounded px-3 py-1.5 font-medium transition',
                subTab === item.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* SUB-TAB 1: SEATING ENGINE */}
      {subTab === 'ENGINE' && (
        <div className="space-y-4">
          {sessionOptions.length === 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-xs text-amber-800">
              No timetable sessions exist yet for <strong>{cycle.code}</strong>. Schedule exam dates & FN/AN sessions in
              the <strong>Timetable</strong> tab first.
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      1. Select Scheduled Exam Date & Session
                    </label>
                    <select
                      value={activeSession?.key ?? ''}
                      onChange={(e) => {
                        setSelectedSessionKey(e.target.value)
                        setEngineNotice(null)
                      }}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-medium"
                    >
                      {sessionOptions.map((s) => {
                        const hasOmr = s.courses.some((c) => c.is_omr_exam)
                        return (
                          <option key={s.key} value={s.key}>
                            {s.exam_date} · {s.session_code} — {s.courses.map((c) => c.course_code).join(', ')}
                            {hasOmr ? ' [OMR]' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Small-Branch Consolidation Threshold
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={smallBranchThreshold}
                      onChange={(e) => setSmallBranchThreshold(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={omrSequential}
                      onChange={(e) => setOmrSequential(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    Sequential Un-Shuffled OMR Placement
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={interleaveDescriptive}
                      onChange={(e) => setInterleaveDescriptive(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    Interleave Distinct Descriptive Subjects in Shared Rooms
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={approvedOnly}
                      onChange={(e) => setApprovedOnly(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    COE Approved Registrations Only
                  </label>
                </div>

                {/* Room Picker Strip */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">
                      2. Active Rooms Included ({effectiveSelectedRooms.length} rooms · {totalSelectedCapacity} seats)
                    </span>
                    <button
                      type="button"
                      onClick={() => setSubTab('ROOMS')}
                      className="text-indigo-600 hover:underline font-medium"
                    >
                      + Manage Rooms
                    </button>
                  </div>
                  {rooms.filter((r) => r.is_active).length === 0 ? (
                    <p className="text-xs text-amber-700">
                      No active rooms configured yet. Switch to the <strong>Rooms</strong> tab to add exam halls.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {rooms
                        .filter((r) => r.is_active)
                        .map((r) => {
                          const picked = effectiveSelectedRooms.some((er) => er.id === r.id)
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => toggleRoomSelection(r.id)}
                              className={cn(
                                'rounded-md border px-2.5 py-1 text-[11px] font-medium transition',
                                picked
                                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                                  : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                              )}
                            >
                              {cleanRoomNumber(r.room_number)} ({r.capacity})
                            </button>
                          )
                        })}
                    </div>
                  )}
                </div>

                {/* Live Capacity & Save Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                  <div className="text-xs space-y-0.5">
                    <p className="text-slate-700">
                      <strong>{loadingCandidates ? '...' : sessionCandidates.length}</strong> eligible candidates ·{' '}
                      <strong>{previewPlan.totalRoomsUsed}</strong> rooms required ·{' '}
                      <span
                        className={cn(
                          'font-semibold',
                          previewPlan.unallocated.length > 0 ? 'text-red-600' : 'text-emerald-700'
                        )}
                      >
                        {previewPlan.unallocated.length > 0
                          ? `${previewPlan.unallocated.length} unallocated (add rooms)`
                          : '100% seated'}
                      </span>
                    </p>
                    {existingRunForSession && (
                      <p className="text-[11px] text-slate-500">
                        Saved Run Status: <strong>{existingRunForSession.status}</strong> (
                        {existingRunForSession.total_students} seats in {existingRunForSession.total_rooms_used} rooms)
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {canManage && existingRunForSession && (
                      <button
                        type="button"
                        onClick={() =>
                          updateRunStatusMutation.mutate({
                            id: existingRunForSession.id,
                            status: existingRunForSession.status === 'LOCKED' ? 'PUBLISHED' : 'LOCKED',
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        {existingRunForSession.status === 'LOCKED' ? 'Unlock Run' : 'Lock Run'}
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        disabled={
                          saveAllotmentMutation.isPending ||
                          previewPlan.seats.length === 0 ||
                          previewPlan.unallocated.length > 0 ||
                          existingRunForSession?.status === 'LOCKED'
                        }
                        onClick={() => saveAllotmentMutation.mutate()}
                        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {saveAllotmentMutation.isPending
                          ? 'Saving Seats...'
                          : existingRunForSession
                            ? 'Regenerate & Save Allotment'
                            : 'Generate & Save Allotment'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {engineNotice && (
                <div className="flex items-center gap-2 rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2.5 text-xs text-indigo-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-600" />
                  {engineNotice}
                </div>
              )}

              {previewPlan.unallocated.length > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Selected room capacity ({totalSelectedCapacity}) is below eligible candidate count (
                  {sessionCandidates.length}). Add or enable additional rooms before saving.
                </div>
              )}

              {/* Live Allocation Preview Grid */}
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">
                    Room-by-Room Allocation Plan Preview ({previewPlan.roomSummaries.length} rooms)
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Sorted numerically · Small branches consolidated
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/60 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Room</th>
                        <th className="px-4 py-2 font-semibold">Utilization</th>
                        <th className="px-4 py-2 font-semibold">Course / Branch Blocks & USN Ranges</th>
                        <th className="px-4 py-2 font-semibold">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewPlan.roomSummaries.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                            No candidates planned for this session yet.
                          </td>
                        </tr>
                      ) : (
                        previewPlan.roomSummaries.map((rs) => (
                          <tr key={rs.room.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 align-top">
                              <p className="font-semibold text-slate-900">
                                Room {cleanRoomNumber(rs.room.room_number)}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {[rs.room.block_name, rs.room.floor_label].filter(Boolean).join(' · ') || '—'}
                              </p>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span className="font-semibold text-slate-900">
                                {rs.assignedCount} / {rs.room.capacity}
                              </span>
                              <p className="text-[11px] text-slate-500">
                                {Math.round((rs.assignedCount / rs.room.capacity) * 100)}% full
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-1">
                                {rs.courseBranchCounts.map((cb) => (
                                  <div
                                    key={`${cb.effective_course_code}-${cb.program_code}`}
                                    className="flex flex-wrap items-center gap-2 text-[11px]"
                                  >
                                    <span className="font-mono font-semibold text-slate-900">
                                      {cb.effective_course_code}
                                    </span>
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                                      {cb.program_code} ({cb.count})
                                    </span>
                                    {cb.is_omr_exam && (
                                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
                                        OMR Seq
                                      </span>
                                    )}
                                    <span className="font-mono text-slate-500">
                                      {cb.firstUsn} → {cb.lastUsn}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top text-slate-500">{rs.room.remarks ?? '—'}</td>
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

      {/* SUB-TAB 2: ROOM MASTER */}
      {subTab === 'ROOMS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Configure examination halls. Rooms automatically sort numerically and clean trailing decimals.
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setEditingRoomId(null)
                  setRoomForm(emptyRoomForm())
                  setRoomError(null)
                  setShowRoomForm(true)
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" />
                Add Room
              </button>
            )}
          </div>

          {showRoomForm && (
            <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  {editingRoomId ? 'Edit Exam Room' : 'Add Exam Room'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowRoomForm(false)}
                  className="p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {roomError && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  {roomError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Room Number *</label>
                  <input
                    type="text"
                    placeholder="e.g. 101, 204, LH-01"
                    value={roomForm.room_number}
                    onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Capacity *</label>
                  <input
                    type="number"
                    min={1}
                    value={roomForm.capacity}
                    onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Block</label>
                  <input
                    type="text"
                    placeholder="e.g. Main Block / Admin"
                    value={roomForm.block_name}
                    onChange={(e) => setRoomForm({ ...roomForm, block_name: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Floor</label>
                  <input
                    type="text"
                    placeholder="e.g. 1st Floor"
                    value={roomForm.floor_label}
                    onChange={(e) => setRoomForm({ ...roomForm, floor_label: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Rows</label>
                  <input
                    type="number"
                    min={1}
                    value={roomForm.rows_count}
                    onChange={(e) => setRoomForm({ ...roomForm, rows_count: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Columns</label>
                  <input
                    type="number"
                    min={1}
                    value={roomForm.columns_count}
                    onChange={(e) => setRoomForm({ ...roomForm, columns_count: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Room Remarks (Printed on Poster)</label>
                  <input
                    type="text"
                    placeholder="e.g. Ground floor accessible / CCTV Hall / Drawing Hall"
                    value={roomForm.remarks}
                    onChange={(e) => setRoomForm({ ...roomForm, remarks: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={roomForm.is_active}
                    onChange={(e) => setRoomForm({ ...roomForm, is_active: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  Active for Seating Allocation
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRoomForm(false)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={saveRoomMutation.isPending}
                    onClick={() => saveRoomMutation.mutate()}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save Room
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Room Number</th>
                  <th className="px-4 py-2.5 font-semibold">Block / Floor</th>
                  <th className="px-4 py-2.5 font-semibold">Capacity (Grid)</th>
                  <th className="px-4 py-2.5 font-semibold">Remarks</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rooms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      <Building className="h-6 w-6 text-slate-300 mx-auto mb-1" />
                      No exam rooms configured yet. Add your examination halls above.
                    </td>
                  </tr>
                ) : (
                  rooms.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">
                        {cleanRoomNumber(r.room_number)}
                        {r.room_name && <span className="ml-1.5 font-normal text-slate-500">({r.room_name})</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {[r.block_name, r.floor_label].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {r.capacity} seats ({r.rows_count}×{r.columns_count})
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">{r.remarks ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            r.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          )}
                        >
                          {r.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRoomId(r.id)
                                setRoomForm({
                                  room_number: cleanRoomNumber(r.room_number),
                                  room_name: r.room_name ?? '',
                                  block_name: r.block_name ?? '',
                                  floor_label: r.floor_label ?? '',
                                  capacity: String(r.capacity),
                                  rows_count: String(r.rows_count),
                                  columns_count: String(r.columns_count),
                                  sort_order: String(r.sort_order),
                                  remarks: r.remarks ?? '',
                                  is_active: r.is_active,
                                })
                                setShowRoomForm(true)
                              }}
                              className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Remove room ${cleanRoomNumber(r.room_number)}?`)) {
                                  deleteRoomMutation.mutate(r.id)
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
      )}

      {/* SUB-TAB 3: SUBJECT ALIAS MAPPINGS */}
      {subTab === 'ALIASES' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Subject Code Alias Mappings</h3>
              <p className="text-xs text-slate-500">
                Merge equivalent subject codes (for example, <span className="font-mono">1BKSK109 → 1BKSK209</span>,{' '}
                <span className="font-mono">1BKBK109 → 1BKBK209</span>, or{' '}
                <span className="font-mono">1BENG106 → 1BENG206</span>) during room seating, Form A, and Room-Wise QPDS.
              </p>
            </div>
            {aliasError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {aliasError}
              </div>
            )}
            {canManage && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input
                  type="text"
                  placeholder="Source Code (e.g. 1BKSK109)"
                  value={aliasSource}
                  onChange={(e) => setAliasSource(e.target.value)}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                />
                <input
                  type="text"
                  placeholder="Canonical Code (e.g. 1BKSK209)"
                  value={aliasCanonical}
                  onChange={(e) => setAliasCanonical(e.target.value)}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                />
                <input
                  type="text"
                  placeholder="Remarks (Optional)"
                  value={aliasRemarks}
                  onChange={(e) => setAliasRemarks(e.target.value)}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={saveAliasMutation.isPending}
                  onClick={() => saveAliasMutation.mutate()}
                  className="inline-flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Add Mapping
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Source Code</th>
                  <th className="px-4 py-2.5 font-semibold">Mapped Canonical Code</th>
                  <th className="px-4 py-2.5 font-semibold">Remarks</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aliases.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      No subject alias mappings configured yet.
                    </td>
                  </tr>
                ) : (
                  aliases.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{a.source_course_code}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-indigo-700">{a.canonical_course_code}</td>
                      <td className="px-4 py-2.5 text-slate-500">{a.remarks ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => deleteAliasMutation.mutate(a.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
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
      )}
    </div>
  )
}
