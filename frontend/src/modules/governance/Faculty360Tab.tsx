import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus,
  CalendarClock,
  BookOpen,
  UserMinus,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  FacultyLeaveRow,
  GovernanceStaffRow,
  GovernanceUnitRow,
  LeaveType,
  SectionAllocationRow,
} from '@/types/governance'

interface Props {
  institutionId: string
  staff: GovernanceStaffRow[]
  units: GovernanceUnitRow[]
  allocations: SectionAllocationRow[]
  scopedUnitId: string | null
  canManage: boolean
}

export function Faculty360Tab({
  institutionId,
  staff,
  units,
  allocations,
  scopedUnitId,
  canManage,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [search, setSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState(scopedUnitId ?? 'ALL')
  const [leaveTarget, setLeaveTarget] = useState<GovernanceStaffRow | null>(null)
  const [leaveStart, setLeaveStart] = useState('')
  const [leaveEnd, setLeaveEnd] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('CASUAL')
  const [leaveReason, setLeaveReason] = useState('')

  const [onboardOpen, setOnboardOpen] = useState(false)
  const [empCode, setEmpCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [designation, setDesignation] = useState('Assistant Professor')
  const [onboardUnitId, setOnboardUnitId] = useState(scopedUnitId ?? '')
  const [branchLabel, setBranchLabel] = useState('')

  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: leaveLogs = [] } = useQuery<FacultyLeaveRow[]>({
    queryKey: ['faculty_leave_logs', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('faculty_leave_logs')
        .select('id, staff_profile_id, start_date, end_date, leave_type, reason, status')
        .eq('institution_id', institutionId)
        .order('start_date', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as FacultyLeaveRow[]
    },
  })

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase()
    return staff.filter((s) => {
      if (scopedUnitId && s.academic_unit_id && s.academic_unit_id !== scopedUnitId) return false
      if (!scopedUnitId && unitFilter !== 'ALL' && s.academic_unit_id !== unitFilter) return false
      if (q) {
        const hay = `${s.full_name} ${s.employee_code} ${s.designation} ${s.branch_label ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [staff, scopedUnitId, unitFilter, search])

  const groupedByBranch = useMemo(() => {
    const groups = new Map<string, GovernanceStaffRow[]>()
    for (const s of filteredStaff) {
      const key = (s.branch_label || s.unit_code || s.department_label || 'GENERAL').toUpperCase()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredStaff])

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, nextActive }: { id: string; nextActive: boolean }) => {
      const { error } = await supabase
        .from('staff_profiles')
        .update({ is_active: nextActive, updated_by: session?.user.id ?? null })
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      setNotice('Faculty active status updated.')
      queryClient.invalidateQueries({ queryKey: ['governance_staff', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Status update failed'),
  })

  const saveLeaveMutation = useMutation({
    mutationFn: async () => {
      if (!leaveTarget || !leaveStart || !leaveEnd) {
        throw new Error('Select start and end dates.')
      }
      const { error } = await supabase.from('faculty_leave_logs').insert({
        institution_id: institutionId,
        staff_profile_id: leaveTarget.id,
        start_date: leaveStart,
        end_date: leaveEnd,
        leave_type: leaveType,
        reason: leaveReason.trim() || null,
        status: 'RECORDED',
        recorded_by: session?.user.id ?? null,
      })
      if (error) throw error
      return leaveTarget.full_name
    },
    onSuccess: (name) => {
      setErrorMsg(null)
      setNotice(`Logged planned leave for ${name} (${leaveStart} to ${leaveEnd}).`)
      setLeaveTarget(null)
      setLeaveStart('')
      setLeaveEnd('')
      setLeaveReason('')
      queryClient.invalidateQueries({ queryKey: ['faculty_leave_logs', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Leave log failed'),
  })

  const onboardMutation = useMutation({
    mutationFn: async () => {
      if (!empCode.trim() || !fullName.trim()) {
        throw new Error('Faculty ID and Full Name are required.')
      }
      const chosenUnit = units.find((u) => u.id === onboardUnitId) ?? null
      const { error } = await supabase.rpc('onboard_department_faculty', {
        p_institution_id: institutionId,
        p_employee_code: empCode.trim().toUpperCase(),
        p_full_name: fullName.trim(),
        p_designation: designation,
        p_email: email.trim() || null,
        p_phone: null,
        p_academic_unit_id: chosenUnit?.id ?? null,
        p_department_label: chosenUnit?.name ?? null,
        p_branch_label: branchLabel.trim().toUpperCase() || chosenUnit?.code || null,
        p_is_evaluator: false,
      })
      if (error) throw error
      return fullName.trim()
    },
    onSuccess: (name) => {
      setErrorMsg(null)
      setNotice(`Onboarded ${name} into the active faculty roster.`)
      setOnboardOpen(false)
      setEmpCode('')
      setFullName('')
      setEmail('')
      setBranchLabel('')
      queryClient.invalidateQueries({ queryKey: ['governance_staff', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Onboarding failed'),
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

      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search faculty name, ID, branch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
          />
          {!scopedUnitId && (
            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
            >
              <option value="ALL">All Academic Units</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setOnboardOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Onboard New Faculty
          </button>
        )}
      </div>

      {groupedByBranch.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-xs text-slate-500">
          No faculty records match the current filter.
        </div>
      ) : (
        groupedByBranch.map(([branchKey, list]) => (
          <div key={branchKey} className="space-y-2.5">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Branch / Dept: {branchKey} ({list.length})
              </h3>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((s) => {
                const loadCount = allocations.filter((a) => a.staff_profile_id === s.id).length
                const staffLeaves = leaveLogs.filter((l) => l.staff_profile_id === s.id)
                return (
                  <div
                    key={s.id}
                    className="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col justify-between"
                  >
                    <div className="p-4 flex items-start gap-3">
                      <div
                        className={
                          s.is_active
                            ? 'h-10 w-10 rounded-full bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold text-sm shrink-0'
                            : 'h-10 w-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center font-bold text-sm shrink-0'
                        }
                      >
                        {s.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900 truncate">{s.full_name}</p>
                          <span
                            className={
                              s.is_active
                                ? 'rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold'
                                : 'rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-[10px] font-semibold'
                            }
                          >
                            {s.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {s.designation} · <span className="font-mono">{s.employee_code}</span>
                        </p>
                      </div>
                    </div>

                    <div className="px-4 py-2.5 bg-slate-50 border-y border-slate-100 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-[10px] uppercase text-slate-400 font-semibold">Teaching Load</p>
                        <p className="font-medium text-slate-800 flex items-center gap-1 mt-0.5">
                          <BookOpen className="h-3.5 w-3.5 text-indigo-500" />
                          {loadCount} {loadCount === 1 ? 'Section' : 'Sections'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-slate-400 font-semibold">Logged Leaves</p>
                        <p className="font-medium text-slate-800 mt-0.5">
                          {staffLeaves.length > 0
                            ? `${staffLeaves.length} (${staffLeaves[0].start_date})`
                            : 'None'}
                        </p>
                      </div>
                    </div>

                    {canManage && (
                      <div className="p-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setLeaveTarget(s)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          Log Leave
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                s.is_active
                                  ? `Mark ${s.full_name} as INACTIVE / RESIGNED?`
                                  : `Reactivate ${s.full_name}?`
                              )
                            ) {
                              toggleStatusMutation.mutate({ id: s.id, nextActive: !s.is_active })
                            }
                          }}
                          className={
                            s.is_active
                              ? 'rounded border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100'
                              : 'rounded border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100'
                          }
                          title={s.is_active ? 'Mark Inactive' : 'Reactivate'}
                        >
                          {s.is_active ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {/* Planned Leave Modal */}
      {leaveTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Log Planned Leave — {leaveTarget.full_name}
              </h3>
              <button type="button" onClick={() => setLeaveTarget(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={leaveStart}
                  onChange={(e) => setLeaveStart(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={leaveEnd}
                  onChange={(e) => setLeaveEnd(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>
            </div>
            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">Leave Type</label>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              >
                <option value="CASUAL">Casual Leave</option>
                <option value="FDP">FDP / Conference</option>
                <option value="ON_DUTY">On Duty (Exam / VTU)</option>
                <option value="MEDICAL">Medical Leave</option>
                <option value="MATERNITY">Maternity Leave</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="text-xs">
              <label className="block font-medium text-slate-700 mb-1">Reason / Notes</label>
              <textarea
                rows={2}
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                className="w-full rounded border border-slate-300 p-2"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLeaveTarget(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saveLeaveMutation.isPending}
                onClick={() => saveLeaveMutation.mutate()}
                className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                {saveLeaveMutation.isPending ? 'Saving...' : 'Save Leave Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboard New Faculty Modal */}
      {onboardOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Onboard New Faculty into Directory</h3>
              <button type="button" onClick={() => setOnboardOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  placeholder="Dr. Ramesh Kumar"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Faculty ID *</label>
                <input
                  type="text"
                  placeholder="AMC-CSE-042"
                  value={empCode}
                  onChange={(e) => setEmpCode(e.target.value.toUpperCase())}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono uppercase"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Designation</label>
                <select
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                >
                  <option value="Professor">Professor</option>
                  <option value="Associate Professor">Associate Professor</option>
                  <option value="Assistant Professor">Assistant Professor</option>
                  <option value="Lecturer">Lecturer</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Academic Unit / Dept</label>
                <select
                  value={onboardUnitId}
                  onChange={(e) => setOnboardUnitId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                >
                  <option value="">Select unit...</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Branch Code Label</label>
                <input
                  type="text"
                  placeholder="e.g. CS"
                  value={branchLabel}
                  onChange={(e) => setBranchLabel(e.target.value.toUpperCase())}
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5 uppercase"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOnboardOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={onboardMutation.isPending}
                onClick={() => onboardMutation.mutate()}
                className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                {onboardMutation.isPending ? 'Onboarding...' : 'Add Faculty'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
