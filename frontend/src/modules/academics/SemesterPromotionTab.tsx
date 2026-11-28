import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightCircle, CheckCircle2, AlertTriangle, ShieldAlert, Play, History } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { AcademicPeriod, Program } from '@/types/academics'
import { cn } from '@/utils/cn'

interface PromotionCandidate {
  enrollment_id: string
  student_id: string
  usn: string
  full_name: string
  scheme_batch: number | null
  section_name: string | null
  student_category: string
  active_backlogs: number
  credits_earned: number
  credits_attempted: number
  cgpa: number
  is_eligible: boolean
  eligibility_reason: string
}

interface PromotionPreviewResponse {
  from_sem: number
  is_vertical_progression: boolean
  max_active_backlogs: number
  min_credits_earned: number
  total_students: number
  eligible_count: number
  detained_count: number
  students: PromotionCandidate[]
}

interface PromotionLogRow {
  id: string
  academic_year: string
  usn: string
  action: string
  active_backlogs: number
  credits_earned: number
  reason: string | null
  promoted_by_label: string | null
  created_at: string
}

export function SemesterPromotionTab({
  institutionId,
  canManage,
}: {
  institutionId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAppStore()

  const [programId, setProgramId] = useState('')
  const [fromPeriodId, setFromPeriodId] = useState('')
  const [toPeriodId, setToPeriodId] = useState('')
  const [targetAy, setTargetAy] = useState(activeAcademicYear || '2026-27')
  const [maxBacklogs, setMaxBacklogs] = useState('4')
  const [minCredits, setMinCredits] = useState('0')
  const [clearSections, setClearSections] = useState(false)

  const [preview, setPreview] = useState<PromotionPreviewResponse | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [overrideIds, setOverrideIds] = useState<string[]>([])
  const [overrideReason, setOverrideReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: programs = [] } = useQuery<Program[]>({
    queryKey: ['programs', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('programs')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('code')
      if (error) throw error
      return (data ?? []) as Program[]
    },
  })

  const { data: periods = [] } = useQuery<AcademicPeriod[]>({
    queryKey: ['academic-periods', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_periods')
        .select('*')
        .eq('institution_id', institutionId)
        .order('sequence_number')
      if (error) throw error
      return (data ?? []) as AcademicPeriod[]
    },
  })

  const { data: recentLogs = [] } = useQuery<PromotionLogRow[]>({
    queryKey: ['student_promotion_logs', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_promotion_logs')
        .select('id, academic_year, usn, action, active_backlogs, credits_earned, reason, promoted_by_label, created_at')
        .eq('institution_id', institutionId)
        .order('created_at', { ascending: false })
        .limit(40)
      if (error) throw error
      return (data ?? []) as PromotionLogRow[]
    },
  })

  const handleFromPeriodChange = (pid: string) => {
    setFromPeriodId(pid)
    setPreview(null)
    setSelectedIds([])
    setOverrideIds([])
    const cur = periods.find((p) => p.id === pid)
    if (cur) {
      const next = periods.find((p) => p.sequence_number === cur.sequence_number + 1)
      if (next) setToPeriodId(next.id)
    }
  }

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!programId || !fromPeriodId) throw new Error('Select a Program and Source Semester first.')
      const { data, error } = await supabase.rpc('preview_semester_promotion', {
        p_institution_id: institutionId,
        p_program_id: programId,
        p_from_period_id: fromPeriodId,
        p_max_active_backlogs: Math.max(0, Number(maxBacklogs) || 0),
        p_min_credits_earned: Math.max(0, Number(minCredits) || 0),
      })
      if (error) throw error
      return data as PromotionPreviewResponse
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setPreview(res)
      setSelectedIds(res.students.filter((s) => s.is_eligible).map((s) => s.student_id))
      setOverrideIds([])
      setNotice(
        `Preview ready (${res.is_vertical_progression ? 'Even → Odd Vertical Progression' : 'Odd → Even Automatic Progression'}): ${res.eligible_count} eligible, ${res.detained_count} detained.`
      )
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Preview failed'),
  })

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!programId || !fromPeriodId || !toPeriodId) {
        throw new Error('Select Program, Source Semester, and Target Semester.')
      }
      if (fromPeriodId === toPeriodId) throw new Error('Target semester must differ from source semester.')
      if (selectedIds.length === 0 && overrideIds.length === 0) {
        throw new Error('Select at least one student to promote.')
      }
      if (overrideIds.length > 0 && !overrideReason.trim()) {
        throw new Error('Provide an executive override reason for detained student(s).')
      }
      const { data, error } = await supabase.rpc('execute_semester_promotion', {
        p_institution_id: institutionId,
        p_academic_year: targetAy.trim() || activeAcademicYear,
        p_program_id: programId,
        p_from_period_id: fromPeriodId,
        p_to_period_id: toPeriodId,
        p_student_ids: selectedIds,
        p_override_student_ids: overrideIds,
        p_override_reason: overrideReason.trim() || null,
        p_clear_sections: clearSections,
      })
      if (error) throw error
      return data as { promoted: number; override_promoted: number; total_moved: number }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setNotice(
        `Promotion complete: ${res.promoted} promoted + ${res.override_promoted} executive-override promoted (${res.total_moved} enrollments updated).`
      )
      setPreview(null)
      setSelectedIds([])
      setOverrideIds([])
      setOverrideReason('')
      queryClient.invalidateQueries({ queryKey: ['student_promotion_logs', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['front_office_students', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Promotion commit failed'),
  })

  const totalSelected = useMemo(
    () => new Set([...selectedIds, ...overrideIds]).size,
    [selectedIds, overrideIds]
  )

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Guided Semester Promotion &amp; Vertical Progression</h2>
        <p className="text-xs text-slate-500">
          Evaluates canonical latest-attempt backlogs across all exam cycles. Odd → Even promotes automatically; Even →
          Odd enforces VTU/autonomous Vertical Progression credit &amp; backlog hurdles with dry-run preview.
        </p>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> {notice}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" /> {errorMsg}
        </div>
      )}

      {/* Configuration Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Program / Branch *</label>
            <select
              value={programId}
              onChange={(e) => {
                setProgramId(e.target.value)
                setPreview(null)
              }}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
            >
              <option value="">Select Program...</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">From Semester *</label>
            <select
              value={fromPeriodId}
              onChange={(e) => handleFromPeriodChange(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
            >
              <option value="">Source Sem...</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (#{p.sequence_number})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">To Semester *</label>
            <select
              value={toPeriodId}
              onChange={(e) => setToPeriodId(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
            >
              <option value="">Target Sem...</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (#{p.sequence_number})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Max Backlogs (Even→Odd)</label>
            <input
              type="number"
              min={0}
              max={20}
              value={maxBacklogs}
              onChange={(e) => setMaxBacklogs(e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Min Credits Earned</label>
            <input
              type="number"
              min={0}
              max={200}
              value={minCredits}
              onChange={(e) => setMinCredits(e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-1.5 text-slate-700">
              Target AY:
              <input
                value={targetAy}
                onChange={(e) => setTargetAy(e.target.value)}
                className="w-24 rounded border border-slate-300 px-2 py-1 text-xs font-medium"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-700">
              <input
                type="checkbox"
                checked={clearSections}
                onChange={(e) => setClearSections(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              Clear Section Assignments (re-section next term)
            </label>
          </div>

          <button
            type="button"
            disabled={!programId || !fromPeriodId || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            {previewMutation.isPending ? 'Evaluating Cohort...' : 'Run Eligibility Preview (Dry-Run)'}
          </button>
        </div>
      </div>

      {/* Preview Table */}
      {preview && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden space-y-3">
          <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 font-bold',
                  preview.is_vertical_progression
                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                    : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                )}
              >
                {preview.is_vertical_progression
                  ? `Even → Odd Vertical Progression (Max ${preview.max_active_backlogs} Backlogs)`
                  : 'Odd → Even Automatic Progression'}
              </span>
              <span className="text-slate-700 font-semibold">
                {preview.total_students} Active · <span className="text-emerald-700">{preview.eligible_count} Eligible</span> ·{' '}
                <span className="text-red-600">{preview.detained_count} Detained</span>
              </span>
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                {overrideIds.length > 0 && (
                  <input
                    type="text"
                    placeholder="Mandatory Executive Override Reason..."
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    className="w-60 rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs"
                  />
                )}
                <button
                  type="button"
                  disabled={executeMutation.isPending || totalSelected === 0 || !toPeriodId}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Promote ${totalSelected} student(s) (${overrideIds.length} via override) to the target semester?`
                      )
                    ) {
                      executeMutation.mutate()
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  <ArrowRightCircle className="h-3.5 w-3.5" />
                  {executeMutation.isPending ? 'Promoting...' : `Commit Promotion (${totalSelected})`}
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-10">Pick</th>
                  <th className="px-3 py-2">USN &amp; Name</th>
                  <th className="px-3 py-2">Scheme / Sec</th>
                  <th className="px-3 py-2 text-center">Active Backlogs</th>
                  <th className="px-3 py-2 text-center">Credits Earned</th>
                  <th className="px-3 py-2 text-center">CGPA</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.students.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No active students found in this Program and Semester.
                    </td>
                  </tr>
                ) : (
                  preview.students.map((s) => {
                    const isPicked = s.is_eligible
                      ? selectedIds.includes(s.student_id)
                      : overrideIds.includes(s.student_id)
                    return (
                      <tr key={s.student_id} className={cn('hover:bg-slate-50', !s.is_eligible && 'bg-red-50/30')}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isPicked}
                            onChange={() => {
                              if (s.is_eligible) {
                                setSelectedIds((prev) =>
                                  prev.includes(s.student_id)
                                    ? prev.filter((x) => x !== s.student_id)
                                    : [...prev, s.student_id]
                                )
                              } else {
                                setOverrideIds((prev) =>
                                  prev.includes(s.student_id)
                                    ? prev.filter((x) => x !== s.student_id)
                                    : [...prev, s.student_id]
                                )
                              }
                            }}
                            className="rounded border-slate-300 text-indigo-600"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-bold text-slate-900">{s.usn}</span>
                          <p className="text-slate-600">{s.full_name}</p>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {s.scheme_batch != null ? `${s.scheme_batch} Scheme` : '—'}
                          {s.section_name ? ` · Sec ${s.section_name}` : ''}
                        </td>
                        <td className="px-3 py-2 text-center font-mono font-bold">
                          <span className={s.active_backlogs > 0 ? 'text-red-600' : 'text-emerald-700'}>
                            {s.active_backlogs}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center font-mono">{s.credits_earned}</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold text-indigo-700">
                          {Number(s.cgpa).toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          {s.is_eligible ? (
                            <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                              ELIGIBLE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-[10px] font-bold">
                              <ShieldAlert className="h-3 w-3" /> {isPicked ? 'OVERRIDE' : 'DETAINED'}
                            </span>
                          )}
                          <p className="text-[10px] text-slate-500 mt-0.5">{s.eligibility_reason}</p>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Promotion Audit History */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <History className="h-3.5 w-3.5 text-indigo-600" />
          Recent Semester Promotion Audit Log ({recentLogs.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">AY</th>
                <th className="px-3 py-2">USN</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2 text-center">Backlogs / Cr</th>
                <th className="px-3 py-2">By / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No semester promotions committed yet.
                  </td>
                </tr>
              ) : (
                recentLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-slate-500">{new Date(l.created_at).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 font-mono">{l.academic_year}</td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">{l.usn}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-bold',
                          l.action === 'OVERRIDE_PROMOTED'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-100 text-emerald-800'
                        )}
                      >
                        {l.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {l.active_backlogs} BL / {l.credits_earned} Cr
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {l.promoted_by_label ?? 'Admin'} {l.reason ? `· ${l.reason}` : ''}
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
