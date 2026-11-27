import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, Lock, CheckSquare, FileSpreadsheet, AlertTriangle } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { BoeNominationRow, SeeDecryptedPayload, SeeOmrItem, SeeQuestionBlock, SeeSubmittedPaperRow } from '@/types/qpVault'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderWatermarkHtml,
} from '@/modules/exams/printBranding'
import { decryptSeeEnvelopeWithCoePem, KATEX_PRINT_HEAD_HTML, renderMathToHtmlString } from './vaultCrypto'

interface Props {
  institutionId: string
  institutionName: string
  nominations: BoeNominationRow[]
  submittedPapers: SeeSubmittedPaperRow[]
  coePrivateKeyPem: string
}

function shuffleOmrByVersion(items: SeeOmrItem[], version: 'A' | 'B' | 'C' | 'D'): SeeOmrItem[] {
  if (version === 'B') return [...items.slice(15), ...items.slice(0, 15)]
  if (version === 'C') return [...items.slice(30), ...items.slice(0, 30)]
  if (version === 'D') return [...items.slice(40), ...items.slice(0, 40)]
  return items
}

export function SeeProgressTab({
  institutionId,
  institutionName,
  nominations,
  submittedPapers,
  coePrivateKeyPem,
}: Props) {
  const queryClient = useQueryClient()
  const [omrVersion, setOmrVersion] = useState<'A' | 'B' | 'C' | 'D'>('A')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const toggleReceivedMutation = useMutation({
    mutationFn: async ({ id, nextVal }: { id: string; nextVal: boolean }) => {
      const { error } = await supabase
        .from('boe_nominations')
        .update({ is_received: nextVal })
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boe_nominations', institutionId] })
    },
  })

  const decryptAndPrintSee = async (paper: SeeSubmittedPaperRow, mode: 'QP' | 'SCHEME') => {
    setErrorMsg(null)
    if (!coePrivateKeyPem) {
      setErrorMsg('Vault Locked: Load your COE Private Key (.pem) in the Security Vault tab first.')
      return
    }

    try {
      const decrypted: SeeDecryptedPayload = decryptSeeEnvelopeWithCoePem(
        paper.encrypted_aes_key,
        paper.encrypted_payload,
        coePrivateKeyPem
      )
      const branding = await fetchInstitutionBranding(institutionId, institutionName)

      let bodyInner = ''
      if (decrypted.format === 'OMR') {
        const rawList = Object.values((decrypted.questions ?? {}) as Record<string, SeeOmrItem>).filter(
          (q) => q && q.text?.trim()
        )
        const list = shuffleOmrByVersion(rawList, omrVersion)
        if (mode === 'SCHEME') {
          bodyInner = `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;border:1.5px solid #1e293b;padding:12px">
            ${list
              .map((q, idx) => `<div style="border-bottom:1px solid #cbd5e1;padding:3px"><strong>${idx + 1}.</strong> ${escapeHtml(q.answer)}</div>`)
              .join('')}
          </div>`
        } else {
          bodyInner = list
            .map(
              (q, idx) => `<div style="margin-bottom:10px;page-break-inside:avoid">
                <div><strong>${idx + 1}.</strong> ${renderMathToHtmlString(q.text)}</div>
                ${q.image ? `<img src="${escapeHtml(q.image)}" style="max-height:110px;margin:4px 0" alt="" />` : ''}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-left:16px;margin-top:3px">
                  <div><strong>A)</strong> ${renderMathToHtmlString(q.optA)}</div>
                  <div><strong>B)</strong> ${renderMathToHtmlString(q.optB)}</div>
                  <div><strong>C)</strong> ${renderMathToHtmlString(q.optC)}</div>
                  <div><strong>D)</strong> ${renderMathToHtmlString(q.optD)}</div>
                </div>
              </div>`
            )
            .join('')
        }
      } else if (decrypted.format === 'STANDARD' && decrypted.modules) {
        const rows: string[] = []
        Object.entries(decrypted.modules).forEach(([, mod], idx) => {
          rows.push(
            `<tr style="background:#f1f5f9"><td colspan="5" style="text-align:center;font-weight:700">Module - ${idx + 1}</td></tr>`
          )
          const renderQ = (qNum: number, block: SeeQuestionBlock) => {
            ;(['a', 'b', 'c'] as const).forEach((sub, sIdx) => {
              const item = block[sub]
              if (!item || !item.text?.trim()) return
              rows.push(`<tr>
                <td style="text-align:center;font-weight:700">${sIdx === 0 ? `Q${qNum}.${sub}` : sub}</td>
                <td>
                  <div>${renderMathToHtmlString(item.text)}</div>
                  ${item.image ? `<img src="${escapeHtml(item.image)}" style="max-height:110px;margin-top:4px" alt="" />` : ''}
                  ${mode === 'SCHEME' && item.scheme ? `<div style="margin-top:6px;padding:6px;background:#f0fdf4;border-left:3px solid #16a34a"><strong>Solution:</strong> ${renderMathToHtmlString(item.scheme)}</div>` : ''}
                </td>
                <td style="text-align:center">${escapeHtml(item.marks)}</td>
                <td style="text-align:center">${escapeHtml(item.bloom)}</td>
                <td style="text-align:center">${escapeHtml(item.co)}</td>
              </tr>`)
            })
          }
          renderQ(idx * 2 + 1, mod.q1)
          rows.push(`<tr><td colspan="5" style="text-align:center;font-weight:700;background:#fafafa">OR</td></tr>`)
          renderQ(idx * 2 + 2, mod.q2)
        })
        bodyInner = `<table><thead><tr><th style="width:48px">Q.No</th><th>Question ${mode === 'SCHEME' ? '& Scheme' : ''}</th><th style="width:42px;text-align:center">M</th><th style="width:42px;text-align:center">L</th><th style="width:46px;text-align:center">CO</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
      } else if (decrypted.format === 'MBA' && decrypted.questions) {
        const rows: string[] = []
        Object.entries(decrypted.questions as Record<string, SeeQuestionBlock>).forEach(([, block], idx) => {
          ;(['a', 'b', 'c'] as const).forEach((sub, sIdx) => {
            const item = block[sub]
            if (!item || !item.text?.trim()) return
            rows.push(`<tr>
              <td style="text-align:center;font-weight:700">${sIdx === 0 ? `Q${idx + 1}.${sub}` : sub}</td>
              <td>
                <div>${renderMathToHtmlString(item.text)}</div>
                ${mode === 'SCHEME' && item.scheme ? `<div style="margin-top:6px;padding:6px;background:#f0fdf4;border-left:3px solid #16a34a"><strong>Solution:</strong> ${renderMathToHtmlString(item.scheme)}</div>` : ''}
              </td>
              <td style="text-align:center">${escapeHtml(item.marks)}</td>
              <td style="text-align:center">${escapeHtml(item.bloom)}</td>
              <td style="text-align:center">${escapeHtml(item.co)}</td>
            </tr>`)
          })
        })
        bodyInner = `<table><thead><tr><th style="width:48px">Q.No</th><th>Question</th><th style="width:42px">M</th><th style="width:42px">L</th><th style="width:46px">CO</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
      }

      openBrandedPrintWindow({
        title: `${paper.course_code}_${mode}${decrypted.format === 'OMR' ? `_V${omrVersion}` : ''}`,
        landscape: false,
        branding,
        watermarkMode: 'fixed',
        headHtml: KATEX_PRINT_HEAD_HTML,
        bodyHtml: `
          ${renderWatermarkHtml(branding, 'per-page')}
          ${renderBrandedHeaderHtml(
            branding,
            `${mode === 'SCHEME' ? 'SCHEME OF EVALUATION' : 'SEMESTER END EXAMINATION'} — ${paper.course_code}${decrypted.format === 'OMR' ? ` (VERSION ${omrVersion})` : ''}`,
            `Time: ${decrypted.format === 'OMR' ? '02 Hours' : '03 Hours'} | Max Marks: ${decrypted.format === 'OMR' ? '50' : '100'}`
          )}
          ${bodyInner}
        `,
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Decryption failed')
    }
  }

  const exportSeeOmrKeyCsv = (paper: SeeSubmittedPaperRow) => {
    setErrorMsg(null)
    if (!coePrivateKeyPem) {
      setErrorMsg('Vault Locked: Load your COE Private Key (.pem) first.')
      return
    }
    try {
      const decrypted = decryptSeeEnvelopeWithCoePem(
        paper.encrypted_aes_key,
        paper.encrypted_payload,
        coePrivateKeyPem
      )
      const rawList = Object.values((decrypted.questions ?? {}) as Record<string, SeeOmrItem>).filter(
        (q) => q && q.text?.trim()
      )
      const vA = shuffleOmrByVersion(rawList, 'A')
      const vB = shuffleOmrByVersion(rawList, 'B')
      const vC = shuffleOmrByVersion(rawList, 'C')
      const vD = shuffleOmrByVersion(rawList, 'D')
      const lines = ['QNo,Set_A,Set_B,Set_C,Set_D']
      for (let i = 0; i < rawList.length; i++) {
        lines.push(`${i + 1},${vA[i]?.answer ?? 'A'},${vB[i]?.answer ?? 'A'},${vC[i]?.answer ?? 'A'},${vD[i]?.answer ?? 'A'}`)
      }
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SEE_OMR_Master_Key_${paper.course_code}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Key export failed')
    }
  }

  const approvedSetters = nominations.filter((n) => n.is_selected)

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          {errorMsg}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-800 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-indigo-600" />
            SEE Question Paper Receipt &amp; Zero-Trust Decryption ({approvedSetters.length} Approved Setters)
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">OMR Print Version:</span>
            {(['A', 'B', 'C', 'D'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setOmrVersion(v)}
                className={
                  omrVersion === v
                    ? 'rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white'
                    : 'rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600'
                }
              >
                V-{v}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Course</th>
                <th className="px-4 py-2.5">Setter</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Decrypt / Manual Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {approvedSetters.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No COE-approved setters for this cycle yet. Approve setters in BOE Appointments first.
                  </td>
                </tr>
              ) : (
                approvedSetters.map((nom) => {
                  const sub = submittedPapers.find((p) => p.nomination_id === nom.id)
                  const statusLabel = sub
                    ? `Sealed & Submitted (${sub.paper_format})`
                    : nom.is_received
                      ? 'Received (Handwritten / Manual)'
                      : 'Drafting in Progress'
                  return (
                    <tr key={nom.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-bold text-indigo-900">{nom.course_code}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-900">{nom.setter_name}</p>
                        <p className="text-[11px] text-slate-500">{nom.email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            sub || nom.is_received
                              ? 'rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-[11px] font-semibold'
                              : 'rounded-full bg-amber-50 text-amber-800 px-2.5 py-0.5 text-[11px] font-semibold'
                          }
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {sub ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => decryptAndPrintSee(sub, 'QP')}
                              className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700"
                            >
                              <Lock className="h-3 w-3" /> Decrypt QP
                            </button>
                            <button
                              type="button"
                              onClick={() => decryptAndPrintSee(sub, 'SCHEME')}
                              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                            >
                              <Lock className="h-3 w-3" /> Scheme
                            </button>
                            {sub.paper_format === 'OMR' && (
                              <button
                                type="button"
                                onClick={() => exportSeeOmrKeyCsv(sub)}
                                className="inline-flex items-center gap-1 rounded bg-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-purple-700"
                              >
                                <FileSpreadsheet className="h-3 w-3" /> Key CSV
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              toggleReceivedMutation.mutate({ id: nom.id, nextVal: !nom.is_received })
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <CheckSquare className="h-3 w-3" />
                            {nom.is_received ? 'Revoke Receipt' : 'Mark Handwritten Received'}
                          </button>
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
    </div>
  )
}
