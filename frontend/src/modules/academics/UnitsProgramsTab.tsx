import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Plus, Power, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type {
  AcademicUnit,
  AcademicUnitType,
  Program,
  ProgramLevel,
  ProgramSpecialization,
  ProgramVersion,
} from '@/types/academics'

const UNIT_TYPES: AcademicUnitType[] = ['DEPARTMENT', 'SCHOOL', 'FACULTY', 'BRANCH', 'CENTRE', 'DIVISION']
const PROGRAM_LEVELS: ProgramLevel[] = ['UG', 'PG', 'DIPLOMA', 'INTEGRATED', 'DOCTORAL', 'CERTIFICATE', 'OTHER']

function getSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function UnitsProgramsTab({ institutionId, canManage }: { institutionId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [unitCode, setUnitCode] = useState('')
  const [unitName, setUnitName] = useState('')
  const [unitType, setUnitType] = useState<AcademicUnitType>('DEPARTMENT')

  const [progCode, setProgCode] = useState('')
  const [progName, setProgName] = useState('')
  const [progQual, setProgQual] = useState('B.E.')
  const [progLevel, setProgLevel] = useState<ProgramLevel>('UG')
  const [progDuration, setProgDuration] = useState(4)
  const [progUnitId, setProgUnitId] = useState('')

  const [detailProgram, setDetailProgram] = useState<Program | null>(null)
  const [specCode, setSpecCode] = useState('')
  const [specName, setSpecName] = useState('')
  const [verCode, setVerCode] = useState('')
  const [verName, setVerName] = useState('')
  const [verFrom, setVerFrom] = useState('')

  const { data: units = [] } = useQuery({
    queryKey: ['academic-units', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_units')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('code')
      if (error) throw error
      return (data ?? []) as AcademicUnit[]
    },
  })

  const { data: programs = [] } = useQuery({
    queryKey: ['programs', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('programs')
        .select('*, academic_units(id, code, name)')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('code')
      if (error) throw error
      return (data ?? []) as unknown as Program[]
    },
  })

  const { data: specializations = [] } = useQuery({
    queryKey: ['program-specializations', detailProgram?.id],
    enabled: Boolean(detailProgram?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('program_specializations')
        .select('*')
        .eq('program_id', detailProgram!.id)
        .order('code')
      if (error) throw error
      return (data ?? []) as ProgramSpecialization[]
    },
  })

  const { data: versions = [] } = useQuery({
    queryKey: ['program-versions', detailProgram?.id],
    enabled: Boolean(detailProgram?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('program_versions')
        .select('*')
        .eq('program_id', detailProgram!.id)
        .order('version_code')
      if (error) throw error
      return (data ?? []) as ProgramVersion[]
    },
  })

  const addUnitMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!unitCode.trim() || !unitName.trim()) throw new Error('Unit code and name are required.')
      const { error } = await supabase.from('academic_units').insert({
        institution_id: institutionId,
        code: unitCode.trim().toUpperCase(),
        name: unitName.trim(),
        unit_type: unitType,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setUnitCode('')
      setUnitName('')
      queryClient.invalidateQueries({ queryKey: ['academic-units', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create academic unit'),
  })

  const toggleUnitMutation = useMutation({
    mutationFn: async (u: AcademicUnit) => {
      const { error } = await supabase.from('academic_units').update({ is_active: !u.is_active }).eq('id', u.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['academic-units', institutionId] }),
  })

  const addProgramMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!progCode.trim() || !progName.trim() || !progQual.trim()) {
        throw new Error('Program code, name, and qualification are required.')
      }
      const { data: created, error } = await supabase
        .from('programs')
        .insert({
          institution_id: institutionId,
          academic_unit_id: progUnitId || null,
          code: progCode.trim().toUpperCase(),
          name: progName.trim(),
          qualification: progQual.trim(),
          program_level: progLevel,
          duration_years: progDuration,
        })
        .select('id')
        .single()
      if (error) throw error

      await supabase.from('program_specializations').insert({
        institution_id: institutionId,
        program_id: created.id,
        code: 'GENERAL',
        name: 'General Track',
        is_default: true,
      })
    },
    onSuccess: () => {
      setProgCode('')
      setProgName('')
      queryClient.invalidateQueries({ queryKey: ['programs', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create program'),
  })

  const toggleProgramMutation = useMutation({
    mutationFn: async (p: Program) => {
      const { error } = await supabase.from('programs').update({ is_active: !p.is_active }).eq('id', p.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['programs', institutionId] }),
  })

  const addSpecMutation = useMutation({
    mutationFn: async () => {
      if (!detailProgram || !specCode.trim() || !specName.trim()) return
      const { error } = await supabase.from('program_specializations').insert({
        institution_id: institutionId,
        program_id: detailProgram.id,
        code: specCode.trim().toUpperCase().replace(/\s+/g, '_'),
        name: specName.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      setSpecCode('')
      setSpecName('')
      queryClient.invalidateQueries({ queryKey: ['program-specializations', detailProgram?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add specialization'),
  })

  const addVersionMutation = useMutation({
    mutationFn: async () => {
      if (!detailProgram || !verCode.trim() || !verName.trim()) return
      const { error } = await supabase.from('program_versions').insert({
        institution_id: institutionId,
        program_id: detailProgram.id,
        version_code: verCode.trim().toUpperCase(),
        name: verName.trim(),
        effective_from_year: verFrom.trim() ? Number(verFrom) : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setVerCode('')
      setVerName('')
      setVerFrom('')
      queryClient.invalidateQueries({ queryKey: ['program-versions', detailProgram?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add program version'),
  })

  return (
    <div className="space-y-6">
      {errorMsg && <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700">{errorMsg}</div>}

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Academic Units (Schools / Departments / Branches)</h2>
        {canManage && (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <select
              value={unitType}
              onChange={(e) => setUnitType(e.target.value as AcademicUnitType)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={unitCode}
              onChange={(e) => setUnitCode(e.target.value)}
              placeholder="Code (e.g., CSE, MAT)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
            />
            <input
              value={unitName}
              onChange={(e) => setUnitName(e.target.value)}
              placeholder="Unit Name (e.g., Computer Science & Engg)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
            />
            <button
              type="button"
              onClick={() => addUnitMutation.mutate()}
              disabled={addUnitMutation.isPending}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> Add Unit
            </button>
          </div>
        )}

        <div className="overflow-x-auto border border-slate-200 rounded-md">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Status</th>
                {canManage && <th className="px-4 py-2.5 text-right">Toggle</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-slate-500">
                    No academic units configured yet.
                  </td>
                </tr>
              ) : (
                units.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold">{u.code}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{u.name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{u.unit_type}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleUnitMutation.mutate(u)}
                          className="p-1 rounded text-slate-500 hover:bg-slate-100"
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Academic Programs</h2>
        {canManage && (
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <input
              value={progCode}
              onChange={(e) => setProgCode(e.target.value)}
              placeholder="Code (CS, MBA)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
            />
            <input
              value={progName}
              onChange={(e) => setProgName(e.target.value)}
              placeholder="Program Title"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
            />
            <input
              value={progQual}
              onChange={(e) => setProgQual(e.target.value)}
              placeholder="Qualification (B.E.)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={progLevel}
              onChange={(e) => setProgLevel(e.target.value as ProgramLevel)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {PROGRAM_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.5"
              value={progDuration}
              onChange={(e) => setProgDuration(Number(e.target.value) || 4)}
              placeholder="Years"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={progUnitId}
              onChange={(e) => setProgUnitId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm sm:col-span-4"
            >
              <option value="">Parent Academic Unit (optional)</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => addProgramMutation.mutate()}
              disabled={addProgramMutation.isPending}
              className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> Add Program
            </button>
          </div>
        )}

        <div className="overflow-x-auto border border-slate-200 rounded-md">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Program</th>
                <th className="px-4 py-2.5">Level / Duration</th>
                <th className="px-4 py-2.5">Academic Unit</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {programs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-500">
                    No programs added yet. Add programs manually or import your legacy branches in M6.
                  </td>
                </tr>
              ) : (
                programs.map((p) => {
                  const unit = getSingle(p.academic_units)
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold">{p.code}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.qualification}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {p.program_level} · {p.duration_years} yrs
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{unit?.code ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => setDetailProgram(p)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-xs text-slate-700 hover:bg-slate-100"
                        >
                          <Layers className="h-3.5 w-3.5" /> Tracks / Versions
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => toggleProgramMutation.mutate(p)}
                            className="p-1 rounded text-slate-500 hover:bg-slate-100"
                          >
                            <Power className="h-4 w-4" />
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

      {detailProgram && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-3xl max-h-[88vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {detailProgram.code} — {detailProgram.name}
                </h3>
                <p className="text-xs text-slate-500">Manage Specialization Tracks and Program Versions</p>
              </div>
              <button type="button" onClick={() => setDetailProgram(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-900">Specializations ({specializations.length})</h4>
                {canManage && (
                  <div className="space-y-2 bg-slate-50 p-3 rounded border border-slate-200">
                    <input
                      value={specCode}
                      onChange={(e) => setSpecCode(e.target.value)}
                      placeholder="Code (e.g., FINANCE, HR)"
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs uppercase"
                    />
                    <input
                      value={specName}
                      onChange={(e) => setSpecName(e.target.value)}
                      placeholder="Track Name"
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => addSpecMutation.mutate()}
                      className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium"
                    >
                      Add Specialization
                    </button>
                  </div>
                )}
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded text-xs">
                  {specializations.map((s) => (
                    <li key={s.id} className="px-3 py-2 flex justify-between">
                      <span className="font-mono font-semibold">{s.code}</span>
                      <span className="text-slate-600">{s.name}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-slate-900">Program Versions ({versions.length})</h4>
                {canManage && (
                  <div className="space-y-2 bg-slate-50 p-3 rounded border border-slate-200">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={verCode}
                        onChange={(e) => setVerCode(e.target.value)}
                        placeholder="Version (R2025)"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs uppercase"
                      />
                      <input
                        type="number"
                        value={verFrom}
                        onChange={(e) => setVerFrom(e.target.value)}
                        placeholder="From Year (2025)"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <input
                      value={verName}
                      onChange={(e) => setVerName(e.target.value)}
                      placeholder="Version Name (e.g., 2025 Autonomous Regulations)"
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => addVersionMutation.mutate()}
                      className="px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium"
                    >
                      Add Version
                    </button>
                  </div>
                )}
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded text-xs">
                  {versions.length === 0 ? (
                    <li className="px-3 py-3 text-slate-500">No versions added yet.</li>
                  ) : (
                    versions.map((v) => (
                      <li key={v.id} className="px-3 py-2 flex justify-between">
                        <span className="font-mono font-semibold">{v.version_code}</span>
                        <span className="text-slate-600">
                          {v.name} {v.effective_from_year ? `(${v.effective_from_year})` : ''}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
