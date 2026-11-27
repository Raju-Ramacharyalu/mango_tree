import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  UserPlus,
  Printer,
  FileSpreadsheet,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Lock,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type {
  IaDescriptiveQuestion,
  IaEncryptedEnvelope,
  IaOmrQuestion,
  IaQpAllocationRow,
  IaQpPattern,
} from '@/types/qpVault'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderWatermarkHtml,
} from '@/modules/exams/printBranding'
import { decryptIaEnvelopeWithCoePem, KATEX_PRINT_HEAD_HTML, renderMathToHtmlString } from './vaultCrypto'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  courses: Array<{ id: string; course_code: string; title: string; course_type: string }>
  staff: Array<{ id: string; employee_code: string; full_name: string; branch_label: string | null; department_label: string | null }>
  sectionTeacherMap: Map<string, string[]>
  allocations: IaQpAllocationRow[]
  coePrivateKeyPem: string
  canManage: boolean
}

export function IaVaultAllocationsTab({
  institutionId,
  institutionName,
  cycle,
  courses,
  staff,
  sectionTeacherMap,
  allocations,
  coePrivateKeyPem,
  canManage,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [iaNumber, setIaNumber] = useState<1 | 2 | 3>(1)
  const [courseId, setCourseId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [qpPattern, setQpPattern] = useState<IaQpPattern>('DESCRIPTIVE')
  const [numSets, setNumSets] = useState(1)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const selectedCourse = courses.find((c) => c.id === courseId) ?? null

  const sortedStaffForCourse = useMemo(() => {
    const teacherIds = new Set(selectedCourse ? (sectionTeacherMap.get(selectedCourse.course_code) ?? []) : [])
    const teachers = staff.filter((s) => teacherIds.has(s.id))
    const others = staff.filter((s) => !teacherIds.has(s.id))
    return { teachers, others }
  }, [selectedCourse, staff, sectionTeacherMap])

  const filteredAllocations = useMemo(
    () => allocations.filter((a) => a.ia_number === iaNumber),
    [allocations, iaNumber]
  )

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!cycle || !selectedCourse || !staffId) {
        throw new Error('Select Cycle, Course, and Faculty Member.')
      }
      const st = staff.find((s) => s.id === staffId)
      if (!st) throw new Error('Faculty not found.')

      const { error } = await supabase.from('ia_qp_allocations').upsert(
        {
          institution_id: institutionId,
          exam_cycle_id: cycle.id,
          course_id: selectedCourse.id,
          course_code: selectedCourse.course_code,
          staff_profile_id: st.id,
          faculty_code: st.employee_code,
          ia_number: iaNumber,
          num_sets: numSets,
          qp_pattern: qpPattern,
          max_marks: 50,
          duration_minutes: 90,
          status: 'DRAFT',
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        },
        { onConflict: 'institution_id,exam_cycle_id,course_id,ia_number,staff_profile_id' }
      )
      if (error) throw error
      return `${selectedCourse.course_code} → ${st.full_name} (${numSets} Set${numSets > 1 ? 's' : ''})`
    },
    onSuccess: (summary) => {
      setErrorMsg(null)
      setNotice(`Assigned IA-${iaNumber} setter: ${summary}.`)
      setStaffId('')
      queryClient.invalidateQueries({ queryKey: ['ia_qp_allocations', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Assignment failed'),
  })

  const unlockMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ia_qp_allocations')
        .update({ status: 'DRAFT', updated_by: session?.user.id ?? null })
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      setNotice('Returned submitted IA paper to DRAFT so faculty can edit with their 4-digit PIN.')
      queryClient.invalidateQueries({ queryKey: ['ia_qp_allocations', institutionId, cycle?.id] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ia_qp_allocations')
        .delete()
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      setNotice('Revoked IA QP allocation.')
      queryClient.invalidateQueries({ queryKey: ['ia_qp_allocations', institutionId, cycle?.id] })
    },
  })

  const decryptAndPrintIa = async (alloc: IaQpAllocationRow, setNum: number) => {
    setErrorMsg(null)
    if (!coePrivateKeyPem) {
      setErrorMsg('Vault Locked: Load your COE Private Key (.pem) in the Security Vault tab first.')
      return
    }
    if (!alloc.qp_content) {
      setErrorMsg('No encrypted content submitted yet.')
      return
    }

    try {
      const envelope = JSON.parse(alloc.qp_content) as IaEncryptedEnvelope
      const payload = decryptIaEnvelopeWithCoePem(envelope, coePrivateKeyPem)
      const list = payload.setsMap[setNum] ?? payload.setsMap[1] ?? []
      const isOmr = (payload.qpPattern || alloc.qp_pattern).startsWith('OMR')
      const setLetter = String.fromCharCode(64 + setNum)
      const branding = await fetchInstitutionBranding(institutionId, institutionName)

      let tableHtml = ''
      if (isOmr) {
        const mcqs = list as IaOmrQuestion[]
        tableHtml = `<table>
          <thead><tr><th style="width:40px;text-align:center">Q.No</th><th>Question &amp; Options (Darken A, B, C, or D on OMR)</th><th style="width:48px;text-align:center">Marks</th></tr></thead>
          <tbody>${mcqs
            .filter((q) => q.text?.trim())
            .map(
              (q) => `<tr>
                <td style="text-align:center;font-weight:700">${q.qNum}.</td>
                <td>
                  <div>${renderMathToHtmlString(q.text)}</div>
                  ${q.image ? `<img src="${escapeHtml(q.image)}" style="max-height:95px;margin:4px 0" alt="" />` : ''}
                  <div style="margin-top:4px;font-size:10.5px">
                    (A) ${renderMathToHtmlString(q.options.A)} &nbsp;&nbsp;
                    (B) ${renderMathToHtmlString(q.options.B)} &nbsp;&nbsp;
                    (C) ${renderMathToHtmlString(q.options.C)} &nbsp;&nbsp;
                    (D) ${renderMathToHtmlString(q.options.D)}
                  </div>
                </td>
                <td style="text-align:center">${escapeHtml(q.marks)}</td>
              </tr>`
            )
            .join('')}</tbody>
        </table>`
      } else {
        const qs = list as IaDescriptiveQuestion[]
        const rows: string[] = []
        qs.forEach((q, qIdx) => {
          const filled = (q.parts ?? []).filter((p) => p.text?.trim())
          filled.forEach((p, pIdx) => {
            rows.push(`<tr>
              <td style="text-align:center;font-weight:700">${pIdx === 0 ? `${q.qNum}.${p.id}` : p.id}</td>
              <td>
                <div>${renderMathToHtmlString(p.text)}</div>
                ${p.image ? `<img src="${escapeHtml(p.image)}" style="max-height:105px;margin-top:4px" alt="" />` : ''}
              </td>
              <td style="text-align:center">${escapeHtml(p.marks)}</td>
              <td style="text-align:center">${escapeHtml(p.co)}</td>
              <td style="text-align:center">${escapeHtml(p.blooms)}</td>
            </tr>`)
          })
          if (qIdx === 0 || qIdx === 2 || qIdx === 4) {
            rows.push(`<tr><td colspan="5" style="text-align:center;font-weight:700;background:#f8fafc">OR</td></tr>`)
          }
        })
        tableHtml = `<table>
          <thead><tr><th style="width:48px">Q.No</th><th>Question</th><th style="width:44px;text-align:center">Marks</th><th style="width:46px;text-align:center">CO</th><th style="width:46px;text-align:center">Level</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>`
      }

      const iaTitle =
        alloc.ia_number === 1
          ? 'INTERNAL ASSESSMENT – 1'
          : alloc.ia_number === 2
            ? 'INTERNAL ASSESSMENT – 2'
            : 'IMPROVEMENT INTERNAL ASSESSMENT'

      openBrandedPrintWindow({
        title: `IA${alloc.ia_number}_${alloc.course_code}_Set${setLetter}_FINAL`,
        landscape: false,
        branding,
        watermarkMode: 'fixed',
        headHtml: KATEX_PRINT_HEAD_HTML,
        bodyHtml: `
          ${renderWatermarkHtml(branding, 'per-page')}
          ${renderBrandedHeaderHtml(
            branding,
            `${iaTitle}${isOmr ? ' (OMR)' : ''}`,
            `Course: ${alloc.course_code} — ${alloc.course_title} (Set ${setLetter}) | Max Marks: ${alloc.max_marks} | Time: ${alloc.duration_minutes} mins`
          )}
          <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
            <table style="width:260px;margin:0"><tr><th style="width:44px;text-align:center">USN</th>${'<td></td>'.repeat(10)}</tr></table>
          </div>
          ${tableHtml}
        `,
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Decryption error')
    }
  }

  const exportOmrMasterKeyCsv = (alloc: IaQpAllocationRow) => {
    setErrorMsg(null)
    if (!coePrivateKeyPem) {
      setErrorMsg('Vault Locked: Load your COE Private Key (.pem) first.')
      return
    }
    if (!alloc.qp_content) return
    try {
      const envelope = JSON.parse(alloc.qp_content) as IaEncryptedEnvelope
      const payload = decryptIaEnvelopeWithCoePem(envelope, coePrivateKeyPem)
      const totalSets = Math.max(1, alloc.num_sets)
      const numQuestions = (payload.qpPattern || alloc.qp_pattern) === 'OMR_25' ? 25 : 50
      const headerCols = ['QNo', ...Array.from({ length: totalSets }, (_, i) => `Set_${String.fromCharCode(65 + i)}`)]
      const lines = [headerCols.join(',')]
      for (let qIdx = 0; qIdx < numQuestions; qIdx++) {
        const row = [String(qIdx + 1)]
        for (let s = 1; s <= totalSets; s++) {
          const list = (payload.setsMap[s] ?? []) as IaOmrQuestion[]
          row.push(list[qIdx]?.ans ?? 'A')
        }
        lines.push(row.join(','))
      }
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `OMR_Master_Key_${alloc.course_code}_IA${alloc.ia_number}_${alloc.faculty_code}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to extract OMR Key CSV')
    }
  }

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
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Assign Multi-Faculty IA Question Paper Setter (50 Marks / 90 mins)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2.5 text-xs items-end">
            <div>
              <label className="block font-medium text-slate-700 mb-1">IA Test</label>
              <select
                value={iaNumber}
                onChange={(e) => setIaNumber(Number(e.target.value) as 1 | 2 | 3)}
                className="w-full rounded border border-slate-300 px-2 py-1.5 font-semibold"
              >
                <option value={1}>IA – 1</option>
                <option value={2}>IA – 2</option>
                <option value={3}>Improvement IA</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Course</label>
              <select
                value={courseId}
                onChange={(e) => {
                  const id = e.target.value
                  setCourseId(id)
                  const c = courses.find((x) => x.id === id)
                  if (c && (c.course_type === 'OMR' || /1BKSK|1BKBK|1BENG|OMR/i.test(c.course_code))) {
                    setQpPattern('OMR_50')
                  } else {
                    setQpPattern('DESCRIPTIVE')
                  }
                }}
                className="w-full rounded border border-slate-300 px-2 py-1.5"
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
              <label className="block font-medium text-slate-700 mb-1">Faculty (Section Teachers First)</label>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-1.5"
              >
                <option value="">Select faculty...</option>
                {sortedStaffForCourse.teachers.length > 0 && (
                  <optgroup label="★ Assigned Section Teachers">
                    {sortedStaffForCourse.teachers.map((s) => (
                      <option key={s.id} value={s.id}>
                        ★ {s.full_name} ({s.employee_code})
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="All Institution Faculty">
                  {sortedStaffForCourse.others.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.employee_code})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Pattern / Sets</label>
              <div className="flex gap-1">
                <select
                  value={qpPattern}
                  onChange={(e) => setQpPattern(e.target.value as IaQpPattern)}
                  className="flex-1 rounded border border-slate-300 px-1.5 py-1.5"
                >
                  <option value="DESCRIPTIVE">Descriptive</option>
                  <option value="OMR_50">OMR 50×1M</option>
                  <option value="OMR_25">OMR 25×2M</option>
                </select>
                <select
                  value={numSets}
                  onChange={(e) => setNumSets(Number(e.target.value))}
                  className="w-16 rounded border border-slate-300 px-1.5 py-1.5"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}S
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <button
                type="button"
                disabled={assignMutation.isPending || !cycle}
                onClick={() => assignMutation.mutate()}
                className="w-full inline-flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vault List + COE .pem Print & OMR Key Export */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800">
            IA-{iaNumber} Encrypted Allocations ({filteredAllocations.length})
          </span>
          <span className={coePrivateKeyPem ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
            {coePrivateKeyPem ? '✓ COE Private Key Unlocked' : '🔒 Load .pem in Security Vault to Print / Export Keys'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Course</th>
                <th className="px-4 py-2.5">Assigned Faculty</th>
                <th className="px-4 py-2.5">Pattern &amp; Sets</th>
                <th className="px-4 py-2.5">Vault Status</th>
                <th className="px-4 py-2.5 text-right">COE Print / OMR Key CSV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAllocations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No IA-{iaNumber} question paper setters assigned for this cycle yet.
                  </td>
                </tr>
              ) : (
                filteredAllocations.map((a) => {
                  const isSubmitted = a.status === 'SUBMITTED'
                  const isOmr = a.qp_pattern.startsWith('OMR')
                  return (
                    <tr key={a.id} className={isSubmitted ? 'bg-emerald-50/40' : ''}>
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-bold text-indigo-900">{a.course_code}</span>
                        <p className="text-[11px] text-slate-500">{a.course_title}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-900">{a.faculty_name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{a.faculty_code}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-purple-50 text-purple-800 px-2 py-0.5 text-[10px] font-semibold">
                          {a.qp_pattern} · {a.num_sets} Set{a.num_sets > 1 ? 's' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {isSubmitted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-semibold">
                            <Lock className="h-3 w-3" /> Submitted in Vault
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold">
                            {a.qp_content ? 'Encrypted Draft' : 'Pending Draft'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                          {isSubmitted &&
                            Array.from({ length: a.num_sets }, (_, i) => i + 1).map((setNum) => (
                              <button
                                key={setNum}
                                type="button"
                                onClick={() => decryptAndPrintIa(a, setNum)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                              >
                                <Printer className="h-3 w-3" /> Set {String.fromCharCode(64 + setNum)}
                              </button>
                            ))}
                          {isSubmitted && isOmr && (
                            <button
                              type="button"
                              onClick={() => exportOmrMasterKeyCsv(a)}
                              className="inline-flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-purple-700"
                            >
                              <FileSpreadsheet className="h-3 w-3" /> Key CSV
                            </button>
                          )}
                          {canManage && isSubmitted && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm('Unlock and return to DRAFT for faculty corrections?')) {
                                  unlockMutation.mutate(a.id)
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900"
                            >
                              <RotateCcw className="h-3 w-3" /> Unlock
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Revoke ${a.course_code} assignment for ${a.faculty_name}?`)) {
                                  revokeMutation.mutate(a.id)
                                }
                              }}
                              className="rounded border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100"
                              title="Revoke"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
