import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileCheck2, Printer, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type { DutyNominationRow, EvaluationDutyRow, EvaluationDutyStatus } from '@/types/operations'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
} from '@/modules/exams/printBranding'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  nominations: DutyNominationRow[]
  canManage: boolean
}

export function EvaluationDutiesTab({
  institutionId,
  institutionName,
  cycle,
  nominations,
  canManage,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const [selectedCourseCode, setSelectedCourseCode] = useState('ALL')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: bundles = [] } = useQuery({
    queryKey: ['ops_eval_bundles', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_script_bundles')
        .select('id, course_id, effective_course_code, script_count, evaluator_staff_id')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
      if (error) throw error
      return data ?? []
    },
  })

  const { data: evalDuties = [] } = useQuery<EvaluationDutyRow[]>({
    queryKey: ['exam_evaluation_duties', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_evaluation_duties')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
        .order('course_code', { ascending: true })
        .order('fifo_rank', { ascending: true })
      if (error) throw error
      return (data ?? []) as EvaluationDutyRow[]
    },
  })

  const bundleStatsByCourse = useMemo(() => {
    const map = new Map<string, { bundles: number; scripts: number }>()
    for (const b of bundles) {
      const code = String(b.effective_course_code ?? '')
      const cur = map.get(code) ?? { bundles: 0, scripts: 0 }
      cur.bundles += 1
      cur.scripts += Number(b.script_count ?? 0)
      map.set(code, cur)
    }
    return map
  }, [bundles])

  const fifoNominees = useMemo(() => {
    return nominations
      .filter((n) => (n.duty_type === 'EVALUATION' || n.duty_type === 'BOTH') && Boolean(n.course_id && n.course_code))
      .filter((n) => selectedCourseCode === 'ALL' || n.course_code === selectedCourseCode)
      .sort((a, b) => new Date(a.nominated_at).getTime() - new Date(b.nominated_at).getTime())
  }, [nominations, selectedCourseCode])

  const courseOptions = useMemo(() => {
    const set = new Set<string>()
    for (const n of nominations) {
      if (n.course_code) set.add(n.course_code)
    }
    for (const d of evalDuties) set.add(d.course_code)
    return Array.from(set).sort()
  }, [nominations, evalDuties])

  const inviteEvaluatorMutation = useMutation({
    mutationFn: async ({ nom, rank }: { nom: DutyNominationRow; rank: number }) => {
      if (!cycle || !nom.course_id || !nom.course_code) throw new Error('Invalid course nomination.')
      const stats = bundleStatsByCourse.get(nom.course_code) ?? { bundles: 0, scripts: 0 }

      const { error } = await supabase.from('exam_evaluation_duties').upsert(
        {
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          course_id: nom.course_id,
          course_code: nom.course_code,
          staff_profile_id: nom.staff_profile_id,
          faculty_code: nom.faculty_code,
          faculty_name: nom.faculty_name,
          designation: nom.designation,
          department_name: nom.department_name,
          fifo_rank: rank,
          assigned_bundles_count: stats.bundles,
          assigned_scripts_count: stats.scripts,
          status: 'INVITED',
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        },
        { onConflict: 'exam_cycle_id,course_id,staff_profile_id' }
      )
      if (error) throw error

      // Auto-assign evaluator onto unassigned bundles for this course
      await supabase
        .from('exam_script_bundles')
        .update({
          evaluator_staff_id: nom.staff_profile_id,
          evaluator_name: nom.faculty_name,
          updated_by: session?.user.id ?? null,
        })
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle.id)
        .eq('course_id', nom.course_id)
        .is('evaluator_staff_id', null)

      return `${nom.faculty_name} for ${nom.course_code}`
    },
    onSuccess: (summary) => {
      setErrorMsg(null)
      setNotice(`Invited FIFO Evaluator: ${summary}.`)
      queryClient.invalidateQueries({ queryKey: ['exam_evaluation_duties', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['ops_eval_bundles', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Invite failed'),
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: EvaluationDutyStatus }) => {
      const { error } = await supabase
        .from('exam_evaluation_duties')
        .update({
          status,
          completed_at: status === 'COMPLETED' ? new Date().toISOString() : null,
          updated_by: session?.user.id ?? null,
        })
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam_evaluation_duties', institutionId, cycle?.id] })
    },
  })

  const printEvalOrder = async (duty: EvaluationDutyRow) => {
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigMap = await signPrivateAssets([branding.coe_signature_path])
    const coeSig = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null

    openBrandedPrintWindow({
      title: `Evaluation_Order_${duty.course_code}_${duty.faculty_code}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="padding:12px">
          ${renderBrandedHeaderHtml(branding, `OFFICIAL ANSWER SCRIPT EVALUATION ORDER — ${cycle?.code ?? ''}`)}
          <p style="text-align:right">Date: ${new Date().toLocaleDateString('en-IN')}</p>
          <p><strong>To,</strong><br/><strong>${escapeHtml(duty.faculty_name)}</strong> (${escapeHtml(duty.faculty_code)})<br/>${escapeHtml(duty.designation)}, Department of ${escapeHtml(duty.department_name)}</p>
          <p style="margin-top:14px;line-height:1.6">You are hereby appointed as an Answer Script Evaluator (FIFO Rank #${duty.fifo_rank}) for course <strong>${escapeHtml(duty.course_code)}</strong> (${duty.assigned_bundles_count} bundle(s) / ${duty.assigned_scripts_count} script(s)). Please report to the Central Valuation Center and adhere strictly to blind dummy-code evaluation guidelines.</p>
          <div class="signatures" style="margin-top:42px">
            <div class="sig-col"></div>
            ${renderSignatureBlockHtml('Controller of Examinations', coeSig)}
          </div>
        </div>
      </section>`,
    })
  }

  const assignedSet = new Set(evalDuties.map((d) => `${d.course_id}__${d.staff_profile_id}`))

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

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <FileCheck2 className="h-4 w-4 text-indigo-600" />
          FIFO Course Evaluation Queue ({fifoNominees.length} Nominated · {evalDuties.length} Assigned)
        </span>
        <select
          value={selectedCourseCode}
          onChange={(e) => setSelectedCourseCode(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
        >
          <option value="ALL">All Courses</option>
          {courseOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* FIFO Queue */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-800">
          1. Nominated Evaluators (Strict First-In First-Out Order)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2">FIFO #</th>
                <th className="px-4 py-2">Course &amp; Bundles</th>
                <th className="px-4 py-2">Nominated Faculty</th>
                <th className="px-4 py-2">Nominated At</th>
                <th className="px-4 py-2 text-right">COE Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fifoNominees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No evaluation nominations found. Add nominees in the Duty Nominations tab.
                  </td>
                </tr>
              ) : (
                fifoNominees.map((nom, idx) => {
                  const stats = nom.course_code ? bundleStatsByCourse.get(nom.course_code) : undefined
                  const already = assignedSet.has(`${nom.course_id}__${nom.staff_profile_id}`)
                  return (
                    <tr key={nom.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono font-bold text-indigo-700">#{idx + 1}</td>
                      <td className="px-4 py-2">
                        <span className="font-mono font-bold text-slate-900">{nom.course_code}</span>
                        <span className="ml-2 text-[11px] text-slate-500">
                          {stats ? `${stats.bundles} bundles (${stats.scripts} scripts)` : '0 bundles yet'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <p className="font-semibold text-slate-900">{nom.faculty_name}</p>
                        <p className="text-[11px] text-slate-500">
                          {nom.designation} · {nom.department_name}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {new Date(nom.nominated_at).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {already ? (
                          <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-[10px] font-semibold">
                            Assigned
                          </span>
                        ) : canManage ? (
                          <button
                            type="button"
                            disabled={inviteEvaluatorMutation.isPending}
                            onClick={() => inviteEvaluatorMutation.mutate({ nom, rank: idx + 1 })}
                            className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700"
                          >
                            Invite &amp; Assign <ArrowRight className="h-3 w-3" />
                          </button>
                        ) : (
                          <span className="text-slate-400">Queued</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assigned Evaluators */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-800">
          2. Active Evaluation Orders ({evalDuties.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2">Course</th>
                <th className="px-4 py-2">Evaluator</th>
                <th className="px-4 py-2">Load</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Order PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {evalDuties.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No evaluation orders issued yet.
                  </td>
                </tr>
              ) : (
                evalDuties.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono font-bold text-indigo-900">{d.course_code}</td>
                    <td className="px-4 py-2">
                      <span className="font-semibold text-slate-900">{d.faculty_name}</span>
                      <span className="ml-1.5 text-[11px] text-slate-500">({d.department_name})</span>
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {d.assigned_bundles_count} bundles · {d.assigned_scripts_count} scripts
                    </td>
                    <td className="px-4 py-2">
                      {canManage ? (
                        <select
                          value={d.status}
                          onChange={(e) =>
                            updateStatusMutation.mutate({
                              id: d.id,
                              status: e.target.value as EvaluationDutyStatus,
                            })
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold"
                        >
                          <option value="INVITED">INVITED</option>
                          <option value="ACCEPTED">ACCEPTED</option>
                          <option value="IN_PROGRESS">IN_PROGRESS</option>
                          <option value="COMPLETED">COMPLETED</option>
                          <option value="DECLINED">DECLINED</option>
                        </select>
                      ) : (
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold">{d.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => printEvalOrder(d)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Printer className="h-3 w-3" /> Order PDF
                      </button>
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
