import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Power, Trash2 } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { InstitutionSummary } from '@/types/auth'
import type {
  AssessmentPattern,
  CourseCategory,
  GradingScale,
  IdentifierEntityType,
  IdentifierFormat,
} from '@/types/academics'

const ENTITY_TYPES: IdentifierEntityType[] = [
  'STUDENT_TEMP',
  'STUDENT_OFFICIAL',
  'STAFF_ID',
  'COURSE_CODE',
  'CUSTOM',
]

export function ConfigurationPage() {
  const queryClient = useQueryClient()
  const { context, activeInstitutionId, platformRoles, memberships } = useAppStore()
  const isPlatformAdmin = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')

  const [selectedPlatformInstId, setSelectedPlatformInstId] = useState('')
  const [activeTab, setActiveTab] = useState<'IDENTIFIERS' | 'CATEGORIES' | 'ASSESSMENTS' | 'GRADING'>('IDENTIFIERS')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [idEntityType, setIdEntityType] = useState<IdentifierEntityType>('STUDENT_OFFICIAL')
  const [idName, setIdName] = useState('')
  const [idPattern, setIdPattern] = useState('')
  const [idPrefix, setIdPrefix] = useState('')
  const [idPadding, setIdPadding] = useState(3)

  const [catCode, setCatCode] = useState('')
  const [catName, setCatName] = useState('')
  const [catCredit, setCatCredit] = useState(true)
  const [catElective, setCatElective] = useState(false)
  const [catOnline, setCatOnline] = useState(false)
  const [catCie, setCatCie] = useState(50)
  const [catSee, setCatSee] = useState(50)
  const [catTotal, setCatTotal] = useState(100)

  const [apCode, setApCode] = useState('')
  const [apName, setApName] = useState('')
  const [apInternal, setApInternal] = useState(50)
  const [apExternal, setApExternal] = useState(50)
  const [apTotal, setApTotal] = useState(100)
  const [apMinInt, setApMinInt] = useState('')
  const [apMinExt, setApMinExt] = useState('')
  const [apMinTot, setApMinTot] = useState('')

  const [gsCode, setGsCode] = useState('')
  const [gsName, setGsName] = useState('')
  const [selectedScaleId, setSelectedScaleId] = useState<string | null>(null)
  const [itemGradeCode, setItemGradeCode] = useState('')
  const [itemDesc, setItemDesc] = useState('')
  const [itemPoints, setItemPoints] = useState(10)
  const [itemMinPct, setItemMinPct] = useState('')
  const [itemMaxPct, setItemMaxPct] = useState('')
  const [itemIsPass, setItemIsPass] = useState(true)

  const { data: allInstitutions = [] } = useQuery({
    queryKey: ['institutions-min'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institutions')
        .select('id, code, name, short_name, status')
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as InstitutionSummary[]
    },
  })

  const targetInstitutionId =
    context === 'INSTITUTION'
      ? activeInstitutionId
      : selectedPlatformInstId || allInstitutions[0]?.id || activeInstitutionId

  const activeMembership = memberships.find((m) => m.institution_id === targetInstitutionId)
  const canManage =
    isPlatformAdmin ||
    (activeMembership?.roles ?? []).some((r) =>
      ['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER'].includes(r)
    )

  const { data: idFormats = [] } = useQuery({
    queryKey: ['identifier-formats', targetInstitutionId],
    enabled: Boolean(targetInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('identifier_formats')
        .select('*')
        .eq('institution_id', targetInstitutionId!)
        .order('entity_type')
      if (error) throw error
      return (data ?? []) as IdentifierFormat[]
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['course-categories', targetInstitutionId],
    enabled: Boolean(targetInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_categories')
        .select('*')
        .eq('institution_id', targetInstitutionId!)
        .order('sort_order')
        .order('code')
      if (error) throw error
      return (data ?? []) as CourseCategory[]
    },
  })

  const { data: patterns = [] } = useQuery({
    queryKey: ['assessment-patterns', targetInstitutionId],
    enabled: Boolean(targetInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assessment_patterns')
        .select('*')
        .eq('institution_id', targetInstitutionId!)
        .order('code')
      if (error) throw error
      return (data ?? []) as AssessmentPattern[]
    },
  })

  const { data: gradingScales = [] } = useQuery({
    queryKey: ['grading-scales', targetInstitutionId],
    enabled: Boolean(targetInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grading_scales')
        .select('*, grade_scale_items(*)')
        .eq('institution_id', targetInstitutionId!)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as GradingScale[]
    },
  })

  const activeScale = gradingScales.find((s) => s.id === selectedScaleId) ?? gradingScales[0] ?? null
  const activeScaleItems = [...(activeScale?.grade_scale_items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || b.grade_point - a.grade_point
  )

  const addIdentifierMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!targetInstitutionId) throw new Error('Select an institution.')
      if (!idName.trim() || !idPattern.trim()) throw new Error('Format name and pattern are required.')
      const { error } = await supabase.from('identifier_formats').insert({
        institution_id: targetInstitutionId,
        entity_type: idEntityType,
        name: idName.trim(),
        pattern: idPattern.trim(),
        prefix: idPrefix.trim() || null,
        sequence_padding: idPadding,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setIdName('')
      setIdPattern('')
      setIdPrefix('')
      queryClient.invalidateQueries({ queryKey: ['identifier-formats', targetInstitutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add identifier format'),
  })

  const toggleIdentifierMutation = useMutation({
    mutationFn: async (row: IdentifierFormat) => {
      const { error } = await supabase
        .from('identifier_formats')
        .update({ is_active: !row.is_active })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['identifier-formats', targetInstitutionId] }),
  })

  const addCategoryMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!targetInstitutionId) throw new Error('Select an institution.')
      if (!catCode.trim() || !catName.trim()) throw new Error('Category code and name are required.')
      const { error } = await supabase.from('course_categories').insert({
        institution_id: targetInstitutionId,
        code: catCode.trim().toUpperCase(),
        name: catName.trim(),
        is_credit_bearing: catCredit,
        is_elective: catElective,
        is_online: catOnline,
        default_max_cie: catOnline ? 0 : catCie,
        default_max_see: catOnline ? 0 : catSee,
        default_total_marks: catTotal > 0 ? catTotal : 100,
        sort_order: (categories.length + 1) * 10,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setCatCode('')
      setCatName('')
      setCatOnline(false)
      setCatElective(false)
      setCatCredit(true)
      setCatCie(50)
      setCatSee(50)
      setCatTotal(100)
      queryClient.invalidateQueries({ queryKey: ['course-categories', targetInstitutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add course category'),
  })

  const toggleCategoryMutation = useMutation({
    mutationFn: async (row: CourseCategory) => {
      const { error } = await supabase
        .from('course_categories')
        .update({ is_active: !row.is_active })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['course-categories', targetInstitutionId] }),
  })

  const addPatternMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!targetInstitutionId) throw new Error('Select an institution.')
      if (!apCode.trim() || !apName.trim()) throw new Error('Pattern code and name are required.')
      const { error } = await supabase.from('assessment_patterns').insert({
        institution_id: targetInstitutionId,
        code: apCode.trim().toUpperCase().replace(/\s+/g, '_'),
        name: apName.trim(),
        max_internal_marks: apInternal,
        max_external_marks: apExternal,
        total_marks: apTotal,
        min_internal_pass: apMinInt.trim() ? Number(apMinInt) : null,
        min_external_pass: apMinExt.trim() ? Number(apMinExt) : null,
        min_total_pass: apMinTot.trim() ? Number(apMinTot) : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setApCode('')
      setApName('')
      setApMinInt('')
      setApMinExt('')
      setApMinTot('')
      queryClient.invalidateQueries({ queryKey: ['assessment-patterns', targetInstitutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add assessment pattern'),
  })

  const togglePatternMutation = useMutation({
    mutationFn: async (row: AssessmentPattern) => {
      const { error } = await supabase
        .from('assessment_patterns')
        .update({ is_active: !row.is_active })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assessment-patterns', targetInstitutionId] }),
  })

  const addScaleMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!targetInstitutionId) throw new Error('Select an institution.')
      if (!gsCode.trim() || !gsName.trim()) throw new Error('Scale code and name are required.')
      const { data, error } = await supabase
        .from('grading_scales')
        .insert({
          institution_id: targetInstitutionId,
          code: gsCode.trim().toUpperCase().replace(/\s+/g, '_'),
          name: gsName.trim(),
          is_default: gradingScales.length === 0,
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (createdId) => {
      setGsCode('')
      setGsName('')
      setSelectedScaleId(createdId)
      queryClient.invalidateQueries({ queryKey: ['grading-scales', targetInstitutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create grading scale'),
  })

  const addGradeItemMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!targetInstitutionId || !activeScale) throw new Error('Select a grading scale first.')
      if (!itemGradeCode.trim() || !itemDesc.trim()) throw new Error('Grade code and description are required.')
      const { error } = await supabase.from('grade_scale_items').insert({
        institution_id: targetInstitutionId,
        grading_scale_id: activeScale.id,
        grade_code: itemGradeCode.trim().toUpperCase(),
        description: itemDesc.trim(),
        grade_point: itemPoints,
        min_percentage: itemMinPct.trim() ? Number(itemMinPct) : null,
        max_percentage: itemMaxPct.trim() ? Number(itemMaxPct) : null,
        is_pass: itemIsPass,
        sort_order: (activeScaleItems.length + 1) * 10,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setItemGradeCode('')
      setItemDesc('')
      setItemMinPct('')
      setItemMaxPct('')
      queryClient.invalidateQueries({ queryKey: ['grading-scales', targetInstitutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add grade row'),
  })

  const deleteGradeItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.from('grade_scale_items').delete().eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grading-scales', targetInstitutionId] }),
  })

  if (!targetInstitutionId) {
    return <div className="text-sm text-slate-500">Select an institution to configure operational settings.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Configuration</h1>
          <p className="text-sm text-slate-500">
            Configure institution-specific ID formats, course categories, assessment patterns, and grading scales.
          </p>
        </div>

        {context === 'PLATFORM' && allInstitutions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Institution Scope:</span>
            <select
              value={targetInstitutionId}
              onChange={(e) => setSelectedPlatformInstId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            >
              {allInstitutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.code} — {inst.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {[
          { id: 'IDENTIFIERS', label: `ID Formats (${idFormats.length})` },
          { id: 'CATEGORIES', label: `Course Categories (${categories.length})` },
          { id: 'ASSESSMENTS', label: `Assessment Patterns (${patterns.length})` },
          { id: 'GRADING', label: `Grading Scales (${gradingScales.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setErrorMsg(null)
              setActiveTab(t.id as typeof activeTab)
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === t.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {errorMsg && <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">{errorMsg}</div>}

      {activeTab === 'IDENTIFIERS' && (
        <div className="space-y-5">
          {canManage && (
            <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Add Identifier Format</h2>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <select
                  value={idEntityType}
                  onChange={(e) => setIdEntityType(e.target.value as IdentifierEntityType)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {ENTITY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  value={idName}
                  onChange={(e) => setIdName(e.target.value)}
                  placeholder="Format Name"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  value={idPattern}
                  onChange={(e) => setIdPattern(e.target.value)}
                  placeholder="Pattern e.g. 1AM{YY}{BRANCH}{SEQ:3}"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono sm:col-span-2"
                />
                <button
                  type="button"
                  onClick={() => addIdentifierMutation.mutate()}
                  disabled={addIdentifierMutation.isPending}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                >
                  <Plus className="h-4 w-4" /> Add Format
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  value={idPrefix}
                  onChange={(e) => setIdPrefix(e.target.value)}
                  placeholder="Prefix (optional, e.g., TMP-)"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                />
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  Sequence Padding:
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={idPadding}
                    onChange={(e) => setIdPadding(Number(e.target.value) || 3)}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Pattern</th>
                  <th className="px-4 py-3">Prefix / Pad</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Toggle</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {idFormats.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{f.entity_type}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{f.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-indigo-700">{f.pattern}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {f.prefix ?? 'None'} · {f.sequence_padding} digits
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          f.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {f.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleIdentifierMutation.mutate(f)}
                          className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
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
        </div>
      )}

      {activeTab === 'CATEGORIES' && (
        <div className="space-y-5">
          {canManage && (
            <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Add Course Category</h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input
                  value={catCode}
                  onChange={(e) => setCatCode(e.target.value)}
                  placeholder="Code (e.g., AUDIT)"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                />
                <input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="Category Name"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
                />
                <button
                  type="button"
                  onClick={() => addCategoryMutation.mutate()}
                  disabled={addCategoryMutation.isPending}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                >
                  <Plus className="h-4 w-4" /> Add Category
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={catCredit} onChange={(e) => setCatCredit(e.target.checked)} />
                  Credit-bearing
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={catElective} onChange={(e) => setCatElective(e.target.checked)} />
                  Elective
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={catOnline}
                    onChange={(e) => {
                      setCatOnline(e.target.checked)
                      if (e.target.checked) {
                        setCatCie(0)
                        setCatSee(0)
                        setCatTotal(100)
                      }
                    }}
                  />
                  Online (Auto sets CIE=0, SEE=0)
                </label>
                <div className="flex items-center gap-2 ml-auto">
                  <span>CIE:</span>
                  <input
                    type="number"
                    disabled={catOnline}
                    value={catCie}
                    onChange={(e) => setCatCie(Number(e.target.value))}
                    className="w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                  />
                  <span>SEE:</span>
                  <input
                    type="number"
                    disabled={catOnline}
                    value={catSee}
                    onChange={(e) => setCatSee(Number(e.target.value))}
                    className="w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100"
                  />
                  <span>Total:</span>
                  <input
                    type="number"
                    value={catTotal}
                    onChange={(e) => setCatTotal(Number(e.target.value))}
                    className="w-16 rounded border border-slate-300 px-2 py-1"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Flags</th>
                  <th className="px-4 py-3">Default CIE / SEE / Total</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Toggle</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{c.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                    <td className="px-4 py-3 text-xs space-x-1">
                      {c.is_credit_bearing && <span className="px-1.5 py-0.5 rounded bg-slate-100">Credit</span>}
                      {c.is_elective && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Elective</span>}
                      {c.is_online && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">Online</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {c.default_max_cie} / {c.default_max_see} / {c.default_total_marks}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {c.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => toggleCategoryMutation.mutate(c)}
                          className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
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
        </div>
      )}

      {activeTab === 'ASSESSMENTS' && (
        <div className="space-y-5">
          {canManage && (
            <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Add Assessment Pattern</h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input
                  value={apCode}
                  onChange={(e) => setApCode(e.target.value)}
                  placeholder="Code (e.g., ANNUAL_80_20)"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                />
                <input
                  value={apName}
                  onChange={(e) => setApName(e.target.value)}
                  placeholder="Pattern Name"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
                />
                <button
                  type="button"
                  onClick={() => addPatternMutation.mutate()}
                  disabled={addPatternMutation.isPending}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                >
                  <Plus className="h-4 w-4" /> Add Pattern
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-slate-600">Max Internal</span>
                  <input
                    type="number"
                    value={apInternal}
                    onChange={(e) => setApInternal(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Max External</span>
                  <input
                    type="number"
                    value={apExternal}
                    onChange={(e) => setApExternal(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Total Marks</span>
                  <input
                    type="number"
                    value={apTotal}
                    onChange={(e) => setApTotal(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Min Int Pass</span>
                  <input
                    type="number"
                    value={apMinInt}
                    onChange={(e) => setApMinInt(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Min Ext Pass</span>
                  <input
                    type="number"
                    value={apMinExt}
                    onChange={(e) => setApMinExt(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-600">Min Total Pass</span>
                  <input
                    type="number"
                    value={apMinTot}
                    onChange={(e) => setApMinTot(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Pattern Name</th>
                  <th className="px-4 py-3">Max (Int / Ext / Total)</th>
                  <th className="px-4 py-3">Pass Thresholds</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Toggle</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patterns.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{p.code}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {p.max_internal_marks} / {p.max_external_marks} / {p.total_marks}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {p.min_internal_pass ?? '—'} / {p.min_external_pass ?? '—'} / {p.min_total_pass ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => togglePatternMutation.mutate(p)}
                          className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
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
        </div>
      )}

      {activeTab === 'GRADING' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            {canManage && (
              <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-2.5">
                <h2 className="text-sm font-semibold text-slate-900">New Grading Scale</h2>
                <input
                  value={gsCode}
                  onChange={(e) => setGsCode(e.target.value)}
                  placeholder="Code (e.g., VTU_10PT)"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm uppercase"
                />
                <input
                  value={gsName}
                  onChange={(e) => setGsName(e.target.value)}
                  placeholder="Name (e.g., VTU 10-Point Relative Scale)"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => addScaleMutation.mutate()}
                  disabled={addScaleMutation.isPending}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
                >
                  <Plus className="h-3.5 w-3.5" /> Create Scale
                </button>
              </div>
            )}

            <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-600">
                Configured Scales
              </div>
              {gradingScales.length === 0 ? (
                <p className="p-4 text-xs text-slate-500">No grading scales defined yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {gradingScales.map((s) => (
                    <li
                      key={s.id}
                      onClick={() => setSelectedScaleId(s.id)}
                      className={`px-4 py-3 cursor-pointer ${
                        activeScale?.id === s.id ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <p className="text-sm font-medium text-slate-900">{s.name}</p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {s.code} · {(s.grade_scale_items ?? []).length} grades
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
            {!activeScale ? (
              <p className="text-sm text-slate-500">Create or select a grading scale to configure grade bands.</p>
            ) : (
              <>
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-base font-semibold text-slate-900">{activeScale.name}</h3>
                  <p className="text-xs font-mono text-slate-500">{activeScale.code}</p>
                </div>

                {canManage && (
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                    <input
                      value={itemGradeCode}
                      onChange={(e) => setItemGradeCode(e.target.value)}
                      placeholder="Grade (O, A+)"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 uppercase"
                    />
                    <input
                      value={itemDesc}
                      onChange={(e) => setItemDesc(e.target.value)}
                      placeholder="Description"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 sm:col-span-2"
                    />
                    <input
                      type="number"
                      step="0.5"
                      value={itemPoints}
                      onChange={(e) => setItemPoints(Number(e.target.value))}
                      placeholder="Points"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                    <input
                      type="number"
                      value={itemMinPct}
                      onChange={(e) => setItemMinPct(e.target.value)}
                      placeholder="Min %"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                    <input
                      type="number"
                      value={itemMaxPct}
                      onChange={(e) => setItemMaxPct(e.target.value)}
                      placeholder="Max %"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                    <div className="col-span-2 sm:col-span-6 flex items-center justify-between pt-1">
                      <label className="inline-flex items-center gap-1.5 text-slate-700">
                        <input
                          type="checkbox"
                          checked={itemIsPass}
                          onChange={(e) => setItemIsPass(e.target.checked)}
                        />
                        Passing Grade
                      </label>
                      <button
                        type="button"
                        onClick={() => addGradeItemMutation.mutate()}
                        disabled={addGradeItemMutation.isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Grade Band
                      </button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Grade</th>
                        <th className="px-3 py-2">Description</th>
                        <th className="px-3 py-2">Points</th>
                        <th className="px-3 py-2">Range %</th>
                        <th className="px-3 py-2">Result</th>
                        {canManage && <th className="px-3 py-2 text-right">Remove</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeScaleItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono font-semibold text-slate-900">{item.grade_code}</td>
                          <td className="px-3 py-2 text-xs text-slate-700">{item.description}</td>
                          <td className="px-3 py-2 font-mono text-xs">{item.grade_point}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">
                            {item.min_percentage ?? '—'} – {item.max_percentage ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                item.is_pass ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                              }`}
                            >
                              {item.is_pass ? 'Pass' : 'Fail'}
                            </span>
                          </td>
                          {canManage && (
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => deleteGradeItemMutation.mutate(item.id)}
                                className="p-1 text-slate-400 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
