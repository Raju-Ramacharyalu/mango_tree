import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  KeyRound,
  Lock,
  Save,
  Send,
  Printer,
  Library,
  Shuffle,
  Download,
  Upload,
  Sigma,
  X,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import Papa from 'papaparse'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  IaDescriptiveQuestion,
  IaEncryptedEnvelope,
  IaOmrQuestion,
  IaQpAllocationRow,
  IaQpPattern,
  IaQuestionSet,
  PlatformLatexEquation,
} from '@/types/qpVault'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderWatermarkHtml,
} from '@/modules/exams/printBranding'
import {
  compressDiagramToDataUrl,
  decryptIaEnvelopeWithPin,
  encryptIaEnvelope,
  KATEX_PRINT_HEAD_HTML,
  renderMathToHtmlString,
} from './vaultCrypto'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  institutionName: string
  publicKeyPem: string | null
  allocations: IaQpAllocationRow[]
}

const SYMBOLS = [
  { label: 'a/b', snippet: '$\\frac{a}{b}$' },
  { label: '√x', snippet: '$\\sqrt{x}$' },
  { label: 'xⁿ', snippet: '$x^{n}$' },
  { label: '∫', snippet: '$\\int_{a}^{b} f(x)\\,dx$' },
  { label: '∑', snippet: '$\\sum_{i=1}^{n}$' },
  { label: '[Matrix]', snippet: '$\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$' },
  { label: 'α', snippet: 'α' },
  { label: 'β', snippet: 'β' },
  { label: 'θ', snippet: 'θ' },
  { label: 'λ', snippet: 'λ' },
  { label: 'Ω', snippet: 'Ω' },
  { label: '≤', snippet: '≤' },
  { label: '≥', snippet: '≥' },
  { label: '±', snippet: '±' },
  { label: '→', snippet: '→' },
]

function blankDescriptive(iaNum: number): IaDescriptiveQuestion[] {
  return [1, 2, 3, 4, 5, 6].map((qNum) => {
    const targetMarks = qNum <= 4 ? 20 : 10
    const defaultCo = qNum <= 2 ? (iaNum === 2 ? 'CO4' : 'CO1') : qNum <= 4 ? (iaNum === 2 ? 'CO5' : 'CO2') : 'CO3'
    return targetMarks === 20
      ? {
          qNum,
          targetMarks,
          parts: [
            { id: 'a', text: '', marks: '7', co: defaultCo, blooms: 'L2', image: null },
            { id: 'b', text: '', marks: '7', co: defaultCo, blooms: 'L2', image: null },
            { id: 'c', text: '', marks: '6', co: defaultCo, blooms: 'L3', image: null },
          ],
        }
      : {
          qNum,
          targetMarks,
          parts: [
            { id: 'a', text: '', marks: '5', co: defaultCo, blooms: 'L2', image: null },
            { id: 'b', text: '', marks: '5', co: defaultCo, blooms: 'L3', image: null },
          ],
        }
  })
}

function blankOmr(pattern: IaQpPattern, iaNum: number): IaOmrQuestion[] {
  const count = pattern === 'OMR_25' ? 25 : 50
  const marks = pattern === 'OMR_25' ? '2' : '1'
  return Array.from({ length: count }, (_, idx) => ({
    qNum: idx + 1,
    isOmr: true,
    text: '',
    options: { A: '', B: '', C: '', D: '' },
    ans: 'A',
    marks,
    co: idx / count < 0.4 ? (iaNum === 2 ? 'CO4' : 'CO1') : idx / count < 0.8 ? (iaNum === 2 ? 'CO5' : 'CO2') : 'CO3',
    blooms: idx % 3 === 0 ? 'L1' : 'L2',
    image: null,
  }))
}

