import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Edit2, Trash2, X, Check } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle, ExamCycleStatus, ExamCycleType } from '@/types/exams'
import { cn } from '@/utils/cn'

const CYCLE_TYPES: ExamCycleType[] = ['REGULAR', 'ARREAR', 'SUPPLEMENTARY', 'SUMMER', 'ODE', 'MAKEUP']
const CYCLE_STATUSES: ExamCycleStatus[] = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'LOCKED',
  'IN_PROGRESS',
  'COMPLETED',
  'ARCHIVED',
]

const STATUS_BADGES: Record<ExamCycleStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  REGISTRATION_OPEN: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  LOCKED: 'bg-amber-50 text-amber-700 border border-amber-200',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  COMPLETED: 'bg-blue-50 text-blue-700 border border-blue-200',
  ARCHIVED: 'bg-slate-200 text-slate-600',
}

interface Props {
  institutionId: string
  cycles: ExamCycle[]
  canManage: boolean
}

interface CycleFormState {
  code: string
  name: string
  academic_year: string
  cycle_type: ExamCycleType
  status: ExamCycleStatus
  is_default_active: boolean
  registration_starts_at: string
  registration_ends_at: string
  late_fee_starts_at: string
  exam_starts_on: string
  exam_ends_on: string
}

const emptyForm = (): CycleFormState => ({
  code: '',
  name: '',
  academic_year: '2026-27',
  cycle_type: 'REGULAR',
  status: 'DRAFT',
  is_default_active: false,
  registration_starts_at: '',
  registration_ends_at: '',
  late_fee_starts_at: '',
  exam_starts_on: '',
  exam_ends_on: '',
})

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

