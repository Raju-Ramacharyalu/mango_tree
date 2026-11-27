import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Book,
  Target,
  Layers,
  Calculator,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  BloomsLevel,
  CourseOutcomeDraft,
  EvaluationRubricDraft,
  ProjectPhaseItem,
  RubricCalcLogic,
  RubricComponentType,
  SyllabusApprovalStatus,
  SyllabusFormat,
  SyllabusModuleItem,
} from '@/types/governance'

interface Props {
  institutionId: string
  academicYear: string
  term: 'ODD' | 'EVEN'
  courses: Array<{ id: string; course_code: string; title: string; default_credits: number }>
  canEdit: boolean
}

const PO_PSO_CODES = [
  'PO1', 'PO2', 'PO3', 'PO4', 'PO5', 'PO6',
  'PO7', 'PO8', 'PO9', 'PO10', 'PO11', 'PO12',
  'PSO1', 'PSO2', 'PSO3',
]

function defaultModules(): SyllabusModuleItem[] {
  return [1, 2, 3, 4, 5].map((n) => ({ module_number: n, title: '', content: '' }))
}

function defaultPhases(): ProjectPhaseItem[] {
  return [
    { phase: 1, title: 'Phase 1: Synopsis & Literature Survey', deliverables: '' },
    { phase: 2, title: 'Phase 2: Mid-Term Implementation', deliverables: '' },
    { phase: 3, title: 'Phase 3: Final Execution & Report', deliverables: '' },
  ]
}

function defaultRubrics(): EvaluationRubricDraft[] {
  return [
    {
      component_name: 'IA Test 1 & 2',
      component_type: 'THEORY_TEST',
      max_marks: 50,
      scaled_to: 25,
      calculation_logic: 'AVERAGE_BEST_2',
    },
    {
      component_name: 'CCA / Assignment',
      component_type: 'CCA_ACTIVITY',
      max_marks: 25,
      scaled_to: 25,
      calculation_logic: 'SUM',
    },
  ]
}

