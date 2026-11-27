import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Trash2, AlertTriangle, CheckCircle2, CalendarOff } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type { DutyNominationRow, DutyType } from '@/types/operations'

interface StaffItem {
  id: string
  employee_code: string
  full_name: string
  designation: string
  department_label: string | null
  branch_label: string | null
  academic_unit_id: string | null
}

interface LeaveItem {
  staff_profile_id: string
  start_date: string
  end_date: string
  leave_type: string
}

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  staff: StaffItem[]
  courses: Array<{ id: string; course_code: string; title: string }>
  leaves: LeaveItem[]
  nominations: DutyNominationRow[]
  scopedUnitId: string | null
  canNominate: boolean
}

export function DutyNominationsTab({
  institutionId,
  cycle,
  staff,
  courses,
  leaves,
  nominations,
  scopedUnitId,
  canNominate,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [staffId, setStaffId] = useState('')
  const [dutyType, setDutyType] = useState<DutyType>('INVIGILATION')
  const [courseId, setCourseId] = useState('')
  const [availFrom, setAvailFrom] = useState('')
  const [availTo, setAvailTo] = useState('')
  const [remarks, setRemarks] = useState('')
  const [filterType, setFilterType] = useState<'ALL' | DutyType>('ALL')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const visibleStaff = useMemo(() => {
    if (!scopedUnitId) return staff
    const scoped = staff.filter((s) => s.academic_unit_id === scopedUnitId)
    return scoped.length > 0 ? scoped : staff
  }, [staff, scopedUnitId])

  const leavesByStaff = useMemo(() => {
    const map = new Map<string, LeaveItem[]>()
    for (const l of leaves) {
      const list = map.get(l.staff_profile_id) ?? []
      list.push(l)
      map.set(l.staff_profile_id, list)
    }
    return map
  }, [leaves])

  const filteredNoms = useMemo(
    () => nominations.filter((n) => filterType === 'ALL' || n.duty_type === filterType),
    [nominations, filterType]
  )

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an active Exam Cycle first.')
      const st = staff.find((s) => s.id === staffId)
      if (!st) throw new Error('Select a faculty member.')
      const crs = courseId ? courses.find((c) => c.id === courseId) : null
      if ((dutyType === 'EVALUATION' || dutyType === 'BOTH') && !crs) {
        throw new Error('Select a course when nominating for Evaluation duty.')
      }

      const { error } = await supabase.from('exam_duty_nominations').insert({
        institution_id: institutionId,
        exam_cycle_id: cycle.id,
        staff_profile_id: st.id,
        faculty_code: st.employee_code,
        faculty_name: st.full_name,
        designation: st.designation || 'Assistant Professor',
        department_name: st.department_label || st.branch_label || 'General',
        duty_type: dutyType,
        course_id: crs?.id ?? null,
        course_code: crs?.course_code ?? null,
        available_from: availFrom || null,
        available_to: availTo || null,
        remarks: remarks.trim() || null,
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      })
      if (error) throw error
      return `${st.full_name} (${dutyType}${crs ? ` · ${crs.course_code}` : ''})`
    },
    onSuccess: (summary) => {
      setErrorMsg(null)
      setNotice(`Nominated ${summary}.`)
      setStaffId('')
      setRemarks('')
      queryClient.invalidateQueries({ queryKey: ['exam_duty_nominations', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Nomination failed (check duplicate).'),
  })

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('exam_duty_nominations')
        .delete()
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      setNotice('Nomination removed.')
      queryClient.invalidateQueries({ queryKey: ['exam_duty_nominations', institutionId, cycle?.id] })
    },
  })

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

      {canNominate && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            HOD Invigilation &amp; FIFO Evaluation Duty Nomination ({cycle?.code ?? 'Select Cycle'})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5 text-xs items-end">
            <div className="md:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Faculty Member *</label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              >
                <option value="">Select faculty...</option>
                {visibleStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.designation} · {s.employee_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Duty Pool</label>
              <select
                value={dutyType}
                onChange={(e) => setDutyType(e.target.value as DutyType)}
                className="w-full rounded border border-slate-300 px-2 py-1.5"
              >
                <option value="INVIGILATION">Invigilation (DCS/Rel/Inv)</option>
                <option value="EVALUATION">FIFO Evaluation</option>
                <option value="BOTH">Both Pools</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">
                Course {dutyType === 'INVIGILATION' ? '(Optional)' : '*'}
              </label>
              <select
                disabled={dutyType === 'INVIGILATION'}
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 disabled:bg-slate-100"
              >
                <option value="">Select course...</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.course_code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <button
                type="button"
                disabled={addMutation.isPending || !cycle}
                onClick={() => addMutation.mutate()}
                className="w-full inline-flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Nominate
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
            <div>
              <label className="block text-slate-600 mb-1">Available From (Optional)</label>
              <input
                type="date"
                value={availFrom}
                onChange={(e) => setAvailFrom(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Available To (Optional)</label>
              <input
                type="date"
                value={availTo}
                onChange={(e) => setAvailTo(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Remarks</label>
              <input
                type="text"
                placeholder="e.g. Subject expert / senior prof"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1"
              />
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-800">
            Nominated Faculty Pool ({filteredNoms.length} · Ordered by FIFO timestamp)
          </span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as 'ALL' | DutyType)}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
          >
            <option value="ALL">All Duty Pools</option>
            <option value="INVIGILATION">Invigilation Only</option>
            <option value="EVALUATION">Evaluation Only</option>
            <option value="BOTH">Both</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Faculty &amp; Designation</th>
                <th className="px-4 py-2.5">Dept</th>
                <th className="px-4 py-2.5">Pool / Course</th>
                <th className="px-4 py-2.5">Leave Check</th>
                <th className="px-4 py-2.5">FIFO Timestamp</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredNoms.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No duty nominations submitted for this cycle yet.
                  </td>
                </tr>
              ) : (
                filteredNoms.map((n) => {
                  const staffLeaves = leavesByStaff.get(n.staff_profile_id) ?? []
                  return (
                    <tr key={n.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-900">{n.faculty_name}</p>
                        <p className="text-[11px] text-slate-500">
                          {n.designation} · <span className="font-mono">{n.faculty_code}</span>
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{n.department_name}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-indigo-50 text-indigo-800 px-2 py-0.5 text-[10px] font-semibold">
                          {n.duty_type}
                        </span>
                        {n.course_code && (
                          <span className="ml-1.5 font-mono font-bold text-slate-800">{n.course_code}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {staffLeaves.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                            <CalendarOff className="h-3 w-3" />
                            Leave: {staffLeaves[0].start_date} → {staffLeaves[0].end_date}
                          </span>
                        ) : (
                          <span className="text-emerald-700 text-[11px]">Clear</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {new Date(n.nominated_at).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canNominate && (
                          <button
                            type="button"
                            onClick={() => removeMutation.mutate(n.id)}
                            className="p-1 text-red-500 hover:text-red-700"
                            title="Withdraw nomination"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
