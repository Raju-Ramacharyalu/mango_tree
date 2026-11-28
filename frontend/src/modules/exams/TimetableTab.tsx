import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, X, Check, Clock, AlertTriangle } from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { CourseCatalogOption, ExamCycle, ExamSessionCode, ExamTimetableSlot } from '@/types/exams'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  canManage: boolean
  canDelete: boolean
}

interface SlotFormState {
  course_id: string
  exam_date: string
  session_code: ExamSessionCode
  start_time: string
  end_time: string
  duration_hours: string
  is_omr_exam: boolean
  qp_code: string
  remarks: string
}

const emptyForm = (defaultDate = ''): SlotFormState => ({
  course_id: '',
  exam_date: defaultDate,
  session_code: 'FN',
  start_time: '09:30',
  end_time: '12:30',
  duration_hours: '3',
  is_omr_exam: false,
  qp_code: '',
  remarks: '',
})

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function fmtTime(t: string) {
  return t.slice(0, 5)
}

export function TimetableTab({ institutionId, cycle, canManage, canDelete }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SlotFormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)

  const { data: courses = [] } = useQuery<CourseCatalogOption[]>({
    queryKey: ['exam_course_catalog', institutionId],
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
          row.course_categories as { code: string; is_online: boolean } | { code: string; is_online: boolean }[] | null
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

  const { data: slots = [], isLoading } = useQuery<ExamTimetableSlot[]>({
    queryKey: ['exam_timetable_slots', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_timetable_slots')
        .select(`
          id, institution_id, exam_cycle_id, course_id, exam_date, session_code,
          start_time, end_time, duration_hours, is_omr_exam, qp_code, remarks,
          course_catalog (course_code, title)
        `)
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('exam_date', { ascending: true })
        .order('start_time', { ascending: true })
      if (error) throw error
      return (data ?? []).map((row) => {
        const cc = unwrap(
          row.course_catalog as { course_code: string; title: string } | { course_code: string; title: string }[] | null
        )
        return {
          id: row.id as string,
          institution_id: row.institution_id as string,
          exam_cycle_id: row.exam_cycle_id as string,
          course_id: row.course_id as string,
          exam_date: row.exam_date as string,
          session_code: row.session_code as ExamSessionCode,
          start_time: row.start_time as string,
          end_time: row.end_time as string,
          duration_hours: Number(row.duration_hours ?? 3),
          is_omr_exam: Boolean(row.is_omr_exam),
          qp_code: (row.qp_code as string | null) ?? null,
          remarks: (row.remarks as string | null) ?? null,
          course_code: cc?.course_code ?? '—',
          course_title: cc?.title ?? '—',
        }
      })
    },
  })

  // Detect registered non-online courses in this cycle that don't have a timetable slot yet
  const { data: registeredCourseIds = [] } = useQuery<string[]>({
    queryKey: ['exam_registered_course_ids', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const data = await fetchAllRows<{ course_id: string }>((from, to) =>
        supabase
          .from('exam_registration_courses')
          .select('course_id')
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle!.id)
          .eq('is_online_exempt', false)
          .eq('eligibility_status', 'ELIGIBLE')
          .order('id', { ascending: true })
          .range(from, to)
      )
      return Array.from(new Set((data ?? []).map((r) => r.course_id as string)))
    },
  })

  const unscheduledRegisteredCourses = useMemo(() => {
    const scheduled = new Set(slots.map((s) => s.course_id))
    const regSet = new Set(registeredCourseIds)
    return courses.filter((c) => regSet.has(c.id) && !scheduled.has(c.id) && !c.is_online)
  }, [courses, slots, registeredCourseIds])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an exam cycle first.')
      if (!form.course_id || !form.exam_date || !form.start_time || !form.end_time) {
        throw new Error('Course, exam date, start time, and end time are required.')
      }
      if (form.end_time <= form.start_time) {
        throw new Error('End time must be after start time.')
      }

      const payload = {
        institution_id: institutionId,
        exam_cycle_id: cycle.id,
        course_id: form.course_id,
        exam_date: form.exam_date,
        session_code: form.session_code,
        start_time: form.start_time,
        end_time: form.end_time,
        duration_hours: Number(form.duration_hours) || 3,
        is_omr_exam: form.is_omr_exam,
        qp_code: form.qp_code.trim().toUpperCase() || null,
        remarks: form.remarks.trim() || null,
        updated_by: session?.user.id ?? null,
      }

      if (editingId) {
        const { error } = await supabase.from('exam_timetable_slots').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('exam_timetable_slots')
          .insert({ ...payload, created_by: session?.user.id ?? null })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_timetable_slots', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_appearing_rows', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_hall_tickets', institutionId, cycle?.id] })
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm(cycle?.exam_starts_on ?? ''))
      setFormError(null)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save timetable slot')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await supabase.from('exam_timetable_slots').delete().eq('id', slotId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_timetable_slots', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_appearing_rows', institutionId, cycle?.id] })
    },
  })

  const applySessionPreset = (sessionCode: ExamSessionCode, isOmr: boolean) => {
    if (sessionCode === 'FN') {
      return {
        session_code: sessionCode,
        start_time: '09:30',
        end_time: isOmr ? '10:30' : '12:30',
        duration_hours: isOmr ? '1' : '3',
      }
    }
    if (sessionCode === 'AN') {
      return {
        session_code: sessionCode,
        start_time: '14:00',
        end_time: isOmr ? '15:00' : '17:00',
        duration_hours: isOmr ? '1' : '3',
      }
    }
    return { session_code: sessionCode }
  }

  const openCreate = (preselectCourseId = '') => {
    setEditingId(null)
    setForm({
      ...emptyForm(cycle?.exam_starts_on ?? ''),
      course_id: preselectCourseId,
    })
    setFormError(null)
    setShowForm(true)
  }

  const openEdit = (slot: ExamTimetableSlot) => {
    setEditingId(slot.id)
    setForm({
      course_id: slot.course_id,
      exam_date: slot.exam_date,
      session_code: slot.session_code,
      start_time: fmtTime(slot.start_time),
      end_time: fmtTime(slot.end_time),
      duration_hours: String(slot.duration_hours),
      is_omr_exam: slot.is_omr_exam,
      qp_code: slot.qp_code ?? '',
      remarks: slot.remarks ?? '',
    })
    setFormError(null)
    setShowForm(true)
  }

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to configure the Exam Timetable.
      </div>
    )
  }

  const schedulableCourses = courses.filter((c) => !c.is_online)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Exam Timetable — {cycle.code}</h2>
          <p className="text-xs text-slate-500">
            Schedule exam dates, FN/AN timings, and OMR flags. Scheduled dates flow directly into Appearing Lists, Hall
            Tickets, and M11 Room Allotments.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Schedule Course
          </button>
        )}
      </div>

      {unscheduledRegisteredCourses.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            {unscheduledRegisteredCourses.length} registered course
            {unscheduledRegisteredCourses.length === 1 ? '' : 's'} not yet on the timetable (will show "TBD" on Hall
            Tickets):
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unscheduledRegisteredCourses.slice(0, 14).map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={!canManage}
                onClick={() => openCreate(c.id)}
                className="rounded-md bg-white border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              >
                + {c.course_code} ({c.title.slice(0, 26)})
              </button>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {editingId ? 'Edit Timetable Slot' : 'Schedule Exam Slot'}
            </h3>
            <button type="button" onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {formError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{formError}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Course (Non-ONLINE) *</label>
              <select
                value={form.course_id}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm({ ...form, course_id: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-100"
              >
                <option value="">Select course...</option>
                {schedulableCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.course_code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Exam Date *</label>
              <input
                type="date"
                value={form.exam_date}
                onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Session</label>
              <select
                value={form.session_code}
                onChange={(e) => {
                  const sc = e.target.value as ExamSessionCode
                  setForm((prev) => ({ ...prev, ...applySessionPreset(sc, prev.is_omr_exam) }))
                }}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              >
                <option value="FN">FN (Forenoon)</option>
                <option value="AN">AN (Afternoon)</option>
                <option value="CUSTOM">Custom Timing</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Start Time *</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">End Time *</label>
              <input
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Duration (Hours)</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={form.duration_hours}
                onChange={(e) => setForm({ ...form, duration_hours: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">QP Code (Optional)</label>
              <input
                type="text"
                placeholder="e.g. QP-2026-CS101"
                value={form.qp_code}
                onChange={(e) => setForm({ ...form, qp_code: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={form.is_omr_exam}
                  onChange={(e) => {
                    const isOmr = e.target.checked
                    setForm((prev) => ({
                      ...prev,
                      is_omr_exam: isOmr,
                      ...applySessionPreset(prev.session_code, isOmr),
                    }))
                  }}
                  className="rounded border-slate-300 text-indigo-600"
                />
                OMR Exam (1-hr, sequential seating)
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {saveMutation.isPending ? 'Saving...' : 'Save Slot'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Date & Session</th>
                <th className="px-4 py-2.5 font-semibold">Course</th>
                <th className="px-4 py-2.5 font-semibold">Timing / Duration</th>
                <th className="px-4 py-2.5 font-semibold">Mode / QP Code</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    Loading exam timetable...
                  </td>
                </tr>
              ) : slots.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No timetable slots scheduled for {cycle.code} yet.
                  </td>
                </tr>
              ) : (
                slots.map((slot) => (
                  <tr key={slot.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-900">{slot.exam_date}</span>
                      <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                        {slot.session_code}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-slate-900">{slot.course_code}</span>
                      <p className="text-slate-600">{slot.course_title}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {fmtTime(slot.start_time)} – {fmtTime(slot.end_time)} ({slot.duration_hours}h)
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {slot.is_omr_exam ? (
                        <span className="rounded bg-purple-50 border border-purple-200 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                          OMR
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          Descriptive
                        </span>
                      )}
                      {slot.qp_code && (
                        <span className="ml-2 font-mono text-[11px] text-slate-500">{slot.qp_code}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => openEdit(slot)}
                            className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Remove ${slot.course_code} from timetable?`)) {
                                deleteMutation.mutate(slot.id)
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
    </div>
  )
}
