import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { Scale, UploadCloud, Download, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { ExamCycle } from '@/types/exams'
import type { MarksAuditLogRow } from '@/types/analytics'
import { cn } from '@/utils/cn'

export function RevaluationEngineTab({
  institutionId,
  cycle,
  canProcess,
}: {
  institutionId: string
  cycle: ExamCycle | null
  canProcess: boolean
}) {
  const queryClient = useQueryClient()
  const [usn, setUsn] = useState('')
  const [courseCode, setCourseCode] = useState('')
  const [newRawMarks, setNewRawMarks] = useState('')
  const [evaluatorId, setEvaluatorId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: logs = [], isLoading } = useQuery<MarksAuditLogRow[]>({
    queryKey: ['marks_audit_log', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marks_audit_log')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) throw error
      return (data ?? []) as MarksAuditLogRow[]
    },
  })

  const singleMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an active Exam Cycle first.')
      const { data, error } = await supabase.rpc('process_revaluation_entry', {
        p_institution_id: institutionId,
        p_exam_cycle_id: cycle.id,
        p_usn: usn.trim().toUpperCase(),
        p_course_code: courseCode.trim().toUpperCase(),
        p_new_raw_marks: Number(newRawMarks),
        p_evaluator_id: evaluatorId.trim() || 'COE',
      })
      if (error) throw error
      return data as { upgraded: boolean; message: string }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setNotice(res.message)
      setUsn('')
      setNewRawMarks('')
      queryClient.invalidateQueries({ queryKey: ['marks_audit_log', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['cycle_analytics', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Revaluation failed'),
  })

  const handleBulkCsv = (file: File) => {
    if (!cycle) return
    setBulkBusy(true)
    setErrorMsg(null)
    setNotice(null)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (parsed) => {
        let upgrades = 0
        let unchanged = 0
        let errors = 0
        for (const row of parsed.data) {
          const norm: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) norm[k.trim().toLowerCase()] = String(v ?? '').trim()
          const rUsn = norm.usn
          const rCrs = norm.course_code
          const rMarks = Number(norm.new_marks)
          if (!rUsn || !rCrs || Number.isNaN(rMarks)) continue
          const { data, error } = await supabase.rpc('process_revaluation_entry', {
            p_institution_id: institutionId,
            p_exam_cycle_id: cycle.id,
            p_usn: rUsn,
            p_course_code: rCrs,
            p_new_raw_marks: rMarks,
            p_evaluator_id: norm.evaluator || 'BULK_UPLOAD',
          })
          if (error) errors += 1
          else if ((data as { upgraded?: boolean })?.upgraded) upgrades += 1
          else unchanged += 1
        }
        setBulkBusy(false)
        setNotice(`Bulk Revaluation Complete: ${upgrades} Upgraded, ${unchanged} Retained Original, ${errors} Errors.`)
        queryClient.invalidateQueries({ queryKey: ['marks_audit_log', institutionId, cycle.id] })
        queryClient.invalidateQueries({ queryKey: ['cycle_analytics', institutionId, cycle.id] })
      },
    })
  }

  const exportAuditCsv = () => {
    const lines = [
      'Timestamp,USN,Course_Code,Change_Type,Old_SEE,New_SEE,Old_Grade,New_Grade,Evaluator,Changed_By,Reason',
      ...logs.map(
        (l) =>
          `"${l.created_at}","${l.usn}","${l.course_code}","${l.change_type}",${l.old_see ?? ''},${l.new_see ?? ''},"${l.old_grade ?? ''}","${l.new_grade ?? ''}","${l.evaluator_id ?? ''}","${l.changed_by_label ?? ''}","${(l.reason ?? '').replace(/"/g, '""')}"`
      ),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Revaluation_Audit_Trail_${cycle?.code ?? 'Cycle'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!cycle) return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">Select an Exam Cycle in the sidebar.</div>

  return (
    <div className="space-y-5">
      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> {notice}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" /> {errorMsg}
        </div>
      )}

      {canProcess && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Scale className="h-4 w-4 text-indigo-600" /> Single Revaluation Entry (Best-of-Two Rule)
            </h3>
            <div className="grid grid-cols-2 gap-2.5">
              <input
                placeholder="Student USN *"
                value={usn}
                onChange={(e) => setUsn(e.target.value.toUpperCase())}
                className="rounded border border-slate-300 px-2.5 py-1.5 font-mono uppercase"
              />
              <input
                placeholder="Course Code *"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
                className="rounded border border-slate-300 px-2.5 py-1.5 font-mono uppercase"
              />
              <input
                type="number"
                min={0}
                max={100}
                placeholder="New Raw Marks (0-100) *"
                value={newRawMarks}
                onChange={(e) => setNewRawMarks(e.target.value)}
                className="rounded border border-slate-300 px-2.5 py-1.5"
              />
              <input
                placeholder="Evaluator ID / Name"
                value={evaluatorId}
                onChange={(e) => setEvaluatorId(e.target.value)}
                className="rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <button
              type="button"
              disabled={singleMutation.isPending || !usn.trim() || !courseCode.trim() || newRawMarks === ''}
              onClick={() => singleMutation.mutate()}
              className="rounded-md bg-indigo-600 px-4 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {singleMutation.isPending ? 'Processing...' : 'Apply Favorable Rule & Update SGPA'}
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">Bulk CSV Revaluation Upload</h3>
            <p className="text-slate-500">
              Columns: <code>usn, course_code, new_marks, evaluator</code>. Applies <code>ceil(raw/2)</code> scaling and UG/PG VTU passing thresholds atomically.
            </p>
            <label className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 cursor-pointer">
              <UploadCloud className="h-4 w-4" />
              {bulkBusy ? 'Processing CSV...' : 'Upload & Process Revaluation CSV'}
              <input
                type="file"
                accept=".csv"
                disabled={bulkBusy}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleBulkCsv(f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800">Legal Marks Audit Trail ({logs.length})</span>
          <button
            type="button"
            disabled={logs.length === 0}
            onClick={exportAuditCsv}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export Audit CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">USN &amp; Course</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2 text-center">SEE (Raw)</th>
                <th className="px-3 py-2 text-center">Grade</th>
                <th className="px-3 py-2">Evaluator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading audit trail...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No revaluation audits recorded for this cycle yet.</td></tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{new Date(l.created_at).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900">
                      {l.usn} · <span className="text-indigo-800">{l.course_code}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-bold',
                          l.change_type === 'REVAL_UPGRADE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        )}
                      >
                        {l.change_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {l.old_see ?? '—'} → <strong>{l.new_see ?? '—'}</strong>
                    </td>
                    <td className="px-3 py-2 text-center font-bold">
                      {l.old_grade ?? '—'} → <span className="text-indigo-700">{l.new_grade ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{l.evaluator_id ?? 'COE'}</td>
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
