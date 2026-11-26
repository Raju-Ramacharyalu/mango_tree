import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, X, Check, Receipt } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle, ExamCycleType, ExamFeeRule, ProgramLevel } from '@/types/exams'

const CYCLE_TYPES: ExamCycleType[] = ['REGULAR', 'ARREAR', 'SUPPLEMENTARY', 'SUMMER', 'ODE', 'MAKEUP']
const PROGRAM_LEVELS: ProgramLevel[] = ['DIPLOMA', 'UG', 'PG', 'INTEGRATED', 'DOCTORAL', 'CERTIFICATE', 'OTHER']

interface Props {
  institutionId: string
  cycles: ExamCycle[]
  canManage: boolean
}

interface FeeFormState {
  rule_name: string
  cycle_type: ExamCycleType
  exam_cycle_id: string
  program_level: string
  currency: string
  application_fee: string
  grade_card_fee: string
  first_attempt_subject_fee: string
  subsequent_attempt_subject_fee: string
  online_course_fee: string
  late_fee: string
  is_active: boolean
}

const emptyForm = (): FeeFormState => ({
  rule_name: '',
  cycle_type: 'REGULAR',
  exam_cycle_id: '',
  program_level: '',
  currency: 'INR',
  application_fee: '100',
  grade_card_fee: '300',
  first_attempt_subject_fee: '0',
  subsequent_attempt_subject_fee: '0',
  online_course_fee: '0',
  late_fee: '0',
  is_active: true,
})

const formatMoney = (amount: number, currency: string) =>
  `${currency === 'INR' ? '₹' : `${currency} `}${Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`