export function CurriculumMasterTab({ institutionId, academicYear, term, courses, canEdit }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [courseFilter, setCourseFilter] = useState('')
  const [syllabusType, setSyllabusType] = useState<SyllabusFormat>('THEORY')
  const [approvalStatus, setApprovalStatus] = useState<SyllabusApprovalStatus>('DRAFT')
  const [modules, setModules] = useState<SyllabusModuleItem[]>(defaultModules)
  const [labPartA, setLabPartA] = useState('')
  const [labPartB, setLabPartB] = useState('')
  const [projectPhases, setProjectPhases] = useState<ProjectPhaseItem[]>(defaultPhases)
  const [textbooks, setTextbooks] = useState('')
  const [referenceBooks, setReferenceBooks] = useState('')
  const [outcomes, setOutcomes] = useState<CourseOutcomeDraft[]>([
    { co_code: 'CO1', description: '', target_bloom_level: '', mappings: {} },
  ])
  const [rubrics, setRubrics] = useState<EvaluationRubricDraft[]>(defaultRubrics)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: bloomsLevels = [] } = useQuery<BloomsLevel[]>({
    queryKey: ['platform_blooms_taxonomy'],
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_blooms_taxonomy')
        .select('*')
        .order('level_number', { ascending: true })
      if (error) throw error
      return (data ?? []) as BloomsLevel[]
    },
  })

  const filteredCourses = useMemo(() => {
    const q = courseFilter.trim().toLowerCase()
    if (!q) return courses
    return courses.filter((c) => `${c.course_code} ${c.title}`.toLowerCase().includes(q))
  }, [courses, courseFilter])

  const { data: loadedCurriculum, isFetching } = useQuery({
    queryKey: ['course_curriculum_bundle', institutionId, selectedCourseId, academicYear, term],
    enabled: Boolean(selectedCourseId),
    queryFn: async () => {
      const [sylRes, coRes, rubRes] = await Promise.all([
        supabase
          .from('course_syllabi')
          .select('*')
          .eq('institution_id', institutionId)
          .eq('course_id', selectedCourseId)
          .eq('academic_year', academicYear)
          .eq('term', term)
          .maybeSingle(),
        supabase
          .from('course_outcomes')
          .select('id, co_code, description, target_bloom_level, course_co_po_mappings(outcome_code, correlation_level)')
          .eq('institution_id', institutionId)
          .eq('course_id', selectedCourseId)
          .eq('academic_year', academicYear)
          .eq('term', term)
          .order('co_code', { ascending: true }),
        supabase
          .from('course_evaluation_rubrics')
          .select('*')
          .eq('institution_id', institutionId)
          .eq('course_id', selectedCourseId)
          .eq('academic_year', academicYear)
          .eq('term', term)
          .order('sort_order', { ascending: true }),
      ])
      if (sylRes.error) throw sylRes.error
      if (coRes.error) throw coRes.error
      if (rubRes.error) throw rubRes.error
      return {
        syllabus: sylRes.data,
        outcomes: coRes.data ?? [],
        rubrics: rubRes.data ?? [],
      }
    },
  })

  useEffect(() => {
    if (!selectedCourseId || !loadedCurriculum) return
    const syl = loadedCurriculum.syllabus
    if (syl) {
      setSyllabusType((syl.syllabus_type as SyllabusFormat) ?? 'THEORY')
      setApprovalStatus((syl.approval_status as SyllabusApprovalStatus) ?? 'DRAFT')
      setModules(
        Array.isArray(syl.modules_json) && syl.modules_json.length > 0
          ? (syl.modules_json as SyllabusModuleItem[])
          : defaultModules()
      )
      setLabPartA(String(syl.lab_part_a ?? ''))
      setLabPartB(String(syl.lab_part_b ?? ''))
      setProjectPhases(
        Array.isArray(syl.project_phases_json) && syl.project_phases_json.length > 0
          ? (syl.project_phases_json as ProjectPhaseItem[])
          : defaultPhases()
      )
      setTextbooks(String(syl.textbooks ?? ''))
      setReferenceBooks(String(syl.reference_books ?? ''))
    } else {
      setSyllabusType('THEORY')
      setApprovalStatus('DRAFT')
      setModules(defaultModules())
      setLabPartA('')
      setLabPartB('')
      setProjectPhases(defaultPhases())
      setTextbooks('')
      setReferenceBooks('')
    }

    if (loadedCurriculum.outcomes.length > 0) {
      setOutcomes(
        loadedCurriculum.outcomes.map((co) => {
          const mapObj: Record<string, number | ''> = {}
          const rawMaps = (co.course_co_po_mappings as Array<{ outcome_code: string; correlation_level: number }>) ?? []
          for (const m of rawMaps) {
            mapObj[m.outcome_code] = m.correlation_level
          }
          return {
            co_code: String(co.co_code),
            description: String(co.description ?? ''),
            target_bloom_level: String(co.target_bloom_level ?? ''),
            mappings: mapObj,
          }
        })
      )
    } else {
      setOutcomes([{ co_code: 'CO1', description: '', target_bloom_level: '', mappings: {} }])
    }

    if (loadedCurriculum.rubrics.length > 0) {
      setRubrics(
        loadedCurriculum.rubrics.map((r) => ({
          component_name: String(r.component_name),
          component_type: r.component_type as RubricComponentType,
          max_marks: Number(r.max_marks ?? 0),
          scaled_to: Number(r.scaled_to ?? 0),
          calculation_logic: r.calculation_logic as RubricCalcLogic,
        }))
      )
    } else {
      setRubrics(defaultRubrics())
    }
  }, [selectedCourseId, loadedCurriculum])

  const saveAllMutation = useMutation({
    mutationFn: async (targetApproval: SyllabusApprovalStatus) => {
      if (!selectedCourseId) throw new Error('Select a course first.')
      const actorId = session?.user.id ?? null

      // 1. Upsert Syllabus
      const { error: sylErr } = await supabase.from('course_syllabi').upsert(
        {
          institution_id: institutionId,
          course_id: selectedCourseId,
          academic_year: academicYear,
          term,
          syllabus_type: syllabusType,
          modules_json: modules,
          lab_part_a: labPartA,
          lab_part_b: labPartB,
          project_phases_json: projectPhases,
          textbooks,
          reference_books: referenceBooks,
          approval_status: targetApproval,
          approved_by: targetApproval === 'BOS_APPROVED' || targetApproval === 'PUBLISHED' ? actorId : null,
          approved_at:
            targetApproval === 'BOS_APPROVED' || targetApproval === 'PUBLISHED'
              ? new Date().toISOString()
              : null,
          created_by: actorId,
          updated_by: actorId,
        },
        { onConflict: 'institution_id,course_id,academic_year,term' }
      )
      if (sylErr) throw sylErr

      // 2. Replace COs + CO-PO Mappings cleanly
      const { error: delCoErr } = await supabase
        .from('course_outcomes')
        .delete()
        .eq('institution_id', institutionId)
        .eq('course_id', selectedCourseId)
        .eq('academic_year', academicYear)
        .eq('term', term)
      if (delCoErr) throw delCoErr

      const validOutcomes = outcomes.filter((o) => o.description.trim() !== '')
      if (validOutcomes.length > 0) {
        const { data: insertedCos, error: insCoErr } = await supabase
          .from('course_outcomes')
          .insert(
            validOutcomes.map((o, idx) => ({
              institution_id: institutionId,
              course_id: selectedCourseId,
              academic_year: academicYear,
              term,
              co_code: o.co_code || `CO${idx + 1}`,
              description: o.description.trim(),
              target_bloom_level: o.target_bloom_level,
              created_by: actorId,
              updated_by: actorId,
            }))
          )
          .select('id, co_code')
        if (insCoErr) throw insCoErr

        const coIdByCode = new Map((insertedCos ?? []).map((r) => [r.co_code as string, r.id as string]))
        const mappingRows: Array<{
          institution_id: string
          course_outcome_id: string
          outcome_code: string
          correlation_level: number
        }> = []

        for (const o of validOutcomes) {
          const coId = coIdByCode.get(o.co_code)
          if (!coId) continue
          for (const [code, lvl] of Object.entries(o.mappings)) {
            const num = Number(lvl)
            if (num >= 1 && num <= 3) {
              mappingRows.push({
                institution_id: institutionId,
                course_outcome_id: coId,
                outcome_code: code,
                correlation_level: num,
              })
            }
          }
        }
        if (mappingRows.length > 0) {
          const { error: mapErr } = await supabase.from('course_co_po_mappings').insert(mappingRows)
          if (mapErr) throw mapErr
        }
      }

      // 3. Replace CIE Evaluation Rubrics
      const { error: delRubErr } = await supabase
        .from('course_evaluation_rubrics')
        .delete()
        .eq('institution_id', institutionId)
        .eq('course_id', selectedCourseId)
        .eq('academic_year', academicYear)
        .eq('term', term)
      if (delRubErr) throw delRubErr

      const validRubrics = rubrics.filter((r) => r.component_name.trim() !== '')
      if (validRubrics.length > 0) {
        const { error: insRubErr } = await supabase.from('course_evaluation_rubrics').insert(
          validRubrics.map((r, idx) => ({
            institution_id: institutionId,
            course_id: selectedCourseId,
            academic_year: academicYear,
            term,
            component_name: r.component_name.trim(),
            component_type: r.component_type,
            max_marks: Number(r.max_marks) || 0,
            scaled_to: Number(r.scaled_to) || 0,
            calculation_logic: r.calculation_logic,
            sort_order: idx + 1,
            created_by: actorId,
            updated_by: actorId,
          }))
        )
        if (insRubErr) throw insRubErr
      }

      return targetApproval
    },
    onSuccess: (status) => {
      setErrorMsg(null)
      setApprovalStatus(status)
      setNotice(`Saved full BOS Syllabus, CO-PO Matrix & CIE Rubrics (${status}).`)
      queryClient.invalidateQueries({
        queryKey: ['course_curriculum_bundle', institutionId, selectedCourseId, academicYear, term],
      })
    },
    onError: (err) => {
      setNotice(null)
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save BOS curriculum')
    },
  })

  const totalScaledCie = rubrics.reduce((s, r) => s + (Number(r.scaled_to) || 0), 0)

  return (
    <div className="space-y-5">
      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          {errorMsg}
        </div>
      )}

      {/* Course Picker */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Filter Course Catalog</label>
          <input
            type="text"
            placeholder="Search code or title..."
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Select Course ({academicYear} · {term} Term)
          </label>
          <select
            value={selectedCourseId}
            onChange={(e) => {
              setSelectedCourseId(e.target.value)
              setNotice(null)
              setErrorMsg(null)
            }}
            className="w-full rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900"
          >
            <option value="">-- Choose a course to configure BOS syllabus &amp; rubrics --</option>
            {filteredCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.course_code} — {c.title} ({c.default_credits} Cr)
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedCourseId ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-500">
          Select a course above to author its Theory/Lab/Integrated/Project Syllabus, Course Outcomes, 12-PO/3-PSO
          Mapping Matrix, and CIE Evaluation Rubrics.
        </div>
      ) : isFetching ? (
        <div className="text-xs text-slate-500 py-8 text-center">Loading BOS curriculum record...</div>
      ) : (
        <div className="space-y-5">
          {/* Format & Status Bar */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Book className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-semibold text-slate-900">1. Syllabus Structure</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                Status: {approvalStatus}
              </span>
            </div>
            <select
              disabled={!canEdit}
              value={syllabusType}
              onChange={(e) => setSyllabusType(e.target.value as SyllabusFormat)}
              className="rounded-md border border-indigo-300 bg-indigo-50/40 px-3 py-1.5 text-xs font-semibold text-indigo-900"
            >
              <option value="THEORY">Theory Course (5 Modules)</option>
              <option value="LAB">Pure Lab Course (Part A &amp; B)</option>
              <option value="INTEGRATED">Integrated Course (Theory + Lab)</option>
              <option value="PROJECT">Project / Internship Milestones</option>
            </select>
          </div>

          {/* Syllabus Body */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
            {(syllabusType === 'THEORY' || syllabusType === 'INTEGRATED') && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Theory Modules</h3>
                {modules.map((m, idx) => (
                  <div key={m.module_number} className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-800 whitespace-nowrap">
                        Module {m.module_number}
                      </span>
                      <input
                        disabled={!canEdit}
                        type="text"
                        placeholder="Module title..."
                        value={m.title}
                        onChange={(e) =>
                          setModules((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item))
                          )
                        }
                        className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
                      />
                    </div>
                    <textarea
                      disabled={!canEdit}
                      rows={2}
                      placeholder="Detailed topics covered..."
                      value={m.content}
                      onChange={(e) =>
                        setModules((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, content: e.target.value } : item))
                        )
                      }
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                ))}
              </div>
            )}

            {(syllabusType === 'LAB' || syllabusType === 'INTEGRATED') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-emerald-800 mb-1">
                    PART A: Core / Fixed Experiments
                  </label>
                  <textarea
                    disabled={!canEdit}
                    rows={5}
                    placeholder="1. Core experiment..."
                    value={labPartA}
                    onChange={(e) => setLabPartA(e.target.value)}
                    className="w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-rose-800 mb-1">
                    PART B: Advanced / Open-Ended Experiments
                  </label>
                  <textarea
                    disabled={!canEdit}
                    rows={5}
                    placeholder="1. Open-ended experiment..."
                    value={labPartB}
                    onChange={(e) => setLabPartB(e.target.value)}
                    className="w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>
            )}

            {syllabusType === 'PROJECT' && (
              <div className="space-y-2.5">
                {projectPhases.map((p, idx) => (
                  <div key={p.phase} className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <input
                      disabled={!canEdit}
                      type="text"
                      value={p.title}
                      onChange={(e) =>
                        setProjectPhases((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item))
                        )
                      }
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold"
                    />
                    <textarea
                      disabled={!canEdit}
                      rows={2}
                      placeholder="Expected deliverables..."
                      value={p.deliverables}
                      onChange={(e) =>
                        setProjectPhases((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, deliverables: e.target.value } : item))
                        )
                      }
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {syllabusType === 'PROJECT' ? 'Project Guidelines / Standards' : 'Prescribed Textbooks'}
                </label>
                <textarea
                  disabled={!canEdit}
                  rows={2}
                  value={textbooks}
                  onChange={(e) => setTextbooks(e.target.value)}
                  className="w-full rounded border border-slate-300 p-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Reference Materials</label>
                <textarea
                  disabled={!canEdit}
                  rows={2}
                  value={referenceBooks}
                  onChange={(e) => setReferenceBooks(e.target.value)}
                  className="w-full rounded border border-slate-300 p-2 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Course Outcomes */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Target className="h-4 w-4 text-indigo-600" />
                2. Course Outcomes (COs)
              </h3>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    setOutcomes((prev) => [
                      ...prev,
                      { co_code: `CO${prev.length + 1}`, description: '', target_bloom_level: '', mappings: {} },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Add CO
                </button>
              )}
            </div>

            <div className="space-y-2">
              {outcomes.map((co, idx) => {
                const bloom = bloomsLevels.find((b) => b.name === co.target_bloom_level)
                return (
                  <div key={co.co_code} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start border-b border-slate-100 pb-2">
                    <div className="md:col-span-1 text-xs font-bold text-indigo-800 pt-2">{co.co_code}</div>
                    <div className="md:col-span-7 space-y-1">
                      <input
                        disabled={!canEdit}
                        type="text"
                        placeholder="At the end of this course, the student will be able to..."
                        value={co.description}
                        onChange={(e) =>
                          setOutcomes((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, description: e.target.value } : item))
                          )
                        }
                        className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      {bloom && (
                        <p className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Info className="h-3 w-3 text-blue-500 shrink-0" />
                          <span>Suggested verbs: {bloom.action_verbs}</span>
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-3">
                      <select
                        disabled={!canEdit}
                        value={co.target_bloom_level}
                        onChange={(e) =>
                          setOutcomes((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, target_bloom_level: e.target.value } : item
                            )
                          )
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                      >
                        <option value="">Target Bloom's...</option>
                        {bloomsLevels.map((b) => (
                          <option key={b.code} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-1 text-right pt-1">
                      {canEdit && outcomes.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOutcomes((prev) =>
                              prev
                                .filter((_, i) => i !== idx)
                                .map((item, i) => ({ ...item, co_code: `CO${i + 1}` }))
                            )
                          }
                          className="p-1 text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Section 3: CO-PO / PSO Mapping Matrix */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-600" />
                3. CO–PO / PSO Mapping Matrix (1 = Low, 2 = Med, 3 = High)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-center text-[11px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                    <th className="p-1.5 text-left">CO</th>
                    {PO_PSO_CODES.map((code) => (
                      <th key={code} className="p-1.5 font-semibold">
                        {code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {outcomes.map((co, idx) => (
                    <tr key={co.co_code}>
                      <td className="p-1.5 text-left font-bold text-indigo-900">{co.co_code}</td>
                      {PO_PSO_CODES.map((code) => (
                        <td key={code} className="p-1">
                          <input
                            disabled={!canEdit}
                            type="number"
                            min={1}
                            max={3}
                            value={co.mappings[code] ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value
                              const val: number | '' = raw === '' ? '' : Math.min(3, Math.max(1, Number(raw)))
                              setOutcomes((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, mappings: { ...item.mappings, [code]: val } } : item
                                )
                              )
                            }}
                            className="w-9 rounded border border-slate-300 py-0.5 text-center text-xs"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 4: CIE Evaluation Rubrics */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Calculator className="h-4 w-4 text-indigo-600" />
                4. CIE Evaluation Rubrics
              </h3>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    setRubrics((prev) => [
                      ...prev,
                      {
                        component_name: '',
                        component_type: 'THEORY_TEST',
                        max_marks: 25,
                        scaled_to: 10,
                        calculation_logic: 'SUM',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Component
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="p-2">Component Name</th>
                    <th className="p-2">Type</th>
                    <th className="p-2 w-24">Max Marks</th>
                    <th className="p-2 w-24">Scaled To</th>
                    <th className="p-2">Calculation Logic</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rubrics.map((r, idx) => (
                    <tr key={idx}>
                      <td className="p-1.5">
                        <input
                          disabled={!canEdit}
                          type="text"
                          value={r.component_name}
                          onChange={(e) =>
                            setRubrics((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, component_name: e.target.value } : item))
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-1.5">
                        <select
                          disabled={!canEdit}
                          value={r.component_type}
                          onChange={(e) =>
                            setRubrics((prev) =>
                              prev.map((item, i) =>
                                i === idx
                                  ? { ...item, component_type: e.target.value as RubricComponentType }
                                  : item
                              )
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="THEORY_TEST">Theory Test</option>
                          <option value="CCA_ACTIVITY">CCA / Assignment</option>
                          <option value="LAB_RECORD">Lab Record / Conduction</option>
                          <option value="LAB_INTERNAL">Lab Internal Exam</option>
                          <option value="PROJECT_PHASE">Project Phase Review</option>
                          <option value="SEMINAR_PRESENTATION">Seminar Presentation</option>
                        </select>
                      </td>
                      <td className="p-1.5">
                        <input
                          disabled={!canEdit}
                          type="number"
                          min={0}
                          value={r.max_marks}
                          onChange={(e) =>
                            setRubrics((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, max_marks: Number(e.target.value) || 0 } : item
                              )
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          disabled={!canEdit}
                          type="number"
                          min={0}
                          value={r.scaled_to}
                          onChange={(e) =>
                            setRubrics((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, scaled_to: Number(e.target.value) || 0 } : item
                              )
                            )
                          }
                          className="w-full rounded border border-emerald-300 bg-emerald-50/40 px-2 py-1 text-xs font-semibold"
                        />
                      </td>
                      <td className="p-1.5">
                        <select
                          disabled={!canEdit}
                          value={r.calculation_logic}
                          onChange={(e) =>
                            setRubrics((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, calculation_logic: e.target.value as RubricCalcLogic } : item
                              )
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          <option value="AVERAGE_BEST_2">Average of Best 2</option>
                          <option value="AVERAGE_ALL">Average of All</option>
                          <option value="SUM">Sum (Direct Addition)</option>
                          <option value="SCALE_DOWN">Scale Down</option>
                        </select>
                      </td>
                      <td className="p-1.5 text-center">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setRubrics((prev) => prev.filter((_, i) => i !== idx))}
                            className="p-1 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="text-xs">
                Total Scaled CIE Marks:{' '}
                <strong
                  className={
                    totalScaledCie === 50 || totalScaledCie === 100
                      ? 'text-emerald-700 text-sm'
                      : 'text-amber-700 text-sm'
                  }
                >
                  {totalScaledCie}
                </strong>
              </div>

              {canEdit && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saveAllMutation.isPending}
                    onClick={() => saveAllMutation.mutate('DRAFT')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={saveAllMutation.isPending}
                    onClick={() => saveAllMutation.mutate('BOS_APPROVED')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {saveAllMutation.isPending ? 'Saving...' : 'Save & BOS Approve'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
