import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { ExamCycle } from '@/types/exams'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
}

type MisSubTab = 'BOE' | 'IA_QP' | 'CIE' | 'DUTIES'

interface ComplianceRow {
  groupLabel: string
  total: number
  completed: number
  pending: number
  pct: number
}

export function MisComplianceTab({ institutionId, cycle }: Props) {
  const [subTab, setSubTab] = useState<MisSubTab>('BOE')

  const { data, isLoading } = useQuery({
    queryKey: ['mis_compliance_4tab', institutionId, cycle?.id],
    enabled: Boolean(institutionId),
    queryFn: async () => {
      const [boeRes, iaQpRes, cieRes, dutyNomRes, invigRes, evalRes] = await Promise.all([
        cycle?.id
          ? supabase
              .from('boe_nominations')
              .select('department_name, is_selected, is_received')
              .eq('institution_id', institutionId)
              .eq('exam_cycle_id', cycle.id)
          : Promise.resolve({ data: [], error: null }),
        cycle?.id
          ? supabase
              .from('ia_qp_allocations')
              .select('ia_number, course_code, status')
              .eq('institution_id', institutionId)
              .eq('exam_cycle_id', cycle.id)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('cie_submissions')
          .select('semester_number, status, programs(code)')
          .eq('institution_id', institutionId),
        cycle?.id
          ? supabase
              .from('exam_duty_nominations')
              .select('department_name, duty_type')
              .eq('institution_id', institutionId)
              .eq('exam_cycle_id', cycle.id)
          : Promise.resolve({ data: [], error: null }),
        cycle?.id
          ? supabase
              .from('exam_invigilation_duties')
              .select('department_name, duty_role')
              .eq('institution_id', institutionId)
              .eq('exam_cycle_id', cycle.id)
          : Promise.resolve({ data: [], error: null }),
        cycle?.id
          ? supabase
              .from('exam_evaluation_duties')
              .select('department_name, status')
              .eq('institution_id', institutionId)
              .eq('exam_cycle_id', cycle.id)
          : Promise.resolve({ data: [], error: null }),
      ])

      const aggregate = (items: Array<{ group: string; done: boolean }>): ComplianceRow[] => {
        const map = new Map<string, { total: number; completed: number }>()
        for (const it of items) {
          const cur = map.get(it.group) ?? { total: 0, completed: 0 }
          cur.total += 1
          if (it.done) cur.completed += 1
          map.set(it.group, cur)
        }
        return Array.from(map.entries())
          .map(([groupLabel, v]) => ({
            groupLabel,
            total: v.total,
            completed: v.completed,
            pending: v.total - v.completed,
            pct: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0,
          }))
          .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel))
      }

      const boeRows = aggregate(
        (boeRes.data ?? []).map((r) => ({
          group: String(r.department_name || 'General'),
          done: Boolean(r.is_selected),
        }))
      )

      const iaQpRows = aggregate(
        (iaQpRes.data ?? []).map((r) => ({
          group: `IA-${r.ia_number}`,
          done: r.status === 'SUBMITTED',
        }))
      )

      const cieRows = aggregate(
        (cieRes.data ?? []).map((r) => {
          const p = Array.isArray(r.programs) ? r.programs[0] : r.programs
          return {
            group: `${(p as { code?: string } | null)?.code ?? 'GEN'} · Sem ${r.semester_number}`,
            done: r.status === 'APPROVED',
          }
        })
      )

      const dutyDeptMap = new Map<string, { nom: number; assigned: number }>()
      for (const n of dutyNomRes.data ?? []) {
        const d = String(n.department_name || 'General')
        const cur = dutyDeptMap.get(d) ?? { nom: 0, assigned: 0 }
        cur.nom += 1
        dutyDeptMap.set(d, cur)
      }
      for (const inv of invigRes.data ?? []) {
        const d = String(inv.department_name || 'General')
        const cur = dutyDeptMap.get(d) ?? { nom: 0, assigned: 0 }
        cur.assigned += 1
        dutyDeptMap.set(d, cur)
      }
      for (const ev of evalRes.data ?? []) {
        const d = String(ev.department_name || 'General')
        const cur = dutyDeptMap.get(d) ?? { nom: 0, assigned: 0 }
        cur.assigned += 1
        dutyDeptMap.set(d, cur)
      }
      const dutyRows: ComplianceRow[] = Array.from(dutyDeptMap.entries())
        .map(([groupLabel, v]) => {
          const denom = Math.max(v.nom, v.assigned, 1)
          const pct = Math.min(100, Math.round((v.assigned / denom) * 100))
          return {
            groupLabel,
            total: v.nom,
            completed: v.assigned,
            pending: Math.max(0, v.nom - v.assigned),
            pct,
          }
        })
        .sort((a, b) => a.groupLabel.localeCompare(b.groupLabel))

      return { BOE: boeRows, IA_QP: iaQpRows, CIE: cieRows, DUTIES: dutyRows }
    },
  })

  const activeRows = data?.[subTab] ?? []
  const totalItems = activeRows.reduce((s, r) => s + r.total, 0)
  const totalDone = activeRows.reduce((s, r) => s + r.completed, 0)
  const overallPct = totalItems > 0 ? Math.min(100, Math.round((totalDone / totalItems) * 100)) : 0

  const exportCsv = () => {
    const lines = [
      'Group,Total,Completed_Or_Approved,Pending,Compliance_Pct',
      ...activeRows.map((r) => `"${r.groupLabel.replace(/"/g, '""')}",${r.total},${r.completed},${r.pending},${r.pct}%`),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `MIS_Compliance_${subTab}_${cycle?.code ?? 'ALL'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
          {(
            [
              { id: 'BOE', label: '1. BOE Nominations' },
              { id: 'IA_QP', label: '2. IA QP Vault' },
              { id: 'CIE', label: '3. Verified CIE Marks' },
              { id: 'DUTIES', label: '4. Exam Duties' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={cn(
                'rounded px-3 py-1.5 font-medium transition',
                subTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={activeRows.length === 0}
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Export MIS CSV
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Tracked Records</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalItems}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Completed / Approved</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{totalDone}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Overall Compliance Rate</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1">{overallPct}%</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs font-semibold text-slate-800">
          <BarChart3 className="h-4 w-4 text-indigo-600" />
          Department / Unit Breakdown ({cycle?.code ?? 'All Cycles'})
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Department / Group</th>
                <th className="px-4 py-2.5 text-center">Total</th>
                <th className="px-4 py-2.5 text-center">Completed</th>
                <th className="px-4 py-2.5 text-center">Pending</th>
                <th className="px-4 py-2.5 w-52">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Computing MIS telemetry...
                  </td>
                </tr>
              ) : activeRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No compliance records recorded in this category for the selected cycle yet.
                  </td>
                </tr>
              ) : (
                activeRows.map((r) => (
                  <tr key={r.groupLabel} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{r.groupLabel}</td>
                    <td className="px-4 py-2.5 text-center">{r.total}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-emerald-700">{r.completed}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-amber-700">{r.pending}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              r.pct >= 80 ? 'bg-emerald-500' : r.pct >= 40 ? 'bg-amber-500' : 'bg-rose-500'
                            )}
                            style={{ width: `${r.pct}%` }}
                          />
                        </div>
                        <span className="w-9 text-right font-mono font-bold text-slate-700">{r.pct}%</span>
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
