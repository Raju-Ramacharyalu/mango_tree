import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightCircle,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Play,
  History,
  Sliders,
  Plus,
  Trash2,
  Edit2,
  X,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { AcademicPeriod, Program } from '@/types/academics'
import { cn } from '@/utils/cn'

interface PromotionRuleRow {
  id: string
  institution_id: string
  rule_name: string
  program_level: string
  scheme_batch: number | null
  from_sem: number
  to_sem: number
  is_automatic: boolean
  max_active_backlogs: number | null
  max_failed_credits: number | null
  min_credits_earned: number | null
  min_credits_percent: number | null
  require_clear_upto_sem: number | null
  allow_executive_override: boolean
  is_active: boolean
  remarks: string | null
}

interface PromotionCandidate {
  enrollment_id: string
  student_id: string
  usn: string
  full_name: string
  scheme_batch: number | null
  section_name: string | null
  student_category: string
  active_backlogs: number
  failed_credits: number
  prior_year_backlogs: number
  credits_earned: number
  credits_attempted: number
  credits_pct: number
  cgpa: number
  is_eligible: boolean
  eligibility_reason: string
}

interface PromotionPreviewResponse {
  from_sem: number
  to_sem: number
  program_level: string
  rule_id: string | null
  rule_name: string
  is_vertical_progression: boolean
  max_active_backlogs: number | null
  max_failed_credits: number | null
  min_credits_earned: number | null
  min_credits_percent: number | null
  require_clear_upto_sem: number | null
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

interface RuleFormState {
  rule_name: string
  program_level: string
  scheme_batch: string
  from_sem: string
  to_sem: string
  is_automatic: boolean
  max_active_backlogs: string
  max_failed_credits: string
  min_credits_earned: string
  min_credits_percent: string
  require_clear_upto_sem: string
  remarks: string
}

const emptyRuleForm = (): RuleFormState => ({
  rule_name: '',
  program_level: 'UG',
  scheme_batch: '',
  from_sem: '2',
  to_sem: '3',
  is_automatic: false,
  max_active_backlogs: '4',
  max_failed_credits: '',
  min_credits_earned: '',
  min_credits_percent: '',
  require_clear_upto_sem: '',
  remarks: '',
})

export function SemesterPromotionTab({
  institutionId,
  canManage,
}: {
  institutionId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const { activeAcademicYear, session } = useAppStore()

  const [subTab, setSubTab] = useState<'RUN' | 'RULES'>('RUN')

  // Promotion Run state
  const [programId, setProgramId] = useState('')
  const [fromPeriodId, setFromPeriodId] = useState('')
  const [toPeriodId, setToPeriodId] = useState('')
  const [selectedRuleId, setSelectedRuleId] = useState('AUTO')
  const [targetAy, setTargetAy] = useState(activeAcademicYear || '2026-27')
  const [clearSections, setClearSections] = useState(false)
  const [preview, setPreview] = useState<PromotionPreviewResponse | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [overrideIds, setOverrideIds] = useState<string[]>([])
  const [overrideReason, setOverrideReason] = useState('')

  // Rule Editor state
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [ruleForm, setRuleForm] = useState<RuleFormState>(emptyRuleForm())

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

  const { data: rules = [] } = useQuery<PromotionRuleRow[]>({
    queryKey: ['promotion_rules', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promotion_rules')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('is_active', true)
        .order('program_level', { ascending: true })
        .order('from_sem', { ascending: true })
      if (error) throw error
      return (data ?? []) as PromotionRuleRow[]
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

  const selectedProgram = programs.find((p) => p.id === programId) ?? null
  const fromPeriod = periods.find((p) => p.id === fromPeriodId) ?? null
  const toPeriod = periods.find((p) => p.id === toPeriodId) ?? null

  const matchingRulesForTransition = useMemo(() => {
    if (!fromPeriod) return rules
    const fSem = fromPeriod.sequence_number
    const lvl = selectedProgram?.program_level ?? 'UG'
    return rules.filter(
      (r) => r.from_sem === fSem && (r.program_level === lvl || r.program_level === 'ALL')
    )
  }, [rules, fromPeriod, selectedProgram])

  const handleFromPeriodChange = (pid: string) => {
    setFromPeriodId(pid)
    setPreview(null)
    setSelectedIds([])
    setOverrideIds([])
    setSelectedRuleId('AUTO')
    const cur = periods.find((p) => p.id === pid)
    if (cur) {
      const next = periods.find((p) => p.sequence_number === cur.sequence_number + 1)
      if (next) setToPeriodId(next.id)
    }
  }

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!programId || !fromPeriodId) throw new Error('Select a Program and Source Semester first.')
      const { data, error } = await supabase.rpc('preview_semester_promotion_v2', {
        p_institution_id: institutionId,
        p_program_id: programId,
        p_from_period_id: fromPeriodId,
        p_to_period_id: toPeriodId || null,
        p_rule_id: selectedRuleId !== 'AUTO' ? selectedRuleId : null,
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
        `Evaluated against "${res.rule_name}": ${res.eligible_count} Eligible, ${res.detained_count} Detained (NFT) out of ${res.total_students} active students.`
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

  const saveRuleMutation = useMutation({
    mutationFn: async () => {
      if (!ruleForm.rule_name.trim()) throw new Error('Rule name is required.')
      const fSem = Math.max(1, Math.min(8, Number(ruleForm.from_sem) || 2))
      const tSem = Math.max(2, Math.min(9, Number(ruleForm.to_sem) || fSem + 1))
      const payload = {
        institution_id: institutionId,
        rule_name: ruleForm.rule_name.trim(),
        program_level: ruleForm.program_level,
        scheme_batch: ruleForm.scheme_batch.trim() ? Number(ruleForm.scheme_batch) : null,
        from_sem: fSem,
        to_sem: tSem,
        is_automatic: ruleForm.is_automatic,
        max_active_backlogs:
          !ruleForm.is_automatic && ruleForm.max_active_backlogs.trim() !== ''
            ? Number(ruleForm.max_active_backlogs)
            : null,
        max_failed_credits:
          !ruleForm.is_automatic && ruleForm.max_failed_credits.trim() !== ''
            ? Number(ruleForm.max_failed_credits)
            : null,
        min_credits_earned:
          !ruleForm.is_automatic && ruleForm.min_credits_earned.trim() !== ''
            ? Number(ruleForm.min_credits_earned)
            : null,
        min_credits_percent:
          !ruleForm.is_automatic && ruleForm.min_credits_percent.trim() !== ''
            ? Number(ruleForm.min_credits_percent)
            : null,
        require_clear_upto_sem:
          !ruleForm.is_automatic && ruleForm.require_clear_upto_sem.trim() !== ''
            ? Number(ruleForm.require_clear_upto_sem)
            : null,
        remarks: ruleForm.remarks.trim() || null,
        is_active: true,
        updated_by: session?.user.id ?? null,
      }

      if (editingRuleId) {
        const { error } = await supabase.from('promotion_rules').update(payload).eq('id', editingRuleId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('promotion_rules')
          .insert({ ...payload, created_by: session?.user.id ?? null })
        if (error) throw error
      }
    },
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('Saved vertical progression rule.')
      setShowRuleForm(false)
      setEditingRuleId(null)
      setRuleForm(emptyRuleForm())
      queryClient.invalidateQueries({ queryKey: ['promotion_rules', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to save promotion rule'),
  })

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('promotion_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotion_rules', institutionId] })
    },
  })

  const openEditRule = (r: PromotionRuleRow) => {
    setEditingRuleId(r.id)
    setRuleForm({
      rule_name: r.rule_name,
      program_level: r.program_level,
      scheme_batch: r.scheme_batch !== null ? String(r.scheme_batch) : '',
      from_sem: String(r.from_sem),
      to_sem: String(r.to_sem),
      is_automatic: r.is_automatic,
      max_active_backlogs: r.max_active_backlogs !== null ? String(r.max_active_backlogs) : '',
      max_failed_credits: r.max_failed_credits !== null ? String(r.max_failed_credits) : '',
      min_credits_earned: r.min_credits_earned !== null ? String(r.min_credits_earned) : '',
      min_credits_percent: r.min_credits_percent !== null ? String(r.min_credits_percent) : '',
      require_clear_upto_sem: r.require_clear_upto_sem !== null ? String(r.require_clear_upto_sem) : '',
      remarks: r.remarks ?? '',
    })
    setShowRuleForm(true)
  }

  const totalSelected = useMemo(
    () => new Set([...selectedIds, ...overrideIds]).size,
    [selectedIds, overrideIds]
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            COE Result-Driven Semester Promotion &amp; Vertical Progression
          </h2>
          <p className="text-xs text-slate-500">
            Evaluates canonical latest-attempt exam results (including Arrear, Summer, ODE &amp; Revaluation clearances)
            against your institution&apos;s configurable Odd → Even and Even → Odd Vertical Progression rules.
          </p>
        </div>

        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSubTab('RUN')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium',
              subTab === 'RUN' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <ArrowRightCircle className="h-3.5 w-3.5" />
            Run Promotion
          </button>
          <button
            type="button"
            onClick={() => setSubTab('RULES')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium',
              subTab === 'RULES' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            <Sliders className="h-3.5 w-3.5" />
            Configure Vertical Rules ({rules.length})
          </button>
        </div>
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

      {/* SUB-TAB 2: CONFIGURABLE VERTICAL PROGRESSION RULES */}
      {subTab === 'RULES' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600">
              Define exact Even → Odd Vertical Progression hurdles per <strong>Program Level (UG / PG)</strong>,{' '}
              <strong>Scheme Batch (22 / 25 / 26)</strong>, and <strong>Semester Transition</strong> (max backlogs,
              max failed credits, min credits / %, and mandatory prior-year clearance).
            </p>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setEditingRuleId(null)
                  setRuleForm(emptyRuleForm())
                  setShowRuleForm(true)
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add Progression Rule
              </button>
            )}
          </div>

          {showRuleForm && (
            <div className="rounded-lg border border-indigo-200 bg-white p-4 space-y-3 text-xs shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-sm font-bold text-slate-900">
                  {editingRuleId ? 'Edit Vertical Progression Rule' : 'New Vertical Progression Rule'}
                </h3>
                <button type="button" onClick={() => setShowRuleForm(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <div className="md:col-span-3">
                  <label className="block font-semibold text-slate-700 mb-1">Rule Name *</label>
                  <input
                    value={ruleForm.rule_name}
                    onChange={(e) => setRuleForm({ ...ruleForm, rule_name: e.target.value })}
                    placeholder="e.g. UG 25-Scheme · Sem 4 → 5 Vertical Hurdle"
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Program Level</label>
                  <select
                    value={ruleForm.program_level}
                    onChange={(e) => setRuleForm({ ...ruleForm, program_level: e.target.value })}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                  >
                    <option value="UG">UG</option>
                    <option value="PG">PG</option>
                    <option value="ALL">ALL Levels</option>
                    <option value="DIPLOMA">DIPLOMA</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Scheme (Optional)</label>
                  <input
                    type="number"
                    placeholder="All (or 25 / 26)"
                    value={ruleForm.scheme_batch}
                    onChange={(e) => setRuleForm({ ...ruleForm, scheme_batch: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">From</label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={ruleForm.from_sem}
                      onChange={(e) => {
                        const f = Number(e.target.value) || 1
                        setRuleForm({
                          ...ruleForm,
                          from_sem: String(f),
                          to_sem: String(f + 1),
                          is_automatic: f % 2 === 1,
                        })
                      }}
                      className="w-full rounded border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">To</label>
                    <input
                      type="number"
                      min={2}
                      max={9}
                      value={ruleForm.to_sem}
                      onChange={(e) => setRuleForm({ ...ruleForm, to_sem: e.target.value })}
                      className="w-full rounded border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={ruleForm.is_automatic}
                  onChange={(e) => setRuleForm({ ...ruleForm, is_automatic: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Automatic Progression (Odd → Even — no backlog/credit hurdle)
              </label>

              {!ruleForm.is_automatic && (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Max Active Backlogs</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="e.g. 4 (blank=off)"
                      value={ruleForm.max_active_backlogs}
                      onChange={(e) => setRuleForm({ ...ruleForm, max_active_backlogs: e.target.value })}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Max Failed Credits</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="e.g. 16 (blank=off)"
                      value={ruleForm.max_failed_credits}
                      onChange={(e) => setRuleForm({ ...ruleForm, max_failed_credits: e.target.value })}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Min Credits Earned</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="e.g. 24 (blank=off)"
                      value={ruleForm.min_credits_earned}
                      onChange={(e) => setRuleForm({ ...ruleForm, min_credits_earned: e.target.value })}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Min Credits %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="e.g. 50 (blank=off)"
                      value={ruleForm.min_credits_percent}
                      onChange={(e) => setRuleForm({ ...ruleForm, min_credits_percent: e.target.value })}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Clear All Up To Sem</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      placeholder="e.g. 2 (1st Yr clear)"
                      value={ruleForm.require_clear_upto_sem}
                      onChange={(e) => setRuleForm({ ...ruleForm, require_clear_upto_sem: e.target.value })}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Regulation / Circular Note</label>
                <input
                  value={ruleForm.remarks}
                  onChange={(e) => setRuleForm({ ...ruleForm, remarks: e.target.value })}
                  placeholder="e.g. VTU Autonomous Reg 2025 Cl. 8.2"
                  className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRuleForm(false)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saveRuleMutation.isPending}
                  onClick={() => saveRuleMutation.mutate()}
                  className="rounded bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  {saveRuleMutation.isPending ? 'Saving...' : 'Save Rule'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5">Rule &amp; Scope</th>
                    <th className="px-4 py-2.5 text-center">Transition</th>
                    <th className="px-4 py-2.5">Mode</th>
                    <th className="px-4 py-2.5">Configured Vertical Hurdles</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rules.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-900">{r.rule_name}</p>
                        <p className="text-[11px] text-slate-500">
                          {r.program_level} · {r.scheme_batch ? `${r.scheme_batch} Scheme` : 'All Schemes'}
                          {r.remarks ? ` · ${r.remarks}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono font-bold text-indigo-800">
                        Sem {r.from_sem} → Sem {r.to_sem}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            r.is_automatic ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'
                          )}
                        >
                          {r.is_automatic ? 'AUTOMATIC' : 'VERTICAL HURDLE'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {r.is_automatic ? (
                          <span className="text-slate-400">No backlog/credit gate</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {r.max_active_backlogs !== null && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                                Backlogs ≤ {r.max_active_backlogs}
                              </span>
                            )}
                            {r.max_failed_credits !== null && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                                Failed Cr ≤ {r.max_failed_credits}
                              </span>
                            )}
                            {r.min_credits_earned !== null && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                                Earned Cr ≥ {r.min_credits_earned}
                              </span>
                            )}
                            {r.min_credits_percent !== null && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                                Earned % ≥ {r.min_credits_percent}%
                              </span>
                            )}
                            {r.require_clear_upto_sem !== null && (
                              <span className="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 font-semibold text-[11px]">
                                Zero Backlogs in Sem 1–{r.require_clear_upto_sem}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canManage && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditRule(r)}
                              className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Delete progression rule "${r.rule_name}"?`)) {
                                  deleteRuleMutation.mutate(r.id)
                                }
                              }}
                              className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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

      {/* SUB-TAB 1: RUN RESULT-DRIVEN PROMOTION */}
      {subTab === 'RUN' && (
        <>
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Program / Branch *</label>
                <select
                  value={programId}
                  onChange={(e) => {
                    setProgramId(e.target.value)
                    setPreview(null)
                    setSelectedRuleId('AUTO')
                  }}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                >
                  <option value="">Select Program...</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name} ({p.program_level})
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

              <div className="md:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">Progression Rule</label>
                <select
                  value={selectedRuleId}
                  onChange={(e) => setSelectedRuleId(e.target.value)}
                  className="w-full rounded border border-indigo-300 bg-indigo-50/40 px-2.5 py-1.5 font-medium text-indigo-950"
                >
                  <option value="AUTO">
                    Auto-Match Configured Rule ({selectedProgram?.program_level ?? 'UG'} Sem {fromPeriod?.sequence_number ?? '?'} → {toPeriod?.sequence_number ?? '?'})
                  </option>
                  {matchingRulesForTransition.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.rule_name}
                    </option>
                  ))}
                </select>
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
                {previewMutation.isPending ? 'Evaluating Latest Results...' : 'Run Result-Based Eligibility Preview'}
              </button>
            </div>
          </div>

          {/* Preview Table */}
          {preview && (
            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
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
                    {preview.rule_name}
                  </span>
                  <span className="text-slate-700 font-semibold">
                    {preview.total_students} Active ·{' '}
                    <span className="text-emerald-700">{preview.eligible_count} Eligible</span> ·{' '}
                    <span className="text-red-600">{preview.detained_count} Detained (NFT)</span>
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
                            `Promote ${totalSelected} student(s) (${overrideIds.length} via executive override) to Sem ${preview.to_sem}?`
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
                      <th className="px-3 py-2 text-center">Backlogs (Failed Cr)</th>
                      <th className="px-3 py-2 text-center">Credits Earned</th>
                      <th className="px-3 py-2 text-center">CGPA</th>
                      <th className="px-3 py-2">Progression Decision</th>
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
                            <td className="px-3 py-2 text-center font-mono">
                              <span className={cn('font-bold', s.active_backlogs > 0 ? 'text-red-600' : 'text-emerald-700')}>
                                {s.active_backlogs}
                              </span>
                              <span className="text-slate-400"> ({s.failed_credits} Cr)</span>
                            </td>
                            <td className="px-3 py-2 text-center font-mono">
                              {s.credits_earned} / {s.credits_attempted} ({s.credits_pct}%)
                            </td>
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
                                  <ShieldAlert className="h-3 w-3" /> {isPicked ? 'OVERRIDE' : 'DETAINED (NFT)'}
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
        </>
      )}
    </div>
  )
}
