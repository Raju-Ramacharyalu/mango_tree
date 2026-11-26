import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Power, Search, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { StaffProfileRecord } from '@/types/users'

interface StaffDirectoryTabProps {
  institutionId: string
  canManage: boolean
}

export function StaffDirectoryTab({ institutionId, canManage }: StaffDirectoryTabProps) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<StaffProfileRecord | null>(null)
  const [employeeCode, setEmployeeCode] = useState('')
  const [fullName, setFullName] = useState('')
  const [designation, setDesignation] = useState('Assistant Professor')
  const [email, setEmail] = useState('')
  const [deptLabel, setDeptLabel] = useState('')
  const [branchLabel, setBranchLabel] = useState('')
  const [isEvaluator, setIsEvaluator] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['staff-profiles', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as StaffProfileRecord[]
    },
  })

  const openCreate = () => {
    setEditing(null)
    setFormError(null)
    setEmployeeCode('')
    setFullName('')
    setDesignation('Assistant Professor')
    setEmail('')
    setDeptLabel('')
    setBranchLabel('')
    setIsEvaluator(false)
    setModalOpen(true)
  }

  const openEdit = (row: StaffProfileRecord) => {
    setEditing(row)
    setFormError(null)
    setEmployeeCode(row.employee_code)
    setFullName(row.full_name)
    setDesignation(row.designation)
    setEmail(row.email ?? '')
    setDeptLabel(row.department_label ?? '')
    setBranchLabel(row.branch_label ?? '')
    setIsEvaluator(row.is_evaluator)
    setModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      setFormError(null)
      if (!employeeCode.trim() || !fullName.trim() || !designation.trim()) {
        throw new Error('Employee code, full name, and designation are required.')
      }
      const payload = {
        institution_id: institutionId,
        employee_code: employeeCode.trim().toUpperCase(),
        full_name: fullName.trim(),
        designation: designation.trim(),
        email: email.trim().toLowerCase() || null,
        department_label: deptLabel.trim().toUpperCase() || null,
        branch_label: branchLabel.trim().toUpperCase() || null,
        is_evaluator: isEvaluator,
      }
      if (editing) {
        const { error } = await supabase.from('staff_profiles').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('staff_profiles').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-profiles', institutionId] })
      setModalOpen(false)
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Failed to save staff profile'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async (row: StaffProfileRecord) => {
      const { error } = await supabase
        .from('staff_profiles')
        .update({ is_active: !row.is_active })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-profiles', institutionId] }),
  })

  const filtered = staff.filter((s) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.employee_code.toLowerCase().includes(q) ||
      s.designation.toLowerCase().includes(q) ||
      (s.department_label ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search staff by ID, name, designation, or dept..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Staff Profile
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading staff directory...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No staff profiles recorded for this institution yet. Add manually or import via Data Management in M6.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Staff Code</th>
                  <th className="px-4 py-3">Name &amp; Email</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3">Dept / Branch</th>
                  <th className="px-4 py-3">Evaluator</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{s.employee_code}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{s.full_name}</p>
                      <p className="text-xs text-slate-500">{s.email ?? 'No email linked'}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{s.designation}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {[s.department_label, s.branch_label].filter(Boolean).join(' / ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {s.is_evaluator ? (
                        <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">Yes</span>
                      ) : (
                        <span className="text-slate-400">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                          title="Edit Staff Profile"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActiveMutation.mutate(s)}
                          className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                          title={s.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-lg">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Edit Staff Profile' : 'Add Staff Profile'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Staff / Faculty Code *</label>
                  <input
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    placeholder="e.g., CS2601"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Designation *</label>
                  <input
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g., Assistant Professor"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department Label</label>
                  <input
                    value={deptLabel}
                    onChange={(e) => setDeptLabel(e.target.value)}
                    placeholder="e.g., CSE"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Branch Code</label>
                  <input
                    value={branchLabel}
                    onChange={(e) => setBranchLabel(e.target.value)}
                    placeholder="e.g., CS"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={isEvaluator}
                  onChange={(e) => setIsEvaluator(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Eligible as Valuation / Exam Evaluator
              </label>

              {formError && <div className="p-3 rounded bg-red-50 text-xs text-red-700">{formError}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Staff Profile'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
