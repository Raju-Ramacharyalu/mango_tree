import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type {
  AcademicPeriod,
  AcademicPeriodType,
  AcademicUnit,
  CourseCatalogItem,
  CourseCategory,
  Curriculum,
  CurriculumCourse,
  Program,
} from '@/types/academics'

function getSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function CatalogCurriculaTab({ institutionId, canManage }: { institutionId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [cCode, setCCode] = useState('')
  const [cTitle, setCTitle] = useState('')
  const [cUnitId, setCUnitId] = useState('')
  const [cCatId, setCCatId] = useState('')
  const [cCredits, setCCredits] = useState(3)

  const [curProgId, setCurProgId] = useState('')
  const [curPeriodTypeId, setCurPeriodTypeId] = useState('')
  const [curCode, setCurCode] = useState('')
  const [curName, setCurName] = useState('')
  const [curSchemeBatch, setCurSchemeBatch] = useState('25')

  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null)
  const [mapCourseId, setMapCourseId] = useState('')
  const [mapPeriodId, setMapPeriodId] = useState('')
  const [mapCategoryId, setMapCategoryId] = useState('')
  const [mapCredits, setMapCredits] = useState(3)
  const [mapCie, setMapCie] = useState(50)
  const [mapSee, setMapSee] = useState(50)
  const [mapTotal, setMapTotal] = useState(100)

  const { data: units = [] } = useQuery({
    queryKey: ['academic-units', institutionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('academic_units')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('code')
      return (data ?? []) as AcademicUnit[]
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['course-categories', institutionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('course_categories')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('is_active', true)
        .order('sort_order')
      return (data ?? []) as CourseCategory[]
    },
  })

  const { data: programs = [] } = useQuery({
    queryKey: ['programs', institutionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('programs')
        .select('*')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('code')
      return (data ?? []) as Program[]
    },
  })

  const { data: periodTypes = [] } = useQuery({
    queryKey: ['academic-period-types', institutionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('academic_period_types')
        .select('*')
        .eq('institution_id', institutionId)
        .order('code')
      return (data ?? []) as AcademicPeriodType[]
    },
  })

  const { data: periods = [] } = useQuery({
    queryKey: ['academic-periods', institutionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('academic_periods')
        .select('*')
        .eq('institution_id', institutionId)
        .order('sequence_number')
      return (data ?? []) as AcademicPeriod[]
    },
  })

  const { data: catalog = [] } = useQuery({
    queryKey: ['course-catalog', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_catalog')
        .select('*, academic_units(id, code, name), course_categories(id, code, name, is_online)')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('course_code')
      if (error) throw error
      return (data ?? []) as unknown as CourseCatalogItem[]
    },
  })

  const { data: curricula = [] } = useQuery({
    queryKey: ['curricula', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('*, programs(id, code, name), academic_period_types(id, code, name)')
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('code')
      if (error) throw error
      return (data ?? []) as unknown as Curriculum[]
    },
  })

  const activeCurriculum = curricula.find((c) => c.id === selectedCurriculumId) ?? curricula[0] ?? null

  const { data: mappedCourses = [] } = useQuery({
    queryKey: ['curriculum-courses', activeCurriculum?.id],
    enabled: Boolean(activeCurriculum?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curriculum_courses')
        .select('*, course_catalog(id, course_code, title), academic_periods(id, code, name, sequence_number), course_categories(id, code, name)')
        .eq('curriculum_id', activeCurriculum!.id)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as CurriculumCourse[]
    },
  })

  const addCatalogMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!cCode.trim() || !cTitle.trim()) throw new Error('Course code and title are required.')
      const { error } = await supabase.from('course_catalog').insert({
        institution_id: institutionId,
        offering_academic_unit_id: cUnitId || null,
        course_category_id: cCatId || null,
        course_code: cCode.trim().toUpperCase(),
        title: cTitle.trim(),
        default_credits: cCredits,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setCCode('')
      setCTitle('')
      queryClient.invalidateQueries({ queryKey: ['course-catalog', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to add course to catalog'),
  })

  const addCurriculumMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      const ptId = curPeriodTypeId || periodTypes[0]?.id
      if (!curProgId || !ptId || !curCode.trim() || !curName.trim()) {
        throw new Error('Program, period type, curriculum code, and name are required.')
      }
      const { data, error } = await supabase
        .from('curricula')
        .insert({
          institution_id: institutionId,
          program_id: curProgId,
          period_type_id: ptId,
          code: curCode.trim().toUpperCase(),
          name: curName.trim(),
          scheme_batch: curSchemeBatch.trim() ? Number(curSchemeBatch) : null,
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (createdId) => {
      setCurCode('')
      setCurName('')
      setSelectedCurriculumId(createdId)
      queryClient.invalidateQueries({ queryKey: ['curricula', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create curriculum'),
  })

  const handleMapCategoryChange = (catId: string) => {
    setMapCategoryId(catId)
    const found = categories.find((c) => c.id === catId)
    if (found) {
      setMapCie(found.is_online ? 0 : found.default_max_cie)
      setMapSee(found.is_online ? 0 : found.default_max_see)
      setMapTotal(found.default_total_marks)
    }
  }

  const mapCourseMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      if (!activeCurriculum || !mapCourseId || !mapPeriodId) {
        throw new Error('Select a curriculum, catalog course, and academic period.')
      }
      const selectedCat = categories.find((c) => c.id === mapCategoryId)
      const isOnline = selectedCat?.is_online ?? false
      const { error } = await supabase.from('curriculum_courses').insert({
        institution_id: institutionId,
        curriculum_id: activeCurriculum.id,
        course_id: mapCourseId,
        academic_period_id: mapPeriodId,
        course_category_id: mapCategoryId || null,
        credits: mapCredits,
        max_internal_marks: isOnline ? 0 : mapCie,
        max_external_marks: isOnline ? 0 : mapSee,
        total_marks: mapTotal > 0 ? mapTotal : 100,
        is_elective: selectedCat?.is_elective ?? false,
        is_lab: selectedCat?.code === 'LAB',
      })
      if (error) throw error
    },
    onSuccess: () => {
      setMapCourseId('')
      queryClient.invalidateQueries({ queryKey: ['curriculum-courses', activeCurriculum?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to map course to curriculum'),
  })

  const removeMappingMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('curriculum_courses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['curriculum-courses', activeCurriculum?.id] }),
  })

  return (
    <div className="space-y-6">
      {errorMsg && <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700">{errorMsg}</div>}

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Course Catalog ({catalog.length})</h2>
          <p className="text-xs text-slate-500">
            Universal course identity per institution—shared courses are defined once here and mapped into multiple curricula below.
          </p>
        </div>

        {canManage && (
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
            <input
              value={cCode}
              onChange={(e) => setCCode(e.target.value)}
              placeholder="Code (1BMATC101)"
              className="rounded border border-slate-300 px-3 py-1.5 text-sm uppercase"
            />
            <input
              value={cTitle}
              onChange={(e) => setCTitle(e.target.value)}
              placeholder="Course Title"
              className="rounded border border-slate-300 px-3 py-1.5 text-sm sm:col-span-2"
            />
            <select
              value={cUnitId}
              onChange={(e) => setCUnitId(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="">Offering Unit...</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </select>
            <select
              value={cCatId}
              onChange={(e) => setCCatId(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="">Category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.5"
                value={cCredits}
                onChange={(e) => setCCredits(Number(e.target.value))}
                className="w-16 rounded border border-slate-300 px-2 py-1.5 text-xs"
                title="Default Credits"
              />
              <button
                type="button"
                onClick={() => addCatalogMutation.mutate()}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-2"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>
        )}

        <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-2">Course Code</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Offering Dept</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {catalog.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-5 text-center text-slate-500">
                    No courses in catalog yet.
                  </td>
                </tr>
              ) : (
                catalog.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono font-semibold text-slate-800">{c.course_code}</td>
                    <td className="px-4 py-2 text-slate-900">{c.title}</td>
                    <td className="px-4 py-2 text-slate-600">{getSingle(c.academic_units)?.code ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600">{getSingle(c.course_categories)?.code ?? '—'}</td>
                    <td className="px-4 py-2 font-mono">{c.default_credits}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          {canManage && (
            <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs space-y-2.5">
              <h2 className="text-sm font-semibold text-slate-900">New Curriculum / Scheme</h2>
              <select
                value={curProgId}
                onChange={(e) => setCurProgId(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Select Program...</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
              <select
                value={curPeriodTypeId || periodTypes[0]?.id || ''}
                onChange={(e) => setCurPeriodTypeId(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                {periodTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={curCode}
                  onChange={(e) => setCurCode(e.target.value)}
                  placeholder="Code (CS_2025)"
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs uppercase"
                />
                <input
                  value={curSchemeBatch}
                  onChange={(e) => setCurSchemeBatch(e.target.value)}
                  placeholder="Batch (25)"
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <input
                value={curName}
                onChange={(e) => setCurName(e.target.value)}
                placeholder="Curriculum Name (2025 NEP CSE)"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => addCurriculumMutation.mutate()}
                className="w-full inline-flex items-center justify-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium py-2"
              >
                <Plus className="h-3.5 w-3.5" /> Create Curriculum
              </button>
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase text-slate-600">
              Curricula ({curricula.length})
            </div>
            {curricula.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">No curricula created yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {curricula.map((cur) => (
                  <li
                    key={cur.id}
                    onClick={() => setSelectedCurriculumId(cur.id)}
                    className={`px-4 py-3 cursor-pointer ${
                      activeCurriculum?.id === cur.id ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-sm font-medium text-slate-900">{cur.name}</p>
                    <p className="text-[11px] font-mono text-slate-500">
                      {cur.code} · {getSingle(cur.programs)?.code} · v{cur.version_number}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          {!activeCurriculum ? (
            <p className="text-sm text-slate-500">Select or create a curriculum to map courses from the catalog.</p>
          ) : (
            <>
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold text-slate-900">{activeCurriculum.name}</h3>
                <p className="text-xs font-mono text-slate-500">
                  {activeCurriculum.code} · {getSingle(activeCurriculum.academic_period_types)?.name}
                </p>
              </div>

              {canManage && (
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                  <select
                    value={mapCourseId}
                    onChange={(e) => setMapCourseId(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 col-span-2 sm:col-span-3"
                  >
                    <option value="">Select Catalog Course...</option>
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.course_code} — {c.title}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mapPeriodId}
                    onChange={(e) => setMapPeriodId(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 sm:col-span-2"
                  >
                    <option value="">Select Period...</option>
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mapCategoryId}
                    onChange={(e) => handleMapCategoryChange(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5"
                  >
                    <option value="">Category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </select>

                  <label className="space-y-0.5">
                    <span className="text-[11px] text-slate-500">Credits</span>
                    <input
                      type="number"
                      step="0.5"
                      value={mapCredits}
                      onChange={(e) => setMapCredits(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[11px] text-slate-500">Max CIE</span>
                    <input
                      type="number"
                      value={mapCie}
                      onChange={(e) => setMapCie(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[11px] text-slate-500">Max SEE</span>
                    <input
                      type="number"
                      value={mapSee}
                      onChange={(e) => setMapSee(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[11px] text-slate-500">Total</span>
                    <input
                      type="number"
                      value={mapTotal}
                      onChange={(e) => setMapTotal(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => mapCourseMutation.mutate()}
                    className="col-span-2 self-end inline-flex items-center justify-center gap-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Map Course
                  </button>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2">Course</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Credits</th>
                      <th className="px-3 py-2">CIE / SEE / Total</th>
                      {canManage && <th className="px-3 py-2 text-right">Remove</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {mappedCourses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          No courses mapped to this curriculum yet.
                        </td>
                      </tr>
                    ) : (
                      mappedCourses.map((mc) => {
                        const course = getSingle(mc.course_catalog)
                        const period = getSingle(mc.academic_periods)
                        const cat = getSingle(mc.course_categories)
                        return (
                          <tr key={mc.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-slate-600">{period?.code ?? '—'}</td>
                            <td className="px-3 py-2">
                              <span className="font-mono font-semibold text-slate-800">{course?.course_code}</span>
                              <span className="text-slate-600 ml-1.5">{course?.title}</span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">{cat?.code ?? '—'}</td>
                            <td className="px-3 py-2 font-mono">{mc.credits}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {mc.max_internal_marks} / {mc.max_external_marks} / {mc.total_marks}
                            </td>
                            {canManage && (
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeMappingMutation.mutate(mc.id)}
                                  className="p-1 text-slate-400 hover:text-red-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
