import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Power } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { InstitutionCategory } from '@/types/institutions'

export function InstitutionCategoriesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['institution-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_categories')
        .select('*')
        .order('sort_order')
        .order('name')
      if (error) throw error
      return (data ?? []) as InstitutionCategory[]
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      const cleanCode = code.trim().toUpperCase().replace(/\s+/g, '_')
      const cleanName = name.trim()
      if (!cleanCode || !cleanName) throw new Error('Category code and name are required.')
      const { error } = await supabase.from('institution_categories').insert({
        code: cleanCode,
        name: cleanName,
        description: description.trim() || null,
        sort_order: (categories.length + 1) * 10,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setCode('')
      setName('')
      setDescription('')
      queryClient.invalidateQueries({ queryKey: ['institution-categories'] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create category'),
  })

  const toggleMutation = useMutation({
    mutationFn: async (cat: InstitutionCategory) => {
      const { error } = await supabase
        .from('institution_categories')
        .update({ is_active: !cat.is_active })
        .eq('id', cat.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['institution-categories'] }),
  })

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Add Configurable Institution Category</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code (e.g., LAW)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Category Name (e.g., Law College)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
            />
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Add Category
            </button>
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-x-auto">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading categories...</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Category Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Toggle</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{cat.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{cat.name}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{cat.description ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        cat.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {cat.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleMutation.mutate(cat)}
                        className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                        title={cat.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
