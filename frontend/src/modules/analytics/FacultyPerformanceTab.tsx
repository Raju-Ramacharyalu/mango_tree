import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Papa from 'papaparse'
import { UploadCloud, Download, RotateCcw } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { ExamCycle } from '@/types/exams'
import type { FacultyPerfRpcResponse, FacultyPerfSummaryRow } from '@/types/analytics'
import { cn } from '@/utils/cn'

export function FacultyPerformanceTab({
  institutionId,
  cycle,
}: {
  institutionId: string
  cycle: ExamCycle | null
}) {
  const [csvRows, setCsvRows] = useState<FacultyPerfSummaryRow[] | null>(null)
  const [matchInfo, setMatchInfo] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data, isLoading } = useQuery<FacultyPerfRpcResponse>({
    queryKey: ['faculty_performance', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data: res, error } = await supabase.rpc('get_faculty_performance_data', {
        p_institution_id: institutionId,
        p_exam_cycle_id: cycle!.id,
      })
      if (error) throw error
      return res as FacultyPerfRpcResponse
    },
  })

  const handleCsvUpload = (file: File) => {
    setErrorMsg(null)
    if (!data?.raw_results?.length) {
      setErrorMsg('No database results found for this cycle to match against.')
      return
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const resMap = new Map<string, { is_pass: boolean; is_attended: boolean }>()
        for (const r of data.raw_results) {
          resMap.set(`${r.usn}__${r.course_code}`, { is_pass: r.is_pass, is_attended: r.is_attended })
        }

        const groups = new Map<string, { faculty_name: string; course_code: string; reg: number; att: number; pas: number }>()
        let matched = 0

        for (const row of parsed.data) {
          const norm: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) norm[k.trim().toLowerCase()] = String(v ?? '').trim()
          const usn = (norm.usn || '').toUpperCase()
          const course = (norm.course_code || '').toUpperCase()
          const fac = norm.faculty_name || ''
          if (!usn || !course || !fac) continue

          const hit = resMap.get(`${usn}__${course}`)
          if (!hit) continue
          matched += 1

          const key = `${fac}__${course}`
          const cur = groups.get(key) ?? { faculty_name: fac, course_code: course, reg: 0, att: 0, pas: 0 }
          cur.reg += 1
          if (hit.is_attended) cur.att += 1
          if (hit.is_pass) cur.pas += 1
          groups.set(key, cur)
        }

        if (matched === 0) {
          setErrorMsg('Mismatch: No rows matched DB USNs and Course Codes. Ensure CSV headers are usn, course_code, faculty_name.')
          return
        }

        const summary: FacultyPerfSummaryRow[] = Array.from(groups.values())
          .map((g) => ({
            faculty_name: g.faculty_name,
            course_code: g.course_code,
            registered: g.reg,
            attended: g.att,
            passed: g.pas,
            pass_pct: g.att > 0 ? Math.round((g.pas / g.att) * 10000) / 100 : 0,
          }))
          .sort((a, b) => a.course_code.localeCompare(b.course_code) || b.pass_pct - a.pass_pct)

        setCsvRows(summary)
        setMatchInfo(`CSV Override Active: matched ${matched} student records across ${summary.length} faculty-course pairs.`)
      },
    })
  }

  const activeRows = csvRows ?? data?.auto_summary ?? []

  const exportCsv = () => {
    const lines = [
      'Faculty_Name,Course_Code,Registered,Attended,Passed,Pass_Percentage',
      ...activeRows.map(
        (r) => `"${r.faculty_name.replace(/"/g, '""')}",${r.course_code},${r.registered},${r.attended},${r.passed},${r.pass_pct}`
      ),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Faculty_Performance_${cycle?.code ?? 'Cycle'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!cycle) return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">Select an Exam Cycle in the sidebar.</div>

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <p className="font-semibold text-slate-900">
            {csvRows ? 'Custom CSV Mapping Mode' : 'Live Section Allocation Mode (Automatic)'}
          </p>
          <p className="text-slate-500">
            Pass % excludes AB/NE absentees. Upload an optional CSV (<code>usn, course_code, faculty_name</code>) to override.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 cursor-pointer">
            <UploadCloud className="h-3.5 w-3.5" /> Upload Mapping CSV
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleCsvUpload(f)
                e.target.value = ''
              }}
            />
          </label>
          {csvRows && (
            <button
              type="button"
              onClick={() => {
                setCsvRows(null)
                setMatchInfo(null)
              }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Use Live DB
            </button>
          )}
          <button
            type="button"
            disabled={activeRows.length === 0}
            onClick={exportCsv}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {matchInfo && <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">{matchInfo}</div>}
      {errorMsg && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{errorMsg}</div>}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-2.5">Faculty Name</th>
                <th className="px-4 py-2.5">Course</th>
                <th className="px-4 py-2.5 text-center">Registered</th>
                <th className="px-4 py-2.5 text-center">Attended</th>
                <th className="px-4 py-2.5 text-center">Passed</th>
                <th className="px-4 py-2.5 w-52">Pass (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">Computing faculty pass rates...</td>
                </tr>
              ) : activeRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No matched records yet. Map sections in BOS &amp; CIE or upload a mapping CSV.
                  </td>
                </tr>
              ) : (
                activeRows.map((r, i) => (
                  <tr key={`${r.faculty_name}-${r.course_code}-${i}`} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{r.faculty_name}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-indigo-900">{r.course_code}</td>
                    <td className="px-4 py-2.5 text-center">{r.registered}</td>
                    <td className="px-4 py-2.5 text-center">{r.attended}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-emerald-700">{r.passed}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              r.pass_pct >= 80 ? 'bg-emerald-500' : r.pass_pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                            )}
                            style={{ width: `${Math.min(100, r.pass_pct)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-mono font-bold text-slate-800">{r.pass_pct.toFixed(1)}%</span>
                      </div>
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