export function ExamCyclesTab({ institutionId, cycles, canManage }: Props) {
  const queryClient = useQueryClient()
  const { activeExamCycleId, setActiveExamCycle, session } = useAppStore()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CycleFormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const code = form.code.trim().toUpperCase()
      const name = form.name.trim()
      const academicYear = form.academic_year.trim()
      if (!code || !name || !academicYear) {
        throw new Error('Cycle code, name, and academic year are required.')
      }

      if (form.is_default_active) {
        const { error: clearErr } = await supabase
          .from('exam_cycles')
          .update({ is_default_active: false, updated_by: session?.user.id ?? null })
          .eq('institution_id', institutionId)
          .eq('is_default_active', true)
          .is('deleted_at', null)
        if (clearErr) throw clearErr
      }

      const payload = {
        institution_id: institutionId,
        code,
        name,
        academic_year: academicYear,
        cycle_type: form.cycle_type,
        status: form.status,
        is_default_active: form.is_default_active,
        registration_starts_at: form.registration_starts_at
          ? new Date(`${form.registration_starts_at}T00:00:00+05:30`).toISOString()
          : null,
        registration_ends_at: form.registration_ends_at
          ? new Date(`${form.registration_ends_at}T23:59:59+05:30`).toISOString()
          : null,
        late_fee_starts_at: form.late_fee_starts_at
          ? new Date(`${form.late_fee_starts_at}T00:00:00+05:30`).toISOString()
          : null,
        exam_starts_on: form.exam_starts_on || null,
        exam_ends_on: form.exam_ends_on || null,
        updated_by: session?.user.id ?? null,
      }

      if (editingId) {
        const { data, error } = await supabase
          .from('exam_cycles')
          .update(payload)
          .eq('id', editingId)
          .select('id')
          .single()
        if (error) throw error
        return data.id as string
      }

      const { data, error } = await supabase
        .from('exam_cycles')
        .insert({ ...payload, created_by: session?.user.id ?? null })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (cycleId) => {
      queryClient.invalidateQueries({ queryKey: ['exam_cycles', institutionId] })
      if (form.is_default_active || !activeExamCycleId) {
        setActiveExamCycle(cycleId)
      }
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
      setFormError(null)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save exam cycle')
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: async (cycleId: string) => {
      const { error: clearErr } = await supabase
        .from('exam_cycles')
        .update({ is_default_active: false, updated_by: session?.user.id ?? null })
        .eq('institution_id', institutionId)
        .eq('is_default_active', true)
        .is('deleted_at', null)
      if (clearErr) throw clearErr

      const { error } = await supabase
        .from('exam_cycles')
        .update({ is_default_active: true, updated_by: session?.user.id ?? null })
        .eq('id', cycleId)
      if (error) throw error
      return cycleId
    },
    onSuccess: (cycleId) => {
      queryClient.invalidateQueries({ queryKey: ['exam_cycles', institutionId] })
      setActiveExamCycle(cycleId)
    },
  })

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ExamCycleStatus }) => {
      const { error } = await supabase
        .from('exam_cycles')
        .update({ status, updated_by: session?.user.id ?? null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_cycles', institutionId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (cycleId: string) => {
      const { error } = await supabase
        .from('exam_cycles')
        .update({ deleted_at: new Date().toISOString(), is_default_active: false })
        .eq('id', cycleId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_cycles', institutionId] })
    },
  })

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm(), is_default_active: cycles.length === 0 })
    setFormError(null)
    setShowForm(true)
  }

  const openEdit = (cycle: ExamCycle) => {
    setEditingId(cycle.id)
    setForm({
      code: cycle.code,
      name: cycle.name,
      academic_year: cycle.academic_year,
      cycle_type: cycle.cycle_type,
      status: cycle.status,
      is_default_active: cycle.is_default_active,
      registration_starts_at: toDateInput(cycle.registration_starts_at),
      registration_ends_at: toDateInput(cycle.registration_ends_at),
      late_fee_starts_at: toDateInput(cycle.late_fee_starts_at),
      exam_starts_on: cycle.exam_starts_on ?? '',
      exam_ends_on: cycle.exam_ends_on ?? '',
    })
    setFormError(null)
    setShowForm(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Examination Cycles</h2>
          <p className="text-xs text-slate-500">
            Manage Regular, Arrear, Summer, and On-Demand (ODE) sessions. The default active cycle drives the global
            switchboard.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            New Exam Cycle
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-lg border border-indigo-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {editingId ? 'Edit Exam Cycle' : 'Create Exam Cycle'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="p-1 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {formError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cycle Code *</label>
              <input
                type="text"
                placeholder="e.g. DEC2026_REG or NOV2026_ODE"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Cycle Name *</label>
              <input
                type="text"
                placeholder="e.g. Odd Semester SEE — December 2026"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Academic Year *</label>
              <input
                type="text"
                placeholder="2026-27"
                value={form.academic_year}
                onChange={(e) => setForm({ ...form, academic_year: e.target.value })}
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
              <label className="block text-xs font-medium text-slate-700 mb-1">Workflow Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ExamCycleStatus })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              >
                {CYCLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Registration Opens</label>
              <input
                type="date"
                value={form.registration_starts_at}
                onChange={(e) => setForm({ ...form, registration_starts_at: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Late Fee Starts</label>
              <input
                type="date"
                value={form.late_fee_starts_at}
                onChange={(e) => setForm({ ...form, late_fee_starts_at: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Registration Closes</label>
              <input
                type="date"
                value={form.registration_ends_at}
                onChange={(e) => setForm({ ...form, registration_ends_at: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Exam Start Date</label>
              <input
                type="date"
                value={form.exam_starts_on}
                onChange={(e) => setForm({ ...form, exam_starts_on: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Exam End Date</label>
              <input
                type="date"
                value={form.exam_ends_on}
                onChange={(e) => setForm({ ...form, exam_ends_on: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={form.is_default_active}
                  onChange={(e) => setForm({ ...form, is_default_active: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Set as Default Active Cycle
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
              {saveMutation.isPending ? 'Saving...' : 'Save Exam Cycle'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Cycle</th>
                <th className="px-4 py-2.5 font-semibold">Type / AY</th>
                <th className="px-4 py-2.5 font-semibold">Registration Window</th>
                <th className="px-4 py-2.5 font-semibold">Exam Dates</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cycles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No exam cycles configured yet. Create your first Regular, Arrear, Summer, or ODE cycle above.
                  </td>
                </tr>
              ) : (
                cycles.map((cycle) => {
                  const isSelected = cycle.id === activeExamCycleId
                  return (
                    <tr
                      key={cycle.id}
                      className={cn('hover:bg-slate-50', isSelected && 'bg-indigo-50/40')}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveExamCycle(cycle.id)}
                            className="font-semibold text-slate-900 hover:text-indigo-600 text-left"
                          >
                            {cycle.code}
                          </button>
                          {cycle.is_default_active && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                              Default
                            </span>
                          )}
                          {isSelected && (
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                              Selected
                            </span>
                          )}
                        </div>
                        <p className="text-slate-500 mt-0.5">{cycle.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                          {cycle.cycle_type}
                        </span>
                        <p className="text-slate-500 mt-1">{cycle.academic_year}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {cycle.registration_starts_at || cycle.registration_ends_at ? (
                          <span>
                            {toDateInput(cycle.registration_starts_at) || '—'} to{' '}
                            {toDateInput(cycle.registration_ends_at) || '—'}
                          </span>
                        ) : (
                          <span className="text-slate-400">Not scheduled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {cycle.exam_starts_on || cycle.exam_ends_on ? (
                          <span>
                            {cycle.exam_starts_on || '—'} to {cycle.exam_ends_on || '—'}
                          </span>
                        ) : (
                          <span className="text-slate-400">TBD</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {canManage ? (
                          <select
                            value={cycle.status}
                            onChange={(e) =>
                              statusMutation.mutate({
                                id: cycle.id,
                                status: e.target.value as ExamCycleStatus,
                              })
                            }
                            className={cn(
                              'rounded-full px-2.5 py-1 text-[11px] font-medium focus:outline-none',
                              STATUS_BADGES[cycle.status]
                            )}
                          >
                            {CYCLE_STATUSES.map((s) => (
                              <option key={s} value={s} className="bg-white text-slate-800">
                                {s.replace('_', ' ')}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={cn(
                              'inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                              STATUS_BADGES[cycle.status]
                            )}
                          >
                            {cycle.status.replace('_', ' ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {canManage && !cycle.is_default_active && (
                            <button
                              type="button"
                              title="Set as Default Active Cycle"
                              onClick={() => setDefaultMutation.mutate(cycle.id)}
                              className="p-1.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                            >
                              <Star className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canManage && (
                            <>
                              <button
                                type="button"
                                title="Edit cycle"
                                onClick={() => openEdit(cycle)}
                                className="p-1.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Archive / Remove cycle"
                                onClick={() => {
                                  if (window.confirm(`Remove exam cycle ${cycle.code}?`)) {
                                    deleteMutation.mutate(cycle.id)
                                  }
                                }}
                                className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
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
