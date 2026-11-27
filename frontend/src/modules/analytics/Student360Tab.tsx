import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, User } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { Student360Response } from '@/types/analytics'
import { signStudentPhotosWithFallback } from '@/modules/exams/printBranding'
import { cn } from '@/utils/cn'

export function Student360Tab({ institutionId }: { institutionId: string }) {
  const [usnInput, setUsnInput] = useState('')
  const [activeUsn, setActiveUsn] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery<Student360Response>({
    queryKey: ['student_360', institutionId, activeUsn],
    enabled: Boolean(activeUsn),
    queryFn: async () => {
      const { data: res, error: err } = await supabase.rpc('get_student_360_profile', {
        p_institution_id: institutionId,
        p_usn: activeUsn,
      })
      if (err) throw err
      return res as Student360Response
    },
  })

  useEffect(() => {
    const stu = data?.student
    if (!stu) {
      setPhotoUrl(null)
      return
    }
    let cancelled = false
    signStudentPhotosWithFallback(institutionId, [
      {
        key: stu.id,
        photo_url: stu.photo_url,
        registration_number: stu.registration_number,
        admission_number: stu.admission_number,
      },
    ]).then((m) => {
      if (!cancelled) setPhotoUrl(m.get(stu.id) ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [institutionId, data?.student])

  const groupedBySem = useMemo(() => {
    const map = new Map<number, NonNullable<Student360Response['history']>>()
    for (const row of data?.history ?? []) {
      const sem = Number(row.semester_number || 1)
      const list = map.get(sem) ?? []
      list.push(row)
      map.set(sem, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b)
  }, [data?.history])

  return (
    <div className="space-y-5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setActiveUsn(usnInput.trim().toUpperCase())
        }}
        className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Enter Student USN or Admission Number (e.g. 1AM25CS001)..."
            value={usnInput}
            onChange={(e) => setUsnInput(e.target.value.toUpperCase())}
            className="w-full rounded-md border border-slate-300 pl-9 pr-3 py-2 text-xs font-mono uppercase"
          />
        </div>
        <button
          type="submit"
          disabled={!usnInput.trim()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          Load 360° Dossier
        </button>
      </form>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-700">{(error as Error).message}</div>}
      {isLoading && <div className="py-10 text-center text-xs text-slate-500">Compiling semester-wise dossier...</div>}

      {data && !data.found && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">{data.reason}</div>
      )}

      {data?.found && data.student && data.metrics && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-5 grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
            <div className="md:col-span-2 flex justify-center">
              <div className="h-28 w-24 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
                {photoUrl ? (
                  <img src={photoUrl} alt={data.student.full_name} className="h-full w-full object-cover" />
                ) : (
                  <User className="h-10 w-10 text-slate-400" />
                )}
              </div>
            </div>
            <div className="md:col-span-6 space-y-1 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900">{data.student.full_name}</h2>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[10px] font-bold',
                    data.student.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                  )}
                >
                  {data.student.is_active ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
              <p className="font-mono font-bold text-indigo-800">{data.student.registration_number}</p>
              <p className="text-slate-600">
                <strong>Program:</strong> {data.student.program_type} · {data.student.program_name} ({data.student.program_code}) · Sem {data.student.current_sem}
              </p>
              <p className="text-slate-500">
                <strong>Email:</strong> {data.student.email || 'N/A'} | <strong>Phone:</strong> {data.student.phone || 'N/A'}
              </p>
            </div>
            <div className="md:col-span-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-indigo-50 border border-indigo-200 p-2.5">
                <p className="text-[10px] font-bold uppercase text-indigo-700">CGPA</p>
                <p className="text-xl font-extrabold text-indigo-950">{Number(data.metrics.cgpa).toFixed(2)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5">
                <p className="text-[10px] font-bold uppercase text-emerald-700">Credits</p>
                <p className="text-base font-extrabold text-emerald-900 mt-1">
                  {data.metrics.credits_earned}/{data.metrics.credits_attempted}
                </p>
              </div>
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5">
                <p className="text-[10px] font-bold uppercase text-rose-700">Backlogs</p>
                <p className="text-xl font-extrabold text-rose-900">{data.metrics.active_backlogs}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {groupedBySem.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                No exam records found for this student yet.
              </div>
            ) : (
              groupedBySem.map(([sem, rows]) => (
                <div key={sem} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-900">
                    Semester {sem} Academic History ({rows.length} entries)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2">Cycle</th>
                          <th className="px-3 py-2">Course</th>
                          <th className="px-3 py-2 text-center">Cr</th>
                          <th className="px-3 py-2 text-center">CIE</th>
                          <th className="px-3 py-2 text-center">SEE</th>
                          <th className="px-3 py-2 text-center">Total</th>
                          <th className="px-3 py-2 text-center">Grade</th>
                          <th className="px-3 py-2 text-center">Tags</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r, i) => (
                          <tr key={`${r.cycle_code}-${r.course_code}-${i}`} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-medium text-slate-700">{r.cycle_code}</td>
                            <td className="px-3 py-2">
                              <span className="font-mono font-bold text-indigo-900">{r.course_code}</span>
                              <p className="text-[11px] text-slate-500">{r.course_title}</p>
                            </td>
                            <td className="px-3 py-2 text-center">{r.credits}</td>
                            <td className="px-3 py-2 text-center">{r.cie_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-center">{r.see_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-center font-bold">{r.total_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-center font-bold text-indigo-700">{r.grade_code ?? '—'}</td>
                            <td className="px-3 py-2 text-center">
                              <div className="inline-flex gap-1">
                                <span
                                  className={cn(
                                    'rounded px-1.5 py-0.5 text-[10px] font-bold',
                                    r.result_status === 'PASS' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                  )}
                                >
                                  {r.result_status}
                                </span>
                                {r.has_reval && (
                                  <span className="rounded bg-blue-100 text-blue-800 px-1.5 py-0.5 text-[10px] font-bold">
                                    Reval
                                  </span>
                                )}
                                {r.has_grace && (
                                  <span className="rounded bg-purple-100 text-purple-800 px-1.5 py-0.5 text-[10px] font-bold">
                                    Graced
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
