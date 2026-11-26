import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type {
  AcademicBatch,
  AcademicPeriod,
  AcademicPeriodType,
  AcademicSection,
  Program,
} from '@/types/academics'

function getSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function PeriodsBatchesTab({ institutionId, canManage }: { institutionId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [ptCode, setPtCode] = useState('')
  const [ptName, setPtName] = useState('')
  const [ptPerYear, setPtPerYear] = useState(2)

  const [pTypeId, setPTypeId] = useState('')
  const [pCode, setPCode] = useState('')
  const [pName, setPName] = useState('')
  const [pSeq, setPSeq] = useState(1)
  const [pGroup, setPGroup] = useState('')

  const [bProgramId, setBProgramId] = useState('')
  const [bCode, setBCode] = useState('')
  const [bName, setBName] = useState('')
  const [bAdmYear, setBAdmYear] = useState(2026)
  const [bScheme, setBScheme] = useState('25')

  const [sProgramId, setSProgramId] = useState('')
  const [sPeriodId, setSPeriodId] = useState('')
  const [sAy, setSAy] = useState('2026-27')
  const [sName, setSName] = useState('A')
  const [sCap, setSCap] = useState(60)

  const { data: periodTypes = [] } = useQuery({
    queryKey: ['academic-period-types', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_period_types')
        .select('*')
        .eq('institution_id', institutionId)
        .order('code')
      if (error) throw error
      return (data ?? []) as AcademicPeriodType[]
    },
  })

  const { data: periods = [] } = useQuery({
    queryKey: ['academic-periods', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_periods')
        .select('*, academic_period_types(id, code, name)')
        .eq('institution_id', institutionId)
        .order('sequence_number')
      if (error) throw error
      return (data ?? []) as unknown as AcademicPeriod[]
    },
  })

  const { data: programs = [] } = useQuery({
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

  const { data: batches = [] } = useQuery({
    queryKey: ['academic-batches', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_batches')
        .select('*, programs(id, code, name)')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('admission_year', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AcademicBatch[]
    },
  })

  const { data: sections = [] } = useQuery({
    queryKey: ['academic-sections', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('academic_sections')
        .select('*, programs(id, code, name), academic_periods(id, code, name)')
        .eq('institution_id', institutionId)
        .order('academic_year', { ascending: false })
        .order('section_name')
      if (error) throw error
      return (data ?? []) as unknown as AcademicSection[]
    },
  })

  const addPeriodTypeMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!ptCode.trim() || !ptName.trim()) throw new Error('Period type code and name are required.')
      const { error } = await supabase.from('academic_period_types').insert({
        institution_id: institutionId,
        code: ptCode.trim().toUpperCase(),
        name: ptName.trim(),
        periods_per_year: ptPerYear,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setPtCode('')
      setPtName('')
      queryClient.invalidateQueries({ queryKey: ['academic-period-types', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add period type'),
  })

  const addPeriodMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      const targetType = pTypeId || periodTypes[0]?.id
      if (!targetType || !pCode.trim() || !pName.trim()) {
        throw new Error('Period type, code, and name are required.')
      }
      const { error } = await supabase.from('academic_periods').insert({
        institution_id: institutionId,
        period_type_id: targetType,
        code: pCode.trim().toUpperCase(),
        name: pName.trim(),
        sequence_number: pSeq,
        term_group: pGroup.trim().toUpperCase() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setPCode('')
      setPName('')
      setPSeq((prev) => prev + 1)
      queryClient.invalidateQueries({ queryKey: ['academic-periods', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add academic period'),
  })

  const addBatchMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!bProgramId || !bCode.trim() || !bName.trim()) throw new Error('Program, batch code, and name are required.')
      const { error } = await supabase.from('academic_batches').insert({
        institution_id: institutionId,
        program_id: bProgramId,
        code: bCode.trim().toUpperCase(),
        name: bName.trim(),
        admission_year: bAdmYear,
        scheme_batch: bScheme.trim() ? Number(bScheme) : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setBCode('')
      setBName('')
      queryClient.invalidateQueries({ queryKey: ['academic-batches', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add batch'),
  })

  const addSectionMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!sProgramId || !sPeriodId || !sAy.trim() || !sName.trim()) {
        throw new Error('Program, academic period, academic year, and section name are required.')
      }
      const { error } = await supabase.from('academic_sections').insert({
        institution_id: institutionId,
        program_id: sProgramId,
        academic_period_id: sPeriodId,
        academic_year: sAy.trim(),
        section_name: sName.trim().toUpperCase(),
        max_capacity: sCap,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-sections', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add section'),
  })

  return (
    <div className="space-y-6">
      {errorMsg && <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700">{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Academic Period Types (Semester / Annual / Trimester)</h2>
          {canManage && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input
                value={ptCode}
                onChange={(e) => setPtCode(e.target.value)}
                placeholder="Code (QUARTER)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs uppercase"
              />
              <input
                value={ptName}
                onChange={(e) => setPtName(e.target.value)}
                placeholder="Name"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                type="number"
                min={1}
                max={12}
                value={ptPerYear}
                onChange={(e) => setPtPerYear(Number(e.target.value) || 1)}
                placeholder="Per Year"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => addPeriodTypeMutation.mutate()}
                className="inline-flex items-center justify-center gap-1 rounded bg-indigo-600 text-white text-xs font-medium px-3 py-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          )}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded text-xs">
            {periodTypes.map((pt) => (
              <div key={pt.id} className="px-3 py-2 flex items-center justify-between">
                <div>
                  <span className="font-mono font-semibold text-slate-800">{pt.code}</span>
                  <span className="text-slate-600 ml-2">{pt.name}</span>
                </div>
                <span className="text-slate-500">{pt.periods_per_year} / year</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Academic Periods ({periods.length})</h2>
          {canManage && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select
                value={pTypeId || periodTypes[0]?.id || ''}
                onChange={(e) => setPTypeId(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                {periodTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name}
                  </option>
                ))}
              </select>
              <input
                value={pCode}
                onChange={(e) => setPCode(e.target.value)}
                placeholder="Code (YEAR_1)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs uppercase"
              />
              <input
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="Name (Year 1)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                type="number"
                min={1}
                value={pSeq}
                onChange={(e) => setPSeq(Number(e.target.value) || 1)}
                placeholder="Seq #"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                value={pGroup}
                onChange={(e) => setPGroup(e.target.value)}
                placeholder="Term (ODD/EVEN/ANNUAL)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs uppercase"
              />
              <button
                type="button"
                onClick={() => addPeriodMutation.mutate()}
                className="inline-flex items-center justify-center gap-1 rounded bg-indigo-600 text-white text-xs font-medium px-3 py-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Add Period
              </button>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded text-xs">
            {periods.map((p) => {
              const pt = getSingle(p.academic_period_types)
              return (
                <div key={p.id} className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <span className="font-mono font-semibold text-slate-800">{p.code}</span>
                    <span className="text-slate-700 ml-2">{p.name}</span>
                  </div>
                  <span className="text-slate-500">
                    {pt?.code} · #{p.sequence_number} {p.term_group ? `(${p.term_group})` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Academic Batches ({batches.length})</h2>
          {canManage && (
            <div className="grid grid-cols-2 gap-2">
              <select
                value={bProgramId}
                onChange={(e) => setBProgramId(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs col-span-2"
              >
                <option value="">Select Program...</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
              <input
                value={bCode}
                onChange={(e) => setBCode(e.target.value)}
                placeholder="Batch Code (CS-2026)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs uppercase"
              />
              <input
                value={bName}
                onChange={(e) => setBName(e.target.value)}
                placeholder="Batch Name (2026-2030)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                type="number"
                value={bAdmYear}
                onChange={(e) => setBAdmYear(Number(e.target.value) || 2026)}
                placeholder="Admission Year"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                value={bScheme}
                onChange={(e) => setBScheme(e.target.value)}
                placeholder="Scheme Batch (e.g., 25)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => addBatchMutation.mutate()}
                className="col-span-2 inline-flex items-center justify-center gap-1 rounded bg-indigo-600 text-white text-xs font-medium px-3 py-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Add Batch
              </button>
            </div>
          )}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded text-xs">
            {batches.length === 0 ? (
              <p className="p-3 text-slate-500">No batches configured yet.</p>
            ) : (
              batches.map((b) => (
                <div key={b.id} className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <span className="font-mono font-semibold">{b.code}</span>
                    <span className="text-slate-600 ml-2">{b.name}</span>
                  </div>
                  <span className="text-slate-500">
                    {getSingle(b.programs)?.code} · {b.admission_year}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Academic Sections ({sections.length})</h2>
          {canManage && (
            <div className="grid grid-cols-2 gap-2">
              <select
                value={sProgramId}
                onChange={(e) => setSProgramId(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Select Program...</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
              <select
                value={sPeriodId}
                onChange={(e) => setSPeriodId(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Select Period...</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                value={sAy}
                onChange={(e) => setSAy(e.target.value)}
                placeholder="Academic Year (2026-27)"
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={sName}
                  onChange={(e) => setSName(e.target.value)}
                  placeholder="Sec (A)"
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs uppercase"
                />
                <input
                  type="number"
                  value={sCap}
                  onChange={(e) => setSCap(Number(e.target.value) || 60)}
                  placeholder="Cap"
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={() => addSectionMutation.mutate()}
                className="col-span-2 inline-flex items-center justify-center gap-1 rounded bg-indigo-600 text-white text-xs font-medium px-3 py-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Add Section
              </button>
            </div>
          )}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded text-xs">
            {sections.length === 0 ? (
              <p className="p-3 text-slate-500">No sections configured yet.</p>
            ) : (
              sections.map((s) => (
                <div key={s.id} className="px-3 py-2 flex items-center justify-between">
                  <div>
                    <span className="font-mono font-semibold">
                      {getSingle(s.programs)?.code} · {getSingle(s.academic_periods)?.code} · Sec {s.section_name}
                    </span>
                  </div>
                  <span className="text-slate-500">
                    AY {s.academic_year} · Max {s.max_capacity}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
