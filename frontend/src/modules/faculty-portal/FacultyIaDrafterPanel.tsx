import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import Papa from 'papaparse'
import {
  ArrowLeft,
  KeyRound,
  Lock,
  Save,
  Send,
  Printer,
  FileDown,
  RotateCcw,
  Layers,
  Plus,
  Trash2,
  Sigma,
  Library,
  Shuffle,
  Download,
  UploadCloud,
  FileText,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react'
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
import type { FacultyProfileSummary } from '@/types/facultyPortal'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderWatermarkHtml,
} from '@/modules/exams/printBranding'
import {
  compressDiagramToDataUrl,
  containsMathOrSpecialSymbols,
  decryptIaEnvelopeWithPin,
  encryptIaEnvelope,
  getBase64SizeKB,
  KATEX_PRINT_HEAD_HTML,
  renderMathToHtmlString,
} from '@/modules/qp-vault/vaultCrypto'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  institutionName: string
  publicKeyPem: string | null
  faculty: FacultyProfileSummary
  allocations: IaQpAllocationRow[]
  initialAllocationId: string
  onBack: () => void
  onRefresh: () => void
}

const SYMBOLS = [
  { label: 'a/b', snippet: '$\\frac{a}{b}$' },
  { label: '√x', snippet: '$\\sqrt{x}$' },
  { label: 'xⁿ', snippet: '$x^{n}$' },
  { label: 'xᵢ', snippet: '$x_{i}$' },
  { label: '∫', snippet: '$\\int_{a}^{b} f(x)\\,dx$' },
  { label: '∑', snippet: '$\\sum_{i=1}^{n}$' },
  { label: 'lim', snippet: '$\\lim_{x \\to 0}$' },
  { label: 'dy/dx', snippet: '$\\frac{dy}{dx}$' },
  { label: '[Matrix]', snippet: '$\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}$' },
  { label: '[3×3]', snippet: '$\\begin{bmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}$' },
  { label: '|Det|', snippet: '$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}$' },
  { label: 'α', snippet: 'α' },
  { label: 'β', snippet: 'β' },
  { label: 'θ', snippet: 'θ' },
  { label: 'λ', snippet: 'λ' },
  { label: 'π', snippet: 'π' },
  { label: 'Ω', snippet: 'Ω' },
  { label: '≤', snippet: '≤' },
  { label: '≥', snippet: '≥' },
  { label: '±', snippet: '±' },
  { label: '→', snippet: '→' },
  { label: '⇌', snippet: '⇌' },
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

export function FacultyIaDrafterPanel({
  institutionId,
  institutionName,
  publicKeyPem,
  faculty,
  allocations,
  initialAllocationId,
  onBack,
  onRefresh,
}: Props) {
  const { session } = useAppStore()
  const csvRef = useRef<HTMLInputElement | null>(null)
  const focusRef = useRef<
    | { kind: 'DESC'; qIdx: number; pIdx: number }
    | { kind: 'OMR_STEM'; qIdx: number }
    | { kind: 'OMR_OPT'; qIdx: number; optKey: 'A' | 'B' | 'C' | 'D' }
    | null
  >(null)

  const [activeId, setActiveId] = useState(initialAllocationId || allocations[0]?.id || '')
  const [pinInput, setPinInput] = useState('')
  const [sessionPin, setSessionPin] = useState('')
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenPin, setReopenPin] = useState('')
  const [showSymbolBar, setShowSymbolBar] = useState(true)

  const [activeSet, setActiveSet] = useState(1)
  const [qpPattern, setQpPattern] = useState<IaQpPattern>('DESCRIPTIVE')
  const [setsMap, setSetsMap] = useState<Record<number, IaQuestionSet>>({ 1: blankDescriptive(1) })
  const [coStatements, setCoStatements] = useState(
    'CO1: Understand fundamental concepts of Module 1\nCO2: Analyze and apply techniques of Module 2\nCO3: Design and evaluate Module 3 solutions'
  )
  const [formulaModalOpen, setFormulaModalOpen] = useState(false)
  const [formulaSearch, setFormulaSearch] = useState('')
  const [formulaCat, setFormulaCat] = useState('ALL')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const activeAlloc = allocations.find((a) => a.id === activeId) ?? allocations[0] ?? null

  const hydrateAllocationWithPin = (alloc: IaQpAllocationRow, pin: string) => {
    let resolvedPattern: IaQpPattern = alloc.qp_pattern
    const totalSets = Math.max(1, alloc.num_sets || 1)
    const nextMap: Record<number, IaQuestionSet> = {}

    if (alloc.qp_content) {
      const env = JSON.parse(alloc.qp_content) as IaEncryptedEnvelope
      const dec = decryptIaEnvelopeWithPin(env, pin, alloc.faculty_code)
      resolvedPattern = dec.qpPattern || alloc.qp_pattern
      if (dec.coStatements) setCoStatements(dec.coStatements)
      for (let s = 1; s <= totalSets; s++) {
        nextMap[s] =
          dec.setsMap[s] ??
          (resolvedPattern.startsWith('OMR') ? blankOmr(resolvedPattern, alloc.ia_number) : blankDescriptive(alloc.ia_number))
      }
    } else {
      for (let s = 1; s <= totalSets; s++) {
        nextMap[s] = resolvedPattern.startsWith('OMR')
          ? blankOmr(resolvedPattern, alloc.ia_number)
          : blankDescriptive(alloc.ia_number)
      }
    }
    setQpPattern(resolvedPattern)
    setSetsMap(nextMap)
    setActiveSet(1)
  }

  // Re-hydrate smoothly when switching between multiple assigned IA subjects while unlocked
  useEffect(() => {
    if (!activeAlloc || !sessionPin) return
    try {
      hydrateAllocationWithPin(activeAlloc, sessionPin)
      setErrorMsg(null)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to decrypt switched subject')
    }
  }, [activeAlloc?.id])

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

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeAlloc) return
    setErrorMsg(null)
    try {
      const { data: ok, error } = await supabase.rpc('verify_staff_pin', {
        p_institution_id: institutionId,
        p_staff_profile_id: activeAlloc.staff_profile_id,
        p_pin: pinInput.trim(),
      })
      if (error) throw error
      if (!ok) throw new Error('Incorrect 4-Digit Faculty PIN.')
      hydrateAllocationWithPin(activeAlloc, pinInput.trim())
      setSessionPin(pinInput.trim())
      setPinInput('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unlock failed')
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (targetStatus: 'DRAFT' | 'SUBMITTED') => {
      if (!activeAlloc || !sessionPin) throw new Error('Unlock vault with your 4-digit PIN first.')
      if (targetStatus === 'SUBMITTED' && !publicKeyPem) {
        throw new Error('COE has not generated the institution RSA Public Key in Security Vault yet.')
      }
      const encrypted = encryptIaEnvelope(
        { qpPattern, setsMap, coStatements },
        sessionPin,
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
          : 'Encrypted Draft saved safely.'
      )
      onRefresh()
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Save failed'),
  })

  const reopenMutation = useMutation({
    mutationFn: async () => {
      if (!activeAlloc) throw new Error('No active paper selected.')
      const { error } = await supabase.rpc('reopen_ia_qp_with_pin', {
        p_institution_id: institutionId,
        p_allocation_id: activeAlloc.id,
        p_pin: reopenPin.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      setReopenOpen(false)
      setReopenPin('')
      setErrorMsg(null)
      setNotice('Paper unlocked back to DRAFT for edits.')
      onRefresh()
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Invalid PIN'),
  })

  const handlePatternSwitch = (nextPattern: IaQpPattern) => {
    if (!activeAlloc || nextPattern === qpPattern) return
    if (!window.confirm(`Switch paper pattern to ${nextPattern}? Existing unsaved questions in the editor will reset.`)) {
      return
    }
    const nextMap: Record<number, IaQuestionSet> = {}
    for (let s = 1; s <= Math.max(1, activeAlloc.num_sets); s++) {
      nextMap[s] = nextPattern.startsWith('OMR')
        ? blankOmr(nextPattern, activeAlloc.ia_number)
        : blankDescriptive(activeAlloc.ia_number)
    }
    setQpPattern(nextPattern)
    setSetsMap(nextMap)
  }

  const insertSnippet = (snippet: string) => {
    const t = focusRef.current
    if (!t) {
      setErrorMsg('Click inside a Question or Option box first, then tap a symbol or formula.')
      return
    }
    setErrorMsg(null)
    if (t.kind === 'DESC') {
      setSetsMap((prev) => {
        const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
        const q = { ...list[t.qIdx] }
        q.parts = q.parts.map((p, i) => (i === t.pIdx ? { ...p, text: p.text + snippet } : p))
        list[t.qIdx] = q
        return { ...prev, [activeSet]: list }
      })
    } else if (t.kind === 'OMR_STEM') {
      setSetsMap((prev) => {
        const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
        list[t.qIdx] = { ...list[t.qIdx], text: list[t.qIdx].text + snippet }
        return { ...prev, [activeSet]: list }
      })
    } else {
      setSetsMap((prev) => {
        const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
        list[t.qIdx] = {
          ...list[t.qIdx],
          options: { ...list[t.qIdx].options, [t.optKey]: list[t.qIdx].options[t.optKey] + snippet },
        }
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
    setNotice(`Generated shuffled Set ${String.fromCharCode(64 + activeSet)} from Set A with remapped answer keys.`)
  }

  const downloadOmrCsv = () => {
    const list = (setsMap[activeSet] as IaOmrQuestion[]) ?? []
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const lines = [
      'QNo,Question,OptionA,OptionB,OptionC,OptionD,AnswerKey,CO,Blooms',
      ...list.map(
        (q) =>
          `${q.qNum},${esc(q.text)},${esc(q.options.A)},${esc(q.options.B)},${esc(q.options.C)},${esc(q.options.D)},${q.ans},${q.co},${q.blooms}`
      ),
    ]
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
              const rawAns = String(row.AnswerKey || row['AnswerKey(A/B/C/D)'] || 'A').trim().toUpperCase()
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
                blooms: row.Blooms || row.BloomsLevel || list[qIdx].blooms,
              }
            }
          })
          return { ...prev, [activeSet]: list }
        })
        setNotice(`Imported OMR CSV into Set ${String.fromCharCode(64 + activeSet)}.`)
      },
    })
  }

  const printPack = async (includeScrutiny: boolean) => {
    if (!activeAlloc) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const setLetter = String.fromCharCode(64 + activeSet)
    const list = setsMap[activeSet] ?? []
    const isOmr = qpPattern.startsWith('OMR')
    const blooms: Record<string, number> = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 }
    const coMap: Record<string, { qs: string[]; lvls: Set<string> }> = {}

    let qpHtml = ''
    if (isOmr) {
      const mcqs = (list as IaOmrQuestion[]).filter((q) => q.text.trim())
      qpHtml = `<table><thead><tr><th style="width:40px">Q</th><th>Question &amp; Options</th>${includeScrutiny ? '<th style="width:36px">Key</th>' : ''}<th style="width:42px">M</th></tr></thead><tbody>${mcqs
        .map((q) => {
          if (blooms[q.blooms] !== undefined) blooms[q.blooms] += 1
          const co = q.co.toUpperCase()
          if (!coMap[co]) coMap[co] = { qs: [], lvls: new Set() }
          coMap[co].qs.push(`Q${q.qNum}`)
          coMap[co].lvls.add(q.blooms)
          return `<tr><td style="text-align:center;font-weight:700">${q.qNum}</td><td>${renderMathToHtmlString(q.text)}${q.image ? `<br/><img src="${escapeHtml(q.image)}" style="max-height:90px" alt="" />` : ''}<br/><span style="font-size:10px">(A) ${renderMathToHtmlString(q.options.A)} &nbsp; (B) ${renderMathToHtmlString(q.options.B)} &nbsp; (C) ${renderMathToHtmlString(q.options.C)} &nbsp; (D) ${renderMathToHtmlString(q.options.D)}</span></td>${includeScrutiny ? `<td style="text-align:center;font-weight:700;color:#166534">${q.ans}</td>` : ''}<td style="text-align:center">${q.marks}</td></tr>`
        })
        .join('')}</tbody></table>`
    } else {
      const rowsHtml: string[] = []
      ;(list as IaDescriptiveQuestion[]).forEach((q, qIdx) => {
        q.parts
          .filter((p) => p.text.trim())
          .forEach((p, pIdx) => {
            if (blooms[p.blooms] !== undefined) blooms[p.blooms] += 1
            const co = p.co.toUpperCase()
            if (!coMap[co]) coMap[co] = { qs: [], lvls: new Set() }
            coMap[co].qs.push(`${q.qNum}${p.id}`)
            coMap[co].lvls.add(p.blooms)
            rowsHtml.push(`<tr><td style="text-align:center;font-weight:700">${pIdx === 0 ? `${q.qNum}.${p.id}` : p.id}</td><td>${renderMathToHtmlString(p.text)}${p.image ? `<br/><img src="${escapeHtml(p.image)}" style="max-height:105px" alt="" />` : ''}</td><td style="text-align:center">${escapeHtml(p.marks)}</td><td style="text-align:center">${escapeHtml(p.co)}</td><td style="text-align:center">${escapeHtml(p.blooms)}</td></tr>`)
          })
        if (qIdx === 0 || qIdx === 2 || qIdx === 4) {
          rowsHtml.push(`<tr><td colspan="5" style="text-align:center;font-weight:700;background:#f8fafc">OR</td></tr>`)
        }
      })
      qpHtml = `<table><thead><tr><th style="width:44px">Q.No</th><th>Question</th><th style="width:40px">M</th><th style="width:44px">CO</th><th style="width:44px">Lvl</th></tr></thead><tbody>${rowsHtml.join('')}</tbody></table>`
    }

    const coRows = Object.entries(coMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([co, info]) =>
          `<tr><td style="text-align:center;font-weight:700">${escapeHtml(info.qs.join(', '))}</td><td style="text-align:center;font-weight:700">${escapeHtml(co)}</td><td style="text-align:center">${escapeHtml(Array.from(info.lvls).join(', '))}</td></tr>`
      )
      .join('')

    const scrutinyPage = includeScrutiny
      ? `<section class="page">${renderWatermarkHtml(branding, 'per-page')}<div class="doc-body">
          ${renderBrandedHeaderHtml(branding, 'INTERNAL ASSESSMENT QUESTION PAPER SCRUTINIZER FORMAT', `${activeAlloc.course_code} — ${activeAlloc.course_title} (IA-${activeAlloc.ia_number} · Set ${setLetter})`)}
          ${coRows ? `<table><thead><tr><th>Question Numbers</th><th>Mapped CO</th><th>Bloom's Levels</th></tr></thead><tbody>${coRows}</tbody></table>` : ''}
          <table><thead><tr><th colspan="6" style="text-align:center">Bloom's Cognitive Levels Covered (Auto-Counted)</th></tr></thead><tbody><tr>${(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).map((l) => `<td style="text-align:center;font-weight:700">${l}: ${blooms[l]}</td>`).join('')}</tr></tbody></table>
          <table><thead><tr><th>Scrutiny Parameter</th><th style="width:90px;text-align:center">Observation</th></tr></thead><tbody>
            <tr><td>Questions set strictly within covered syllabus?</td><td style="text-align:center">YES / NO</td></tr>
            <tr><td>Properly mapped to COs and Bloom's cognitive levels?</td><td style="text-align:center">YES / NO</td></tr>
            <tr><td>Marks distribution and Autonomous format followed?</td><td style="text-align:center">YES / NO</td></tr>
          </tbody></table>
          <p style="font-size:10px"><strong>CO Statements:</strong><br/>${escapeHtml(coStatements).replace(/\n/g, '<br/>')}</p>
          <div class="signatures">
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Prepared By (${escapeHtml(faculty.full_name)})</span></div>
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Module / PAC Scrutinizer</span></div>
            <div class="sig-col"><div class="sig-img-wrap"></div><div class="sig-line"></div><span>Academic Advisor / HOD</span></div>
          </div>
        </div></section>`
      : ''

    openBrandedPrintWindow({
      title: `IA${activeAlloc.ia_number}_${activeAlloc.course_code}_Set${setLetter}_${includeScrutiny ? 'SCRUTINY' : 'CLEAN'}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      headHtml: KATEX_PRINT_HEAD_HTML,
      bodyHtml: `<section class="page">${renderWatermarkHtml(branding, 'per-page')}<div class="doc-body">
        ${renderBrandedHeaderHtml(branding, `INTERNAL ASSESSMENT – ${activeAlloc.ia_number}${isOmr ? ' (OMR)' : ''} (SET ${setLetter})`, `${activeAlloc.course_code} — ${activeAlloc.course_title} | Max Marks: 50 | Time: 90 mins`)}
        <div style="margin-bottom:8px"><table style="width:240px;margin:0"><tr><th style="width:42px;text-align:center">USN</th>${'<td></td>'.repeat(10)}</tr></table></div>
        ${qpHtml}
      </div></section>${scrutinyPage}`,
    })
  }

  if (!activeAlloc) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-2">
        <p className="text-sm font-semibold text-slate-800">No IA Question Paper Assignments</p>
        <button type="button" onClick={onBack} className="text-xs font-bold text-indigo-600 hover:underline">
          ← Back to Faculty Portal
        </button>
      </div>
    )
  }

  const subjectSwitcher = allocations.length > 1 && (
    <div className="rounded-xl bg-slate-900 p-3 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-sky-400" />
        Assigned IA Question Papers ({allocations.length} Subjects) — Tap to Switch:
      </p>
      <div className="flex flex-wrap gap-2">
        {allocations.map((ia) => {
          const isSel = ia.id === activeAlloc.id
          return (
            <button
              key={ia.id}
              type="button"
              onClick={() => setActiveId(ia.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition border flex items-center gap-2',
                isSel
                  ? 'bg-indigo-700 border-sky-400 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
              )}
            >
              <span>
                {ia.course_code} · {ia.ia_number === 3 ? 'Imp IA' : `IA-${ia.ia_number}`} ({ia.num_sets}S)
              </span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  ia.status === 'SUBMITTED' ? 'bg-emerald-700 text-white' : 'bg-amber-600 text-white'
                )}
              >
                {ia.status}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  if (!sessionPin) {
    return (
      <div className="space-y-4">
        {subjectSwitcher}
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Portal
        </button>
        <div className="max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-7 space-y-4 text-center shadow-xs">
          <div className="h-14 w-14 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center mx-auto">
            <KeyRound className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Encrypted IA Question Paper Vault</h2>
            <p className="text-xs text-slate-500 mt-1">
              <strong>{activeAlloc.course_code}</strong> — {activeAlloc.course_title}
              <br />
              Enter your <strong>4-Digit Faculty PIN</strong> to decrypt your sets in memory.
            </p>
          </div>
          <form onSubmit={handleUnlock} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full rounded-lg border-2 border-indigo-700 px-3 py-3 text-center text-xl font-mono font-bold tracking-[0.5em]"
              required
            />
            {errorMsg && <p className="text-xs font-semibold text-red-600">{errorMsg}</p>}
            <button
              type="submit"
              disabled={pinInput.length < 4}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-indigo-800 disabled:opacity-40"
            >
              <Lock className="h-4 w-4" /> Unlock IA Drafter
            </button>
          </form>
        </div>
      </div>
    )
  }

  const isSubmitted = activeAlloc.status === 'SUBMITTED'
  const isOmr = qpPattern.startsWith('OMR')

  return (
    <div className="space-y-4">
      {subjectSwitcher}

      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Portal
          </button>
          <h2 className="text-base font-bold text-slate-900">
            IA-{activeAlloc.ia_number}: {activeAlloc.course_code} — {activeAlloc.course_title}
          </h2>
          <p className="text-xs text-slate-500">
            Assigned: {activeAlloc.num_sets} Set(s) · Max Marks: 50 · Time: 90 mins
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1 border border-slate-200 text-xs">
            {(
              [
                { id: 'DESCRIPTIVE', label: 'Descriptive', icon: FileText },
                { id: 'OMR_50', label: 'OMR 50×1M', icon: ListChecks },
                { id: 'OMR_25', label: 'OMR 25×2M', icon: ListChecks },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                disabled={isSubmitted}
                onClick={() => handlePatternSwitch(id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-bold transition',
                  qpPattern === id ? 'bg-indigo-700 text-white' : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {isSubmitted ? (
            <button
              type="button"
              onClick={() => setReopenOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-800 hover:bg-orange-100"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reopen (4-Digit PIN)
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-3 py-1 text-xs font-bold text-indigo-800">
              <Lock className="h-3.5 w-3.5" /> PIN-Encrypted Vault
            </span>
          )}
        </div>
      </div>

      {reopenOpen && (
        <div className="rounded-xl border-2 border-orange-500 bg-orange-50 p-4 space-y-2">
          <p className="text-xs font-bold text-orange-900">Verify 4-Digit PIN to Reopen Submitted Paper to DRAFT:</p>
          <div className="flex gap-2 max-w-sm">
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={reopenPin}
              onChange={(e) => setReopenPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="flex-1 rounded-md border border-orange-300 bg-white px-3 py-1.5 text-sm font-mono font-bold tracking-[0.4em]"
            />
            <button
              type="button"
              disabled={reopenMutation.isPending || reopenPin.length < 4}
              onClick={() => reopenMutation.mutate()}
              className="rounded-md bg-orange-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-orange-700"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => {
                setReopenOpen(false)
                setReopenPin('')
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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

      {/* Multi-Set Tabs */}
      <div className="flex flex-wrap gap-2 rounded-xl bg-slate-200 p-1.5">
        {Array.from({ length: Math.max(1, activeAlloc.num_sets) }, (_, i) => i + 1).map((s) => {
          const list = setsMap[s] ?? []
          const filled = list.filter((q) =>
            'isOmr' in q ? q.text.trim() !== '' : q.parts.some((p) => p.text.trim() !== '')
          ).length
          return (
            <button
              key={s}
              type="button"
              onClick={() => setActiveSet(s)}
              className={cn(
                'flex-1 min-w-[130px] inline-flex items-center justify-center gap-2 rounded-lg py-2 px-3 text-xs font-bold transition',
                activeSet === s ? 'bg-indigo-700 text-white shadow-xs' : 'bg-white text-slate-700'
              )}
            >
              <Layers className="h-3.5 w-3.5" /> Set {String.fromCharCode(64 + s)}
              <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px]">
                {filled}/{list.length} Qs
              </span>
            </button>
          )
        })}
      </div>

      {/* Collapsible Sticky Symbol Toolbar */}
      {!isSubmitted && (
        <div className="sticky top-2 z-20 rounded-xl border border-slate-300 bg-white p-2.5 shadow-xs space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
              <Sigma className="h-4 w-4" /> Math, LaTeX &amp; Engineering Symbols
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFormulaModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-800"
              >
                <Library className="h-3.5 w-3.5" /> Formula Library
              </button>
              <button
                type="button"
                onClick={() => setShowSymbolBar((v) => !v)}
                className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700"
              >
                {showSymbolBar ? 'Hide ▲' : 'Show ▼'}
              </button>
            </div>
          </div>
          {showSymbolBar && (
            <div className="flex flex-wrap gap-1.5">
              {SYMBOLS.map((sym) => (
                <button
                  key={sym.label}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertSnippet(sym.snippet)
                  }}
                  className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-800 hover:bg-indigo-50"
                >
                  {sym.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* OMR or Descriptive Body */}
      {isOmr ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-purple-900">
              OMR Mode ({qpPattern}) — Set {String.fromCharCode(64 + activeSet)}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadOmrCsv}
                className="inline-flex items-center gap-1 rounded-md border border-purple-300 bg-white px-2.5 py-1 font-bold text-purple-800"
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
                    className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-2.5 py-1 font-bold text-white"
                  >
                    <UploadCloud className="h-3.5 w-3.5" /> Upload CSV
                  </button>
                  {activeSet > 1 && (
                    <button
                      type="button"
                      onClick={autoShuffleFromSetA}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-bold text-white"
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
              <div key={q.qNum} className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2 text-xs">
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
                    focusRef.current = { kind: 'OMR_STEM', qIdx }
                  }}
                  onChange={(e) =>
                    setSetsMap((prev) => {
                      const list = [...((prev[activeSet] as IaOmrQuestion[]) ?? [])]
                      list[qIdx] = { ...list[qIdx], text: e.target.value }
                      return { ...prev, [activeSet]: list }
                    })
                  }
                  placeholder={`MCQ ${q.qNum} stem...`}
                  className="w-full rounded border border-slate-300 p-1.5"
                />
                {containsMathOrSpecialSymbols(q.text) && (
                  <div
                    className="rounded bg-slate-50 border border-dashed border-indigo-200 px-2 py-1"
                    dangerouslySetInnerHTML={{ __html: renderMathToHtmlString(q.text) }}
                  />
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  {(['A', 'B', 'C', 'D'] as const).map((k) => (
                    <input
                      key={k}
                      disabled={isSubmitted}
                      placeholder={`Option ${k}`}
                      value={q.options[k]}
                      onFocus={() => {
                        focusRef.current = { kind: 'OMR_OPT', qIdx, optKey: k }
                      }}
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
          {((setsMap[activeSet] as IaDescriptiveQuestion[]) ?? []).map((q, qIdx) => {
            const enteredSum = q.parts.reduce(
              (sum, p) => (p.text.trim() ? sum + (parseFloat(p.marks) || 0) : sum),
              0
            )
            return (
              <div key={q.qNum} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <strong className="text-sm text-indigo-950">
                    Question {q.qNum} ({q.targetMarks} Marks)
                  </strong>
                  <div className="flex items-center gap-2">
                    {q.qNum >= 5 && !isSubmitted && (
                      <button
                        type="button"
                        onClick={() =>
                          setSetsMap((prev) => {
                            const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
                            const cur = { ...list[qIdx] }
                            cur.parts =
                              cur.parts.length === 2
                                ? [...cur.parts, { id: 'c', text: '', marks: '0', co: 'CO3', blooms: 'L2', image: null }]
                                : cur.parts.slice(0, 2)
                            list[qIdx] = cur
                            return { ...prev, [activeSet]: list }
                          })
                        }
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                      >
                        {q.parts.length === 2 ? (
                          <>
                            <Plus className="h-3 w-3" /> Add Part c
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-3 w-3" /> Remove Part c
                          </>
                        )}
                      </button>
                    )}
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[11px] font-bold',
                        enteredSum === q.targetMarks
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      )}
                    >
                      Entered: {enteredSum} / {q.targetMarks} Marks
                    </span>
                  </div>
                </div>

                {q.parts.map((p, pIdx) => (
                  <div key={p.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                    <div className="md:col-span-9 space-y-1.5">
                      <textarea
                        disabled={isSubmitted}
                        rows={2}
                        value={p.text}
                        onFocus={() => {
                          focusRef.current = { kind: 'DESC', qIdx, pIdx }
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
                        placeholder={`Q${q.qNum}.${p.id}) Question text ($...$ for LaTeX)...`}
                        className="w-full rounded-md border border-slate-300 p-2"
                      />
                      {containsMathOrSpecialSymbols(p.text) && (
                        <div
                          className="rounded bg-slate-50 border border-dashed border-indigo-200 px-2.5 py-1.5"
                          dangerouslySetInnerHTML={{ __html: renderMathToHtmlString(p.text) }}
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {!isSubmitted && (
                          <label className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5 cursor-pointer">
                            {p.image ? 'Replace Diagram' : '+ Diagram (<18 KB)'}
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
                                  setErrorMsg(err instanceof Error ? err.message : 'Diagram error')
                                }
                                e.target.value = ''
                              }}
                            />
                          </label>
                        )}
                        {p.image && (
                          <div className="inline-flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1">
                            <img src={p.image} alt="Diagram" className="h-10 rounded" />
                            <span className="text-[10px] font-bold text-emerald-700">{getBase64SizeKB(p.image)} KB</span>
                            {!isSubmitted && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSetsMap((prev) => {
                                    const list = [...((prev[activeSet] as IaDescriptiveQuestion[]) ?? [])]
                                    const copy = { ...list[qIdx] }
                                    copy.parts = copy.parts.map((part, i) =>
                                      i === pIdx ? { ...part, image: null } : part
                                    )
                                    list[qIdx] = copy
                                    return { ...prev, [activeSet]: list }
                                  })
                                }
                                className="text-red-600 font-bold"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        )}
                      </div>
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
            )
          })}
        </div>
      )}

      {/* CO Statements & Action Footer */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <label className="block text-xs font-bold text-slate-800">
          Course Outcome (CO) Statements (Encrypted in Vault &amp; Printed on Scrutiny Pack)
        </label>
        <textarea
          disabled={isSubmitted}
          rows={3}
          value={coStatements}
          onChange={(e) => setCoStatements(e.target.value)}
          className="w-full rounded-md border border-slate-300 p-2 text-xs"
        />
        <div className="flex flex-wrap gap-2">
          {!isSubmitted && (
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate('DRAFT')}
              className="flex-1 min-w-[150px] inline-flex items-center justify-center gap-1.5 rounded-lg border-2 border-indigo-700 bg-white px-4 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-50"
            >
              <Save className="h-4 w-4" /> Save Encrypted Draft
            </button>
          )}
          <button
            type="button"
            onClick={() => printPack(true)}
            className="flex-1 min-w-[170px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-800 hover:bg-indigo-100"
          >
            <FileDown className="h-4 w-4" /> Scrutiny Pack (Set {String.fromCharCode(64 + activeSet)})
          </button>
          <button
            type="button"
            onClick={() => printPack(false)}
            className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-bold text-slate-800 hover:bg-slate-200"
          >
            <Printer className="h-4 w-4" /> Clean QP (Set {String.fromCharCode(64 + activeSet)})
          </button>
          {!isSubmitted && (
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => {
                if (window.confirm(`Encrypt & Submit final copy (${activeAlloc.num_sets} Set(s)) to COE Vault?`)) {
                  saveMutation.mutate('SUBMITTED')
                }
              }}
              className="flex-1 min-w-[170px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
            >
              <Send className="h-4 w-4" /> Encrypt &amp; Submit
            </button>
          )}
        </div>
      </div>

      {/* Formula Library Modal */}
      {formulaModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-1.5">
                <Library className="h-4 w-4" /> VTU Engineering Formula Library
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