export function FeeRulesTab({ institutionId, cycles, canManage }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FeeFormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)

  const { data: rules = [], isLoading } = useQuery<ExamFeeRule[]>({
    queryKey: ['exam_fee_rules', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_fee_rules')
        .select('*')
        .eq('institution_id', institutionId)
        .order('cycle_type', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ExamFeeRule[]
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.rule_name.trim()) throw new Error('Rule name is required.')
      const payload = {
        institution_id: institutionId,
        rule_name: form.rule_name.trim(),
        cycle_type: form.cycle_type,
        exam_cycle_id: form.exam_cycle_id || null,
        program_level: (form.program_level || null) as ProgramLevel | null,
        currency: form.currency.trim().toUpperCase() || 'INR',
        application_fee: Number(form.application_fee) || 0,
        grade_card_fee: Number(form.grade_card_fee) || 0,
        first_attempt_subject_fee: Number(form.first_attempt_subject_fee) || 0,
        subsequent_attempt_subject_fee: Number(form.subsequent_attempt_subject_fee) || 0,
        online_course_fee: Number(form.online_course_fee) || 0,
        late_fee: Number(form.late_fee) || 0,
        is_active: form.is_active,
        updated_by: session?.user.id ?? null,
      }

      if (editingId) {
        const { error } = await supabase.from('exam_fee_rules').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('exam_fee_rules')
          .insert({ ...payload, created_by: session?.user.id ?? null })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_fee_rules', institutionId] })
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
      setFormError(null)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save fee rule')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const { error } = await supabase.from('exam_fee_rules').delete().eq('id', ruleId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_fee_rules', institutionId] })
    },
  })

  const applyOdePreset = () => {
    setForm((prev) => ({
      ...prev,
      rule_name: prev.rule_name || 'Standard ODE Fee Structure',
      cycle_type: 'ODE',
      currency: 'INR',
      application_fee: '100',
      grade_card_fee: '600',
      first_attempt_subject_fee: '6000',
      subsequent_attempt_subject_fee: '3000',
      online_course_fee: '0',
      late_fee: '0',
    }))
  }

  const openEdit = (rule: ExamFeeRule) => {
    setEditingId(rule.id)
    setForm({
      rule_name: rule.rule_name,
      cycle_type: rule.cycle_type,
      exam_cycle_id: rule.exam_cycle_id ?? '',
      program_level: rule.program_level ?? '',
      currency: rule.currency,
      application_fee: String(rule.application_fee),
      grade_card_fee: String(rule.grade_card_fee),
      first_attempt_subject_fee: String(rule.first_attempt_subject_fee),
      subsequent_attempt_subject_fee: String(rule.subsequent_attempt_subject_fee),
      online_course_fee: String(rule.online_course_fee),
      late_fee: String(rule.late_fee),
      is_active: rule.is_active,
    })
    setFormError(null)
    setShowForm(true)
  }

  const cycleMap = new Map(cycles.map((c) => [c.id, c.code]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Configurable Exam Fee Schedules</h2>
          <p className="text-xs text-slate-500">
            Define institution defaults or cycle-specific rules for application, grade card, attempt-tiered subject
            fees, and online course exemptions.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null)
              setForm(emptyForm())
              setFormError(null)
              setShowForm(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            New Fee Rule
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              {editingId ? 'Edit Fee Rule' : 'Create Fee Rule'}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={applyOdePreset}
                className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                <Receipt className="h-3.5 w-3.5" />
                Load ODE Preset (₹100 / ₹600 / ₹6,000 / ₹3,000)
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {formError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Rule Name *</label>
              <input
                type="text"
                placeholder="e.g. UG Regular Examination Fee"
                value={form.rule_name}
                onChange={(e) => setForm({ ...form, rule_name: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cycle Type</label>
              <select
                value={form.cycle_type}
                onChange={(e) => setForm({ ...form, cycle_type: e.target.value as ExamCycleType })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              >
                {CYCLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Specific Cycle (Optional)</label>
              <select
                value={form.exam_cycle_id}
                onChange={(e) => setForm({ ...form, exam_cycle_id: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              >
                <option value="">All {form.cycle_type} Cycles (Default)</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} ({c.cycle_type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Program Level</label>
              <select
                value={form.program_level}
                onChange={(e) => setForm({ ...form, program_level: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              >
                <option value="">All Levels</option>
                {PROGRAM_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Application Fee</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.application_fee}
                onChange={(e) => setForm({ ...form, application_fee: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Grade Card Fee</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.grade_card_fee}
                onChange={(e) => setForm({ ...form, grade_card_fee: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Late Fee</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.late_fee}
                onChange={(e) => setForm({ ...form, late_fee: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">1st Attempt / Subject</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.first_attempt_subject_fee}
                onChange={(e) => setForm({ ...form, first_attempt_subject_fee: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subsequent Attempt / Subject</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.subsequent_attempt_subject_fee}
                onChange={(e) => setForm({ ...form, subsequent_attempt_subject_fee: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">ONLINE Course Fee</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.online_course_fee}
                onChange={(e) => setForm({ ...form, online_course_fee: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Rule Active
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
              {saveMutation.isPending ? 'Saving...' : 'Save Fee Rule'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Rule / Scope</th>
                <th className="px-4 py-2.5 font-semibold">Application</th>
                <th className="px-4 py-2.5 font-semibold">Grade Card</th>
                <th className="px-4 py-2.5 font-semibold">1st Attempt</th>
                <th className="px-4 py-2.5 font-semibold">Subsequent</th>
                <th className="px-4 py-2.5 font-semibold">ONLINE / Late</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    Loading fee schedules...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No fee rules configured yet. Add a rule (or use the ODE preset) to enable automated fee calculations.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{rule.rule_name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                          {rule.cycle_type}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          {rule.exam_cycle_id ? `Cycle: ${cycleMap.get(rule.exam_cycle_id) ?? 'Linked'}` : 'All Cycles'}
                        </span>
                        {rule.program_level && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                            {rule.program_level}
                          </span>
                        )}
                        {!rule.is_active && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">Inactive</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {formatMoney(rule.application_fee, rule.currency)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {formatMoney(rule.grade_card_fee, rule.currency)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {formatMoney(rule.first_attempt_subject_fee, rule.currency)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {formatMoney(rule.subsequent_attempt_subject_fee, rule.currency)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span>Online: {formatMoney(rule.online_course_fee, rule.currency)}</span>
                      <span className="block text-[11px] text-slate-500">
                        Late: {formatMoney(rule.late_fee, rule.currency)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canManage && (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(rule)}
                            className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete fee rule "${rule.rule_name}"?`)) {
                                deleteMutation.mutate(rule.id)
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
