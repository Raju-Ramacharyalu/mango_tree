import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowRightLeft, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type {
  GovernanceProgramRow,
  GovernanceStaffRow,
  SectionAllocationRow,
} from '@/types/governance'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  academicYear: string
  term: 'ODD' | 'EVEN'
  programs: GovernanceProgramRow[]
  courses: Array<{ id: string; course_code: string; title: string; default_credits: number }>
  staff: GovernanceStaffRow[]
  allocations: SectionAllocationRow[]
  isFirstYearDean: boolean
  scopedUnitId: string | null
  canManage: boolean
}

export function SectionAllocationsTab({
  institutionId,
  cycle,
  academicYear,
  term,
  programs,
  courses,
  staff,
  allocations,
  isFirstYearDean,
  scopedUnitId,
  canManage,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [programId, setProgramId] = useState('')
  const [semesterNumber, setSemesterNumber] = useState(isFirstYearDean ? 1 : 3)
  const [sectionName, setSectionName] = useState('A')
  const [courseId, setCourseId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const visiblePrograms = useMemo(() => {
    if (isFirstYearDean || !scopedUnitId) return programs
    const matching = programs.filter((p) => p.academic_unit_id === scopedUnitId)
    return matching.length > 0 ? matching : programs
  }, [programs, isFirstYearDean, scopedUnitId])

  const allowedSemesters = useMemo(() => {
    const all = term === 'ODD' ? [1, 3, 5, 7] : [2, 4, 6, 8]
    if (isFirstYearDean) return all.filter((s) => s <= 2)
    if (scopedUnitId) return all.filter((s) => s >= 3)
    return all
  }, [term, isFirstYearDean, scopedUnitId])

  const activeStaff = useMemo(() => {
    return staff
      .filter((s) => s.is_active)
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [staff])

  const visibleAllocations = useMemo(() => {
    return allocations.filter((a) => {
      if (programId && a.program_id !== programId) return false
      if (isFirstYearDean && a.semester_number > 2) return false
      if (!isFirstYearDean && scopedUnitId) {
        const prog = programs.find((p) => p.id === a.program_id)
        if (prog?.academic_unit_id && prog.academic_unit_id !== scopedUnitId) return false
      }
      return true
    })
  }, [allocations, programId, isFirstYearDean, scopedUnitId, programs])

  const allocateMutation = useMutation({
    mutationFn: async () => {
      if (!programId || !courseId || !staffId || !sectionName.trim()) {
        throw new Error('Select Branch, Semester, Section, Course, and Faculty Member.')
      }
      const crs = courses.find((c) => c.id === courseId)
      const st = activeStaff.find((s) => s.id === staffId)
      if (!crs || !st) throw new Error('Invalid course or faculty selection.')

      const { error } = await supabase.from('course_section_allocations').insert({
        institution_id: institutionId,
        exam_cycle_id: cycle?.id ?? null,
        academic_year: academicYear,
        term,
        program_id: programId,
        semester_number: semesterNumber,
        section_name: sectionName.trim().toUpperCase(),
        course_id: crs.id,
        course_code: crs.course_code,
        staff_profile_id: st.id,
        faculty_code: st.employee_code,
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      })
      if (error) throw error
      return `${crs.course_code} (Sec ${sectionName.trim().toUpperCase()}) → ${st.full_name}`
    },
    onSuccess: (summary) => {
      setErrorMsg(null)
      setNotice(`Allocated ${summary}.`)
      setCourseId('')
      queryClient.invalidateQueries({ queryKey: ['governance_allocations', institutionId] })
    },
    onError: (err) => {
      setNotice(null)
      setErrorMsg(err instanceof Error ? err.message : 'Allocation failed (check duplicate section/course).')
    },
  })

  const reassignMutation = useMutation({
    mutationFn: async ({ allocId, newStaffId }: { allocId: string; newStaffId: string }) => {
      const st = activeStaff.find((s) => s.id === newStaffId)
      if (!st) throw new Error('Selected faculty not found.')
      const { error } = await supabase
        .from('course_section_allocations')
        .update({
          staff_profile_id: st.id,
          faculty_code: st.employee_code,
          updated_by: session?.user.id ?? null,
        })
        .eq('id', allocId)
        .eq('institution_id', institutionId)
      if (error) throw error
      return st.full_name
    },
    onSuccess: (name) => {
      setErrorMsg(null)
      setNotice(`Section reassigned to ${name}. Historical CIE marks remain preserved.`)
      queryClient.invalidateQueries({ queryKey: ['governance_allocations', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Reassignment failed'),
  })

  const removeMutation = useMutation({
    mutationFn: async (allocId: string) => {
      const { error } = await supabase
        .from('course_section_allocations')
        .delete()
        .eq('id', allocId)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      setNotice('Allocation removed.')
      queryClient.invalidateQueries({ queryKey: ['governance_allocations', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Delete failed'),
  })

  return (
    <div className="space-y-4">
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

      {canManage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-emerald-950">
              Assign Faculty to Section ({academicYear} · {term})
            </h2>
            <span className="text-[11px] text-emerald-800">
              {isFirstYearDean
                ? 'Dean First Year Scope: Sem 1 & 2 across all branches'
                : scopedUnitId
                  ? 'HOD Department Scope: Sem 3+'
                  : 'Institution-Wide Scope'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5 items-end">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Branch</label>
              <select
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="">Select branch...</option>
                {visiblePrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Sem</label>
              <select
                value={semesterNumber}
                onChange={(e) => setSemesterNumber(Number(e.target.value))}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                {allowedSemesters.map((s) => (
                  <option key={s} value={s}>
                    Sem {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Section</label>
              <input
                type="text"
                maxLength={4}
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value.toUpperCase())}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-center font-bold uppercase"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Course</label>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="">Select course...</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.course_code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">Faculty</label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="">Select faculty...</option>
                {activeStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.employee_code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={allocateMutation.isPending}
              onClick={() => allocateMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {allocateMutation.isPending ? 'Allocating...' : 'Allocate Section'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800">
            Active Section Allocations Matrix ({visibleAllocations.length})
          </span>
          <span className="text-slate-500">Reassigning faculty preserves all entered CIE marks</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Course</th>
                <th className="px-4 py-2.5 font-semibold">Branch / Sem / Sec</th>
                <th className="px-4 py-2.5 font-semibold">Assigned Faculty</th>
                <th className="px-4 py-2.5 font-semibold text-right">Inline Reassign</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleAllocations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No section allocations recorded for {academicYear} ({term}) yet.
                  </td>
                </tr>
              ) : (
                visibleAllocations.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className="font-mono font-semibold text-indigo-900">{a.course_code}</span>
                      <p className="text-slate-600">{a.course_title}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
                        {a.program_code} · Sem {a.semester_number} · Sec {a.section_name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-900">{a.faculty_name}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-slate-500">({a.faculty_code})</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canManage ? (
                        <div className="inline-flex items-center gap-2">
                          <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" />
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const newId = e.target.value
                              if (!newId) return
                              if (
                                window.confirm(
                                  `Transfer ${a.course_code} Sec ${a.section_name} to the selected faculty? Historical CIE marks will be preserved.`
                                )
                              ) {
                                reassignMutation.mutate({ allocId: a.id, newStaffId: newId })
                              }
                              e.target.value = ''
                            }}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                          >
                            <option value="">Reassign to...</option>
                            {activeStaff
                              .filter((s) => s.id !== a.staff_profile_id)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.full_name} ({s.employee_code})
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Remove allocation for ${a.course_code} Sec ${a.section_name}?`)) {
                                removeMutation.mutate(a.id)
                              }
                            }}
                            className="p-1 text-red-500 hover:text-red-700"
                            title="Delete allocation"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">Read-only</span>
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
