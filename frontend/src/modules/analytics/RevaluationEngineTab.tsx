import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { Scale, UploadCloud, Download, CheckCircle2, AlertTriangle, Search } from 'lucide-react'
import { supabase, fetchAllRows } from '@/services/supabase'
import type { ExamCycle } from '@/types/exams'
import type { MarksAuditLogRow } from '@/types/analytics'
import { cn } from '@/utils/cn'

type AuditCategory = 'ALL' | 'REVALUATION' | 'MODERATION' | 'THIRD_VAL' | 'GRACE'

function classifyAuditType(changeType: string): Exclude<AuditCategory, 'ALL'> {
  const up = (changeType || '').toUpperCase()
  if (up.includes('GRACE')) return 'GRACE'
  if (up.includes('THIRD')) return 'THIRD_VAL'
  if (up.includes('MODERATION')) return 'MODERATION'
  return 'REVALUATION'
}

function getAuditBadgeStyle(changeType: string): string {
  const up = (changeType || '').toUpperCase()
  if (up.includes('GRACE')) {
    return up.includes('REVERT')
      ? 'bg-red-100 text-red-800 border border-red-200'
      : 'bg-teal-100 text-teal-800 border border-teal-200'
  }
  if (up.includes('THIRD')) {
    return up.includes('PENDING')
      ? 'bg-amber-100 text-amber-900 border border-amber-300'
      : 'bg-purple-100 text-purple-800 border border-purple-200'
  }
  if (up.includes('MODERATION')) {
    return up.includes('APPLIED')
      ? 'bg-blue-100 text-blue-800 border border-blue-200'
      : 'bg-slate-100 text-slate-600 border border-slate-200'
  }
  if (up.includes('UPGRADE') || up.includes('APPLIED')) {
    return 'bg-emerald-100 text-emerald-800 border border-emerald-200'
  }
  return 'bg-amber-50 text-amber-800 border border-amber-200'
}

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
  const [categoryFilter, setCategoryFilter] = useState<AuditCategory>('ALL')
  const [auditSearch, setAuditSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: logs = [], isLoading } = useQuery<MarksAuditLogRow[]>({
    queryKey: ['marks_audit_log', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      return fetchAllRows<MarksAuditLogRow>((from, to) =>
        supabase
          .from('marks_audit_log')
          .select('*')
          .eq('institution_id', institutionId)
          .eq('exam_cycle_id', cycle!.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
      )
    },
  })

  const categoryCounts = useMemo(() => {
    const counts: Record<AuditCategory, number> = {
      ALL: logs.length,
      REVALUATION: 0,
      MODERATION: 0,
      THIRD_VAL: 0,
      GRACE: 0,
    }
    for (const l of logs) {
      counts[classifyAuditType(l.change_type)] += 1
    }
    return counts
  }, [logs])

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase()
    return logs.filter((l) => {
      if (categoryFilter !== 'ALL' && classifyAuditType(l.change_type) !== categoryFilter) return false
      if (q) {
        const hay = `${l.usn} ${l.course_code} ${l.change_type} ${l.evaluator_id ?? ''} ${l.reason ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [logs, categoryFilter, auditSearch])

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
      ...filteredLogs.map(
        (l) =>
          `"${l.created_at}","${l.usn}","${l.course_code}","${l.change_type}",${l.old_see ?? ''},${l.new_see ?? ''},"${l.old_grade ?? ''}","${l.new_grade ?? ''}","${l.evaluator_id ?? ''}","${l.changed_by_label ?? ''}","${(l.reason ?? '').replace(/"/g, '""')}"`
      ),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Marks_Audit_Trail_${cycle?.code ?? 'Cycle'}_${categoryFilter}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!cycle) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
        Select an Exam Cycle above to manage Revaluation and inspect the Marks Audit Trail.
      </div>
    )
  }

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
        <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-800">
              Legal Marks Audit Trail ({filteredLogs.length} of {logs.length})
            </span>
            <button
              type="button"
              disabled={filteredLogs.length === 0}
              onClick={exportAuditCsv}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> Export Filtered CSV
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'REVALUATION', label: 'Revaluation' },
                  { id: 'MODERATION', label: 'Moderation' },
                  { id: 'THIRD_VAL', label: '3rd Valuation' },
                  { id: 'GRACE', label: 'Grace' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategoryFilter(tab.id)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                    categoryFilter === tab.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100'
                  )}
                >
                  {tab.label} ({categoryCounts[tab.id]})
                </button>
              ))}
            </div>

            <div className="relative min-w-[210px]">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                placeholder="Filter USN, course, reason..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white pl-8 pr-2.5 py-1 text-xs"
              />
            </div>
          </div>
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
                <th className="px-3 py-2">Evaluator / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading audit trail...</td></tr>
              ) : filteredLogs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No audit entries match the current filter.</td></tr>
              ) : (
                filteredLogs.slice(0, 500).map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {l.usn} · <span className="text-indigo-800">{l.course_code}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap',
                          getAuditBadgeStyle(l.change_type)
                        )}
                      >
                        {l.change_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono whitespace-nowrap">
                      {l.old_see ?? '—'} → <strong>{l.new_see ?? '—'}</strong>
                    </td>
                    <td className="px-3 py-2 text-center font-bold whitespace-nowrap">
                      {l.old_grade ?? '—'} → <span className="text-indigo-700">{l.new_grade ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <span className="font-medium text-slate-800">{l.evaluator_id ?? 'COE'}</span>
                      {l.reason && <p className="text-[10px] text-slate-500 truncate max-w-[260px]" title={l.reason}>{l.reason}</p>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {filteredLogs.length > 500 && (
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 text-center">
              Showing first 500 of {filteredLogs.length} matching records. Use search or Export Filtered CSV for the full list.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