export function FacultyIaDrafterTab({
  institutionId,
  institutionName,
  publicKeyPem,
  allocations,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const csvRef = useRef<HTMLInputElement | null>(null)
  const lastFocusRef = useRef<{ kind: 'DESC'; qIdx: number; pIdx: number } | { kind: 'OMR'; qIdx: number } | null>(null)

  const [selectedAllocId, setSelectedAllocId] = useState(allocations[0]?.id ?? '')
  const [pinInput, setPinInput] = useState('')
  const [unlockedPin, setUnlockedPin] = useState('')
  const [activeSet, setActiveSet] = useState(1)
  const [qpPattern, setQpPattern] = useState<IaQpPattern>('DESCRIPTIVE')
  const [setsMap, setSetsMap] = useState<Record<number, IaQuestionSet>>({ 1: blankDescriptive(1) })
  const [coStatements, setCoStatements] = useState(
    'CO1: Understand core concepts of Module 1\nCO2: Apply techniques from Module 2\nCO3: Analyze Module 3 problems'
  )
  const [formulaModalOpen, setFormulaModalOpen] = useState(false)
  const [formulaSearch, setFormulaSearch] = useState('')
  const [formulaCat, setFormulaCat] = useState('ALL')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const activeAlloc = allocations.find((a) => a.id === selectedAllocId) ?? allocations[0] ?? null

  const { data: formulas = [] } = useQuery<PlatformLatexEquation[]>({
    queryKey: ['platform_latex_equations'],
    enabled: formulaModalOpen,
    staleTime: 600_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_latex_equations')
        .select('*')
        .order('category')
        .order('title')
      if (error) throw error
      return (data ?? []) as PlatformLatexEquation[]
    },
  })

  const filteredFormulas = useMemo(() => {
    const q = formulaSearch.trim().toLowerCase()
    return formulas.filter((f) => {
      if (formulaCat !== 'ALL' && f.category !== formulaCat) return false
      if (q && !`${f.title} ${f.description} ${f.latex_code}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [formulas, formulaSearch, formulaCat])

  const unlockWithPin = async () => {
    if (!activeAlloc) return
    setErrorMsg(null)
    setNotice(null)
    try {
      const { data: ok, error } = await supabase.rpc('verify_staff_pin', {
        p_institution_id: institutionId,
        p_staff_profile_id: activeAlloc.staff_profile_id,
        p_pin: pinInput.trim(),
      })
      if (error) throw error
      if (!ok) throw new Error('Incorrect 4-Digit Faculty PIN (generate missing PINs in Security Vault if unset).')

      let resolvedPattern: IaQpPattern = activeAlloc.qp_pattern
      const totalSets = Math.max(1, activeAlloc.num_sets)
      const nextMap: Record<number, IaQuestionSet> = {}

      if (activeAlloc.qp_content) {
        const env = JSON.parse(activeAlloc.qp_content) as IaEncryptedEnvelope
        const dec = decryptIaEnvelopeWithPin(env, pinInput.trim(), activeAlloc.faculty_code)
        resolvedPattern = dec.qpPattern || activeAlloc.qp_pattern
        if (dec.coStatements) setCoStatements(dec.coStatements)
        for (let s = 1; s <= totalSets; s++) {
          nextMap[s] =
            dec.setsMap[s] ??
            (resolvedPattern.startsWith('OMR')
              ? blankOmr(resolvedPattern, activeAlloc.ia_number)
              : blankDescriptive(activeAlloc.ia_number))
        }
      } else {
        for (let s = 1; s <= totalSets; s++) {
          nextMap[s] = resolvedPattern.startsWith('OMR')
            ? blankOmr(resolvedPattern, activeAlloc.ia_number)
            : blankDescriptive(activeAlloc.ia_number)
        }
      }

      setQpPattern(resolvedPattern)
      setSetsMap(nextMap)
      setUnlockedPin(pinInput.trim())
      setPinInput('')
      setActiveSet(1)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to unlock vault')
    }
  }

  const saveVaultMutation = useMutation({
    mutationFn: async (targetStatus: 'DRAFT' | 'SUBMITTED') => {
      if (!activeAlloc || !unlockedPin) throw new Error('Unlock vault with your 4-digit PIN first.')
      if (targetStatus === 'SUBMITTED' && !publicKeyPem) {
        throw new Error('Cannot submit final copy: COE must generate an institution RSA keypair in Security Vault first.')
      }
      const encrypted = encryptIaEnvelope(
        { qpPattern, setsMap, coStatements },
        unlockedPin,
        activeAlloc.faculty_code,
        publicKeyPem
      )
      const { error } = await supabase
        .from('ia_qp_allocations')
        .update({
          qp_content: encrypted,
          qp_pattern: qpPattern,
          co_statements: '[ENCRYPTED IN VAULT]',
          status: targetStatus,
          updated_by: session?.user.id ?? null,
        })
        .eq('id', activeAlloc.id)
        .eq('institution_id', institutionId)
      if (error) throw error
      return targetStatus
    },
    onSuccess: (status) => {
      setErrorMsg(null)
      setNotice(
        status === 'SUBMITTED'
          ? 'Encrypted with RSA-2048 + PIN and submitted to the COE Vault!'
          : 'Encrypted Draft saved safely in vault.'
      )
      queryClient.invalidateQueries({ queryKey: ['ia_qp_allocations', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Save failed'),
  })

  const insertSnippet = (snippet: string) => {
    const target = lastFocusRef.current
    if (!target) {
      setErrorMsg('Click inside a question box first, then click a symbol or formula to insert it.')
      return
    }
    setErrorMsg(null)
    if (target.kind === 'DESC') {
      setSetsMap((prev) => {
        const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
        const q = { ...list[target.qIdx] }
        q.parts = q.parts.map((p, i) => (i === target.pIdx ? { ...p, text: p.text + snippet } : p))
        list[target.qIdx] = q
        return { ...prev, [activeSet]: list }
      })
    } else {
      setSetsMap((prev) => {
        const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
        list[target.qIdx] = { ...list[target.qIdx], text: list[target.qIdx].text + snippet }
        return { ...prev, [activeSet]: list }
      })
    }
    setFormulaModalOpen(false)
  }

  const autoShuffleFromSetA = () => {
    if (activeSet <= 1) return
    const setA = (setsMap[1] as IaOmrQuestion[]) ?? []
    const shuffle = <T,>(arr: T[]): T[] => {
      const c = [...arr]
      for (let i = c.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[c[i], c[j]] = [c[j], c[i]]
      }
      return c
    }
    const shuffled: IaOmrQuestion[] = shuffle(setA).map((q, idx) => {
      const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D']
      const origAnsText = q.options[q.ans]
      const mixed = shuffle(letters.map((k) => ({ orig: k, text: q.options[k] })))
      const nextOpts = { A: '', B: '', C: '', D: '' }
      let nextAns: 'A' | 'B' | 'C' | 'D' = 'A'
      mixed.forEach((m, i) => {
        const l = letters[i]
        nextOpts[l] = m.text
        if (m.orig === q.ans || (origAnsText && m.text === origAnsText)) nextAns = l
      })
      return { ...q, qNum: idx + 1, options: nextOpts, ans: nextAns }
    })
    setSetsMap((prev) => ({ ...prev, [activeSet]: shuffled }))
    setNotice(`Auto-shuffled Set ${String.fromCharCode(64 + activeSet)} from Set A with remapped Answer Keys.`)
  }

  const downloadOmrCsvTemplate = () => {
    const list = (setsMap[activeSet] as IaOmrQuestion[]) ?? []
    const lines = ['QNo,Question,OptionA,OptionB,OptionC,OptionD,AnswerKey,CO,Blooms']
    for (const q of list) {
      const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`
      lines.push(`${q.qNum},${esc(q.text)},${esc(q.options.A)},${esc(q.options.B)},${esc(q.options.C)},${esc(q.options.D)},${q.ans},${q.co},${q.blooms}`)
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `OMR_Template_${activeAlloc?.course_code ?? 'IA'}_Set${String.fromCharCode(64 + activeSet)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOmrCsvUpload = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        setSetsMap((prev) => {
          const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? blankOmr(qpPattern, activeAlloc?.ia_number ?? 1))]
          parsed.data.forEach((row, idx) => {
            const qIdx = (Number(row.QNo) || idx + 1) - 1
            if (qIdx >= 0 && qIdx < list.length) {
              const rawAns = String(row.AnswerKey || 'A').trim().toUpperCase()
              const ans: 'A' | 'B' | 'C' | 'D' = ['A', 'B', 'C', 'D'].includes(rawAns)
                ? (rawAns as 'A' | 'B' | 'C' | 'D')
                : 'A'
              list[qIdx] = {
                ...list[qIdx],
                text: row.Question || '',
                options: {
                  A: row.OptionA || '',
                  B: row.OptionB || '',
                  C: row.OptionC || '',
                  D: row.OptionD || '',
                },
                ans,
                co: row.CO || list[qIdx].co,
                blooms: row.Blooms || list[qIdx].blooms,
              }
            }
          })
          return { ...prev, [activeSet]: list }
        })
        setNotice(`Imported OMR CSV into Set ${String.fromCharCode(64 + activeSet)}.`)
      },
    })
  }

  const printScrutinyPack = async (includeScrutiny: boolean) => {
    if (!activeAlloc) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const setLetter = String.fromCharCode(64 + activeSet)
    const list = setsMap[activeSet] ?? []
    const isOmr = qpPattern.startsWith('OMR')

    const bloomsCounts: Record<string, number> = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 }
    let qpHtml = ''

    if (isOmr) {
      const mcqs = list as IaOmrQuestion[]
      qpHtml = `<table><thead><tr><th style="width:40px">Q</th><th>Question &amp; Options</th>${includeScrutiny ? '<th style="width:36px">Key</th>' : ''}<th style="width:42px">M</th></tr></thead><tbody>${mcqs
        .filter((q) => q.text.trim())
        .map((q) => {
          if (bloomsCounts[q.blooms] !== undefined) bloomsCounts[q.blooms] += 1
          return `<tr>
            <td style="text-align:center;font-weight:700">${q.qNum}</td>
            <td>${renderMathToHtmlString(q.text)}${q.image ? `<br/><img src="${escapeHtml(q.image)}" style="max-height:90px" alt="" />` : ''}<br/><span style="font-size:10px">(A) ${renderMathToHtmlString(q.options.A)} &nbsp; (B) ${renderMathToHtmlString(q.options.B)} &nbsp; (C) ${renderMathToHtmlString(q.options.C)} &nbsp; (D) ${renderMathToHtmlString(q.options.D)}</span></td>
            ${includeScrutiny ? `<td style="text-align:center;font-weight:700;color:#166534">${q.ans}</td>` : ''}
            <td style="text-align:center">${q.marks}</td>
          </tr>`
        })
        .join('')}</tbody></table>`
    } else {
      const qs = list as IaDescriptiveQuestion[]
      const rows: string[] = []
      qs.forEach((q, qIdx) => {
        q.parts
          .filter((p) => p.text.trim())
          .forEach((p, pIdx) => {
            if (bloomsCounts[p.blooms] !== undefined) bloomsCounts[p.blooms] += 1
            rows.push(`<tr>
              <td style="text-align:center;font-weight:700">${pIdx === 0 ? `${q.qNum}.${p.id}` : p.id}</td>
              <td>${renderMathToHtmlString(p.text)}${p.image ? `<br/><img src="${escapeHtml(p.image)}" style="max-height:100px" alt="" />` : ''}</td>
              <td style="text-align:center">${escapeHtml(p.marks)}</td>
              <td style="text-align:center">${escapeHtml(p.co)}</td>
              <td style="text-align:center">${escapeHtml(p.blooms)}</td>
            </tr>`)
          })
        if (qIdx === 0 || qIdx === 2 || qIdx === 4) {
          rows.push(`<tr><td colspan="5" style="text-align:center;font-weight:700;background:#f8fafc">OR</td></tr>`)
        }
      })
      qpHtml = `<table><thead><tr><th style="width:44px">Q.No</th><th>Question</th><th style="width:42px">M</th><th style="width:44px">CO</th><th style="width:44px">Lvl</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    }

    const scrutinyPage = includeScrutiny
      ? `<section class="page">
          ${renderWatermarkHtml(branding, 'per-page')}
          <div class="doc-body">
            ${renderBrandedHeaderHtml(branding, 'INTERNAL ASSESSMENT QUESTION PAPER SCRUTINIZER FORMAT', `${activeAlloc.course_code} — ${activeAlloc.course_title} (IA-${activeAlloc.ia_number} · Set ${setLetter})`)}
            <table>
              <thead><tr><th colspan="6" style="text-align:center">Bloom's Cognitive Levels Covered (Auto-Counted)</th></tr></thead>
              <tbody><tr>${(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).map((l) => `<td style="text-align:center;font-weight:700">${l}: ${bloomsCounts[l]}</td>`).join('')}</tr></tbody>
            </table>
            <table>
              <thead><tr><th>Scrutiny Checklist</th><th style="width:90px;text-align:center">Observation</th></tr></thead>
              <tbody>
                <tr><td>Questions set strictly within covered syllabus?</td><td style="text-align:center">YES / NO</td></tr>
                <tr><td>Properly mapped to COs and Bloom's cognitive levels?</td><td style="text-align:center">YES / NO</td></tr>
                <tr><td>Marks distribution and Autonomous format followed?</td><td style="text-align:center">YES / NO</td></tr>
              </tbody>
            </table>
            <p style="font-size:10px"><strong>CO Statements:</strong><br/>${escapeHtml(coStatements).replace(/\n/g, '<br/>')}</p>
            <div class="signatures">
              <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Prepared By (${escapeHtml(activeAlloc.faculty_name)})</span></div>
              <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Module / PAC Scrutinizer</span></div>
              <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Academic Advisor / HOD</span></div>
            </div>
          </div>
        </section>`
      : ''

    openBrandedPrintWindow({
      title: `IA${activeAlloc.ia_number}_${activeAlloc.course_code}_Set${setLetter}_${includeScrutiny ? 'SCRUTINY' : 'CLEAN'}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      headHtml: KATEX_PRINT_HEAD_HTML,
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body">
          ${renderBrandedHeaderHtml(branding, `INTERNAL ASSESSMENT – ${activeAlloc.ia_number} (SET ${setLetter})`, `${activeAlloc.course_code} — ${activeAlloc.course_title} | Max Marks: 50 | Time: 90 mins`)}
          ${qpHtml}
        </div>
      </section>${scrutinyPage}`,
    })
  }

  if (allocations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-xs text-slate-500">
        No IA question paper allocations assigned to your account in this cycle.
      </div>
    )
  }

  if (!unlockedPin && activeAlloc) {
    return (
      <div className="max-w-md mx-auto rounded-xl border border-slate-200 bg-white p-6 space-y-4 shadow-xs">
        <div className="text-center space-y-1">
          <div className="h-12 w-12 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center mx-auto">
            <KeyRound className="h-6 w-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900">PIN-Encrypted IA Question Paper Vault</h2>
          <p className="text-xs text-slate-500">
            Select your assigned paper and enter your <strong>4-Digit Faculty PIN</strong> to decrypt in memory.
          </p>
        </div>

        <select
          value={activeAlloc.id}
          onChange={(e) => setSelectedAllocId(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-medium"
        >
          {allocations.map((a) => (
            <option key={a.id} value={a.id}>
              IA-{a.ia_number}: {a.course_code} — {a.faculty_name} ({a.status})
            </option>
          ))}
        </select>

        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="••••"
          value={pinInput}
          onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded-md border-2 border-indigo-600 px-3 py-2.5 text-center text-lg font-mono font-bold tracking-[0.5em]"
        />

        {errorMsg && <p className="text-xs text-red-600 font-medium text-center">{errorMsg}</p>}

        <button
          type="button"
          disabled={pinInput.length < 4}
          onClick={unlockWithPin}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          <Lock className="h-3.5 w-3.5" /> Unlock IA Drafter
        </button>
      </div>
    )
  }

  const isSubmitted = activeAlloc?.status === 'SUBMITTED'
  const isOmr = qpPattern.startsWith('OMR')

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

      {/* Top Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            IA-{activeAlloc?.ia_number}: {activeAlloc?.course_code} — {activeAlloc?.course_title}
          </h2>
          <p className="text-xs text-slate-500">
            Faculty: {activeAlloc?.faculty_name} ({activeAlloc?.faculty_code}) · {activeAlloc?.num_sets} Set(s) ·{' '}
            {qpPattern}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFormulaModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-800"
          >
            <Library className="h-3.5 w-3.5" /> Formula Library
          </button>
          <button
            type="button"
            onClick={() => printScrutinyPack(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
          >
            <Printer className="h-3.5 w-3.5" /> Scrutiny Pack
          </button>
          <button
            type="button"
            onClick={() => printScrutinyPack(false)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
          >
            <Printer className="h-3.5 w-3.5" /> Clean QP
          </button>
          <button
            type="button"
            onClick={() => setUnlockedPin('')}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600"
          >
            Lock
          </button>
        </div>
      </div>

      {/* Multi-Set Tabs + Sticky LaTeX Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {Array.from({ length: activeAlloc?.num_sets ?? 1 }, (_, i) => i + 1).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActiveSet(s)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition',
                activeSet === s ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-300 text-slate-700'
              )}
            >
              Set {String.fromCharCode(64 + s)}
            </button>
          ))}
        </div>

        {!isSubmitted && (
          <div className="flex flex-wrap items-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-1">
            <Sigma className="h-3.5 w-3.5 text-indigo-600 mr-1" />
            {SYMBOLS.map((sym) => (
              <button
                key={sym.label}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertSnippet(sym.snippet)
                }}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-bold text-slate-800 hover:bg-indigo-50"
              >
                {sym.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* OMR or Descriptive Editor */}
      {isOmr ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-purple-50 border border-purple-200 px-3 py-2 text-xs">
            <span className="font-semibold text-purple-900">
              OMR Mode ({qpPattern}) — Set {String.fromCharCode(64 + activeSet)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={downloadOmrCsvTemplate}
                className="inline-flex items-center gap-1 rounded border border-purple-300 bg-white px-2.5 py-1 font-medium text-purple-800"
              >
                <Download className="h-3.5 w-3.5" /> CSV Template
              </button>
              {!isSubmitted && (
                <>
                  <input
                    ref={csvRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleOmrCsvUpload(f)
                      e.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => csvRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded bg-purple-600 px-2.5 py-1 font-medium text-white"
                  >
                    <Upload className="h-3.5 w-3.5" /> Upload CSV
                  </button>
                  {activeSet > 1 && (
                    <button
                      type="button"
                      onClick={autoShuffleFromSetA}
                      className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-medium text-white"
                    >
                      <Shuffle className="h-3.5 w-3.5" /> Auto-Shuffle from Set A
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {((setsMap[activeSet] as IaOmrQuestion[]) ?? []).map((q, qIdx) => (
              <div key={q.qNum} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <strong className="text-indigo-900">Q{q.qNum}. ({q.marks}M)</strong>
                  <div className="flex items-center gap-1.5">
                    <select
                      disabled={isSubmitted}
                      value={q.ans}
                      onChange={(e) =>
                        setSetsMap((prev) => {
                          const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
                          list[qIdx] = { ...list[qIdx], ans: e.target.value as 'A' | 'B' | 'C' | 'D' }
                          return { ...prev, [activeSet]: list }
                        })
                      }
                      className="rounded border border-emerald-400 bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-800"
                    >
                      <option value="A">Key: A</option>
                      <option value="B">Key: B</option>
                      <option value="C">Key: C</option>
                      <option value="D">Key: D</option>
                    </select>
                    <input
                      disabled={isSubmitted}
                      value={q.co}
                      onChange={(e) =>
                        setSetsMap((prev) => {
                          const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
                          list[qIdx] = { ...list[qIdx], co: e.target.value }
                          return { ...prev, [activeSet]: list }
                        })
                      }
                      className="w-12 rounded border border-slate-300 px-1 py-0.5 text-center"
                    />
                  </div>
                </div>
                <textarea
                  disabled={isSubmitted}
                  rows={2}
                  value={q.text}
                  onFocus={() => {
                    lastFocusRef.current = { kind: 'OMR', qIdx }
                  }}
                  onChange={(e) =>
                    setSetsMap((prev) => {
                      const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
                      list[qIdx] = { ...list[qIdx], text: e.target.value }
                      return { ...prev, [activeSet]: list }
                    })
                  }
                  placeholder={`MCQ ${q.qNum} stem (supports $LaTeX$)...`}
                  className="w-full rounded border border-slate-300 p-1.5"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  {(['A', 'B', 'C', 'D'] as const).map((k) => (
                    <input
                      key={k}
                      disabled={isSubmitted}
                      placeholder={`Option ${k}`}
                      value={q.options[k]}
                      onChange={(e) =>
                        setSetsMap((prev) => {
                          const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
                          list[qIdx] = { ...list[qIdx], options: { ...list[qIdx].options, [k]: e.target.value } }
                          return { ...prev, [activeSet]: list }
                        })
                      }
                      className="rounded border border-slate-300 px-2 py-1"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {((setsMap[activeSet] as IaDescriptiveQuestion[]) ?? []).map((q, qIdx) => (
            <div key={q.qNum} className="rounded-lg border border-slate-200 bg-white p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                <strong className="text-sm text-indigo-900">Question {q.qNum} ({q.targetMarks} Marks)</strong>
                <span className="text-slate-500">
                  {q.qNum <= 2 ? 'Module 1 / 4' : q.qNum <= 4 ? 'Module 2 / 5' : 'Module 3'}
                </span>
              </div>
              {q.parts.map((p, pIdx) => (
                <div key={p.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                  <div className="md:col-span-9 space-y-1">
                    <textarea
                      disabled={isSubmitted}
                      rows={2}
                      value={p.text}
                      onFocus={() => {
                        lastFocusRef.current = { kind: 'DESC', qIdx, pIdx }
                      }}
                      onChange={(e) =>
                        setSetsMap((prev) => {
                          const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
                          const copy = { ...list[qIdx] }
                          copy.parts = copy.parts.map((part, i) =>
                            i === pIdx ? { ...part, text: e.target.value } : part
                          )
                          list[qIdx] = copy
                          return { ...prev, [activeSet]: list }
                        })
                      }
                      placeholder={`Q${q.qNum}.${p.id}) Enter question text ($...$ for LaTeX)...`}
                      className="w-full rounded border border-slate-300 p-2"
                    />
                    {p.text.includes('$') && (
                      <div
                        className="rounded bg-slate-50 border border-dashed border-indigo-200 px-2.5 py-1.5 text-slate-900"
                        dangerouslySetInnerHTML={{ __html: renderMathToHtmlString(p.text) }}
                      />
                    )}
                    {!isSubmitted && (
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] font-medium text-indigo-700 cursor-pointer hover:underline">
                          + {p.image ? 'Replace Diagram' : 'Attach Diagram (<18 KB)'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const f = e.target.files?.[0]
                              if (!f) return
                              try {
                                const dataUrl = await compressDiagramToDataUrl(f)
                                setSetsMap((prev) => {
                                  const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
                                  const copy = { ...list[qIdx] }
                                  copy.parts = copy.parts.map((part, i) =>
                                    i === pIdx ? { ...part, image: dataUrl } : part
                                  )
                                  list[qIdx] = copy
                                  return { ...prev, [activeSet]: list }
                                })
                              } catch (err) {
                                setErrorMsg(err instanceof Error ? err.message : 'Diagram failed')
                              }
                              e.target.value = ''
                            }}
                          />
                        </label>
                        {p.image && (
                          <img src={p.image} alt="Diagram" className="h-10 rounded border border-slate-200" />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-3 grid grid-cols-3 gap-1.5">
                    <input
                      disabled={isSubmitted}
                      value={p.marks}
                      onChange={(e) =>
                        setSetsMap((prev) => {
                          const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
                          const copy = { ...list[qIdx] }
                          copy.parts = copy.parts.map((part, i) =>
                            i === pIdx ? { ...part, marks: e.target.value } : part
                          )
                          list[qIdx] = copy
                          return { ...prev, [activeSet]: list }
                        })
                      }
                      className="rounded border border-slate-300 px-1.5 py-1.5 text-center font-bold"
                    />
                    <input
                      disabled={isSubmitted}
                      value={p.co}
                      onChange={(e) =>
                        setSetsMap((prev) => {
                          const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
                          const copy = { ...list[qIdx] }
                          copy.parts = copy.parts.map((part, i) =>
                            i === pIdx ? { ...part, co: e.target.value } : part
                          )
                          list[qIdx] = copy
                          return { ...prev, [activeSet]: list }
                        })
                      }
                      className="rounded border border-slate-300 px-1.5 py-1.5 text-center"
                    />
                    <select
                      disabled={isSubmitted}
                      value={p.blooms}
                      onChange={(e) =>
                        setSetsMap((prev) => {
                          const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
                          const copy = { ...list[qIdx] }
                          copy.parts = copy.parts.map((part, i) =>
                            i === pIdx ? { ...part, blooms: e.target.value } : part
                          )
                          list[qIdx] = copy
                          return { ...prev, [activeSet]: list }
                        })
                      }
                      className="rounded border border-slate-300 px-1 py-1.5"
                    >
                      {['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* CO Statements + Encrypt/Submit Footer */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <label className="block text-xs font-semibold text-slate-700">
          Course Outcome (CO) Statements (Encrypted in Vault &amp; Printed on Scrutiny Pack)
        </label>
        <textarea
          disabled={isSubmitted}
          rows={3}
          value={coStatements}
          onChange={(e) => setCoStatements(e.target.value)}
          className="w-full rounded border border-slate-300 p-2 text-xs"
        />
        {!isSubmitted && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saveVaultMutation.isPending}
              onClick={() => saveVaultMutation.mutate('DRAFT')}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-white px-4 py-2 text-xs font-semibold text-indigo-800 hover:bg-indigo-50"
            >
              <Save className="h-3.5 w-3.5" /> Save Encrypted Draft
            </button>
            <button
              type="button"
              disabled={saveVaultMutation.isPending}
              onClick={() => {
                if (window.confirm('Encrypt with RSA-2048 and submit final copy to COE Vault?')) {
                  saveVaultMutation.mutate('SUBMITTED')
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
            >
              <Send className="h-3.5 w-3.5" /> Encrypt &amp; Submit to COE Vault
            </button>
          </div>
        )}
      </div>

      {/* Platform Formula Library Modal */}
      {formulaModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-1.5">
                <Library className="h-4 w-4" /> Platform VTU Engineering Formula Library
              </h3>
              <button type="button" onClick={() => setFormulaModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex gap-2">
              <input
                type="text"
                placeholder="Search formula..."
                value={formulaSearch}
                onChange={(e) => setFormulaSearch(e.target.value)}
                className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              />
              <select
                value={formulaCat}
                onChange={(e) => setFormulaCat(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="ALL">All Categories</option>
                {Array.from(new Set(formulas.map((f) => f.category))).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filteredFormulas.map((f) => (
                <div key={f.id} className="rounded-lg border border-slate-200 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase text-indigo-600">{f.category}</span>
                    <p className="text-xs font-bold text-slate-900">{f.title}</p>
                    <div
                      className="mt-1 text-xs"
                      dangerouslySetInnerHTML={{ __html: renderMathToHtmlString(f.latex_code) }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => insertSnippet(f.latex_code)}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shrink-0"
                  >
                    Insert
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
