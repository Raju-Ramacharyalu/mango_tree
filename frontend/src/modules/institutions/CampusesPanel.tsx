import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Power, Star } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { Campus } from '@/types/institutions'

interface CampusesPanelProps {
  institutionId: string
  canManage: boolean
}

export function CampusesPanel({ institutionId, canManage }: CampusesPanelProps) {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [stateName, setStateName] = useState('')
  const [phone, setPhone] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: campuses = [], isLoading } = useQuery({
    queryKey: ['campuses', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campuses')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('is_primary', { ascending: false })
        .order('name')
      if (error) throw error
      return (data ?? []) as Campus[]
    },
  })

  const addCampusMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!code.trim() || !name.trim()) throw new Error('Campus code and name are required.')
      const { error } = await supabase.from('campuses').insert({
        institution_id: institutionId,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        city: city.trim() || null,
        state: stateName.trim() || null,
        contact_phone: phone.trim() || null,
        is_primary: isPrimary,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setCode('')
      setName('')
      setCity('')
      setStateName('')
      setPhone('')
      setIsPrimary(false)
      queryClient.invalidateQueries({ queryKey: ['campuses', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add campus'),
  })

  const toggleCampusMutation = useMutation({
    mutationFn: async (campus: Campus) => {
      const { error } = await supabase
        .from('campuses')
        .update({ is_active: !campus.is_active })
        .eq('id', campus.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campuses', institutionId] }),
  })

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Add Campus</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code (e.g., NORTH)"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm uppercase"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campus Name"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm sm:col-span-2"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
            <input
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
              placeholder="State"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Contact Phone"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="rounded border-slate-300"
              />
              Primary campus
            </label>
            <button
              type="button"
              onClick={() => addCampusMutation.mutate()}
              disabled={addCampusMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Campus
            </button>
          </div>
          {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-slate-500">Loading campuses...</p>
      ) : campuses.length === 0 ? (
        <p className="text-xs text-slate-500">No campuses configured for this institution yet.</p>
      ) : (
        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
          {campuses.map((c) => (
            <div key={c.id} className="p-3 flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-700">{c.code}</span>
                    <span className="text-sm font-medium text-slate-900">{c.name}</span>
                    {c.is_primary && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[11px] font-medium">
                        <Star className="h-3 w-3" /> Primary
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {[c.city, c.state, c.contact_phone].filter(Boolean).join(' · ') || 'No location details'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    c.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {c.is_active ? 'Active' : 'Inactive'}
                </span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => toggleCampusMutation.mutate(c)}
                    className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                    title={c.is_active ? 'Deactivate Campus' : 'Activate Campus'}
                  >
                    <Power className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
