import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ShieldCheck,
  Download,
  Upload,
  Printer,
  Plus,
  Save,
  CheckCircle2,
  AlertTriangle,
  Lock,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import {
  BUILTIN_EVALUATION_PATTERNS,
  computeScriptEvaluation,
  getQuestionMax,
  marksToDigitWords,
  resolvePattern,
  type EvaluationPatternConfig,
  type EvaluationRuleType,
  type QuestionMarksMap,
} from './evaluationPatterns'
import { exportBundleEvaluationWorkbook, parseEvaluationWorkbookFile } from './evaluationExcel'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
} from './printBranding'
import { cn } from '@/utils/cn'

interface BlindBundleRow {
  id: string
  bundle_code: string
  effective_course_code: string
  course_title: string
  program_code: string
  program_level: string
  usn_series_prefix: string | null
  script_count: number
  entered_count: number
  mpc_count: number
  see_max_marks: number
  see_scale_to: number
  evaluator_name: string | null
  status: string
  evaluation_pattern_code: string
  evaluation_pattern_config: EvaluationPatternConfig | null
  locked_from_form_a: boolean
}

interface BlindScriptRow {
  id: string
  script_sequence: number
  dummy_code: string
  booklet_number: string | null
  question_marks_json: QuestionMarksMap
  see_marks_raw: number | null
  moderation_marks: number | null
  final_see_marks: number | null
  see_marks_scaled: number | null
  is_absent: boolean
  is_malpractice: boolean
  evaluation_status: string
  evaluator_remarks: string | null
}

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  canConfigurePatterns: boolean
}

interface LocalScriptDraft {
  questionMarks: QuestionMarksMap
  directRaw: number | null
  moderation: number | null
  dirty: boolean
}

export function EvaluationDeskTab({
  institutionId,
  institutionName,
  cycle,
  canConfigurePatterns,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const xlsxInputRef = useRef<HTMLInputElement | null>(null)

  const [selectedBundleId, setSelectedBundleId] = useState('')
  const [evaluatorNameInput, setEvaluatorNameInput] = useState('')
  const [drafts, setDrafts] = useState<Record<string, LocalScriptDraft>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Custom pattern builder modal state
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customCode, setCustomCode] = useState('')
  const [customRuleType, setCustomRuleType] = useState<EvaluationRuleType>('BEST_N_PLUS_MANDATORY')
  const [customTotalQ, setCustomTotalQ] = useState('8')
  const [customSubparts, setCustomSubparts] = useState('a,b,c')
  const [customPickN, setCustomPickN] = useState('4')
  const [customMandatory, setCustomMandatory] = useState('8')
  const [customPerQMax, setCustomPerQMax] = useState('20')
  const [customMaxRaw, setCustomMaxRaw] = useState('100')
  const [customScaleTo, setCustomScaleTo] = useState('50')

  const { data: customPatterns = [] } = useQuery<EvaluationPatternConfig[]>({
    queryKey: ['exam_evaluation_patterns', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_evaluation_patterns')
        .select('*')
        .eq('institution_id', institutionId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        id: r.id as string,
        code: r.code as string,
        name: r.name as string,
        rule_type: r.rule_type as EvaluationRuleType,
        total_questions: Number(r.total_questions ?? 10),
        subparts: (r.subparts as string[]) ?? ['a', 'b', 'c'],
        or_pairs: (r.or_pairs as Array<[number, number]>) ?? [],
        optional_questions: (r.optional_questions as number[]) ?? [],
        pick_best_n: Number(r.pick_best_n ?? 0),
        mandatory_questions: (r.mandatory_questions as number[]) ?? [],
        per_question_max: Number(r.per_question_max ?? 20),
        question_max_overrides: (r.question_max_overrides as Record<string, number>) ?? {},
        max_raw_marks: Number(r.max_raw_marks ?? 100),
        scale_to_marks: Number(r.scale_to_marks ?? 50),
        is_system: Boolean(r.is_system),
      }))
    },
  })

  const allPatterns = useMemo(() => {
    const customCodes = new Set(customPatterns.map((p) => p.code))
    return [...customPatterns, ...BUILTIN_EVALUATION_PATTERNS.filter((b) => !customCodes.has(b.code))]
  }, [customPatterns])

  const { data: bundles = [], isLoading: loadingBundles } = useQuery<BlindBundleRow[]>({
    queryKey: ['blind_eval_bundles', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_blind_evaluation_bundles', {
        p_institution_id: institutionId,
        p_exam_cycle_id: cycle!.id,
      })
      if (error) throw error
      return (data ?? []) as BlindBundleRow[]
    },
  })

  const activeBundle = useMemo(() => {
    if (selectedBundleId) return bundles.find((b) => b.id === selectedBundleId) ?? bundles[0] ?? null
    return bundles[0] ?? null
  }, [bundles, selectedBundleId])

  const activePattern = useMemo(
    () =>
      resolvePattern(
        activeBundle?.evaluation_pattern_code,
        activeBundle?.evaluation_pattern_config,
        customPatterns
      ),
    [activeBundle, customPatterns]
  )

  const { data: scripts = [], isLoading: loadingScripts } = useQuery<BlindScriptRow[]>({
    queryKey: ['blind_eval_scripts', institutionId, activeBundle?.id],
    enabled: Boolean(activeBundle?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_blind_evaluation_bundle_scripts', {
        p_institution_id: institutionId,
        p_bundle_id: activeBundle!.id,
      })
      if (error) throw error
      return (data ?? []) as BlindScriptRow[]
    },
  })

  const isBundleLocked = Boolean(
    activeBundle && (activeBundle.status === 'DECODED' || activeBundle.status === 'LOCKED')
  )

  const getDraft = (s: BlindScriptRow): LocalScriptDraft => {
    return (
      drafts[s.id] ?? {
        questionMarks: s.question_marks_json ?? {},
        directRaw: s.see_marks_raw,
        moderation: s.moderation_marks,
        dirty: false,
      }
    )
  }

  const updateSubpart = (s: BlindScriptRow, qNum: number, subpart: string, rawText: string) => {
    const val = rawText.trim() === '' ? null : Number(rawText)
    if (val !== null && (Number.isNaN(val) || val < 0)) return
    const cur = getDraft(s)
    const qKey = String(qNum)
    const nextQm: QuestionMarksMap = {
      ...cur.questionMarks,
      [qKey]: { ...(cur.questionMarks[qKey] ?? {}), [subpart]: val },
    }
    setDrafts((prev) => ({
      ...prev,
      [s.id]: { ...cur, questionMarks: nextQm, dirty: true },
    }))
  }

  const updateDirectOrMod = (s: BlindScriptRow, field: 'directRaw' | 'moderation', rawText: string) => {
    const val = rawText.trim() === '' ? null : Number(rawText)
    if (val !== null && (Number.isNaN(val) || val < 0)) return
    const cur = getDraft(s)
    setDrafts((prev) => ({
      ...prev,
      [s.id]: { ...cur, [field]: val, dirty: true },
    }))
  }

  const saveScriptMutation = useMutation({
    mutationFn: async (s: BlindScriptRow) => {
      const d = getDraft(s)
      const computed = computeScriptEvaluation(activePattern, d.questionMarks, d.directRaw, d.moderation)
      if (computed.exceededQuestions.length > 0) {
        throw new Error(
          `${s.dummy_code}: Question(s) Q${computed.exceededQuestions.join(', Q')} exceed per-question max marks.`
        )
      }
      const { error } = await supabase.rpc('save_blind_script_evaluation', {
        p_institution_id: institutionId,
        p_script_id: s.id,
        p_question_marks_json: d.questionMarks,
        p_see_marks_raw: computed.totalSeeMarks,
        p_moderation_marks: d.moderation,
        p_final_see_marks: computed.finalSeeMarks,
        p_see_marks_scaled: computed.scaledMarks,
        p_evaluator_remarks: s.evaluator_remarks,
      })
      if (error) throw error
      return s.id
    },
    onSuccess: (scriptId) => {
      setErrorMsg(null)
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[scriptId]
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['blind_eval_scripts', institutionId, activeBundle?.id] })
      queryClient.invalidateQueries({ queryKey: ['blind_eval_bundles', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Save failed'),
  })

  const saveAllDirtyMutation = useMutation({
    mutationFn: async () => {
      const dirtyRows = scripts.filter((s) => !s.is_malpractice && !s.is_absent && drafts[s.id]?.dirty)
      for (const s of dirtyRows) {
        const d = drafts[s.id]
        const computed = computeScriptEvaluation(activePattern, d.questionMarks, d.directRaw, d.moderation)
        if (computed.exceededQuestions.length > 0) {
          throw new Error(
            `${s.dummy_code}: Q${computed.exceededQuestions.join(', Q')} exceeds max question marks.`
          )
        }
        const { error } = await supabase.rpc('save_blind_script_evaluation', {
          p_institution_id: institutionId,
          p_script_id: s.id,
          p_question_marks_json: d.questionMarks,
          p_see_marks_raw: computed.totalSeeMarks,
          p_moderation_marks: d.moderation,
          p_final_see_marks: computed.finalSeeMarks,
          p_see_marks_scaled: computed.scaledMarks,
          p_evaluator_remarks: s.evaluator_remarks,
        })
        if (error) throw error
      }
      return dirtyRows.length
    },
    onSuccess: (cnt) => {
      setErrorMsg(null)
      setDrafts({})
      setNotice(`Saved question-wise marks for ${cnt} script(s).`)
      queryClient.invalidateQueries({ queryKey: ['blind_eval_scripts', institutionId, activeBundle?.id] })
      queryClient.invalidateQueries({ queryKey: ['blind_eval_bundles', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Bulk save failed'),
  })

  const updateBundlePatternMutation = useMutation({
    mutationFn: async ({
      pattern,
      evaluatorName,
    }: {
      pattern?: EvaluationPatternConfig
      evaluatorName?: string
    }) => {
      if (!activeBundle) return
      const { error } = await supabase.rpc('update_blind_bundle_meta', {
        p_institution_id: institutionId,
        p_bundle_id: activeBundle.id,
        p_evaluator_name: evaluatorName ?? null,
        p_pattern_code: pattern?.code ?? null,
        p_pattern_config: pattern ?? null,
        p_see_max_marks: pattern?.max_raw_marks ?? null,
        p_see_scale_to: pattern?.scale_to_marks ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('Updated bundle evaluation pattern / evaluator metadata.')
      queryClient.invalidateQueries({ queryKey: ['blind_eval_bundles', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_script_bundles', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Pattern update failed'),
  })

  const saveCustomPatternMutation = useMutation({
    mutationFn: async () => {
      const code = customCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
      const name = customName.trim()
      if (!code || !name) throw new Error('Pattern code and label are required.')
      const totalQ = customRuleType === 'DIRECT_OMR' ? 0 : Math.max(1, Math.min(20, Number(customTotalQ) || 8))
      const subparts =
        customRuleType === 'DIRECT_OMR'
          ? []
          : customSubparts
              .split(',')
              .map((x) => x.trim().toLowerCase())
              .filter(Boolean)
      const mandatory = customMandatory
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => !Number.isNaN(n) && n >= 1 && n <= totalQ)
      const mandSet = new Set(mandatory)
      const optional =
        customRuleType === 'BEST_N_PLUS_MANDATORY'
          ? Array.from({ length: totalQ }, (_, i) => i + 1).filter((q) => !mandSet.has(q))
          : []
      const pairs: Array<[number, number]> =
        customRuleType === 'PAIRED_OR'
          ? Array.from({ length: Math.floor(totalQ / 2) }, (_, idx) => [idx * 2 + 1, idx * 2 + 2])
          : []

      const payload: EvaluationPatternConfig = {
        code,
        name,
        rule_type: customRuleType,
        total_questions: totalQ,
        subparts: subparts.length > 0 ? subparts : ['a', 'b', 'c'],
        or_pairs: pairs,
        optional_questions: optional,
        pick_best_n: customRuleType === 'BEST_N_PLUS_MANDATORY' ? Math.max(1, Number(customPickN) || 4) : 0,
        mandatory_questions: mandatory,
        per_question_max: Math.max(1, Number(customPerQMax) || 20),
        question_max_overrides: {},
        max_raw_marks: Math.max(1, Number(customMaxRaw) || 100),
        scale_to_marks: Math.max(1, Number(customScaleTo) || 50),
      }

      const { error } = await supabase.from('exam_evaluation_patterns').upsert(
        {
          institution_id: institutionId,
          ...payload,
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        },
        { onConflict: 'institution_id,code' }
      )
      if (error) throw error
      return payload
    },
    onSuccess: (created) => {
      setShowCustomModal(false)
      setCustomCode('')
      setCustomName('')
      setNotice(`Saved custom evaluation pattern "${created.name}".`)
      queryClient.invalidateQueries({ queryKey: ['exam_evaluation_patterns', institutionId] })
      if (activeBundle && !isBundleLocked) {
        updateBundlePatternMutation.mutate({ pattern: created })
      }
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to save custom pattern'),
  })

  const handleImportXlsx = async (file: File) => {
    if (!activeBundle || isBundleLocked) return
    setErrorMsg(null)
    try {
      const parsed = await parseEvaluationWorkbookFile(file, activePattern)
      const byDummy = new Map(scripts.map((s) => [s.dummy_code.trim().toUpperCase(), s]))
      let saved = 0
      let skippedMpc = 0

      for (const row of parsed.rows) {
        const target = byDummy.get(row.dummyCode)
        if (!target) continue
        if (target.is_malpractice || target.is_absent) {
          skippedMpc += 1
          continue
        }
        const { error } = await supabase.rpc('save_blind_script_evaluation', {
          p_institution_id: institutionId,
          p_script_id: target.id,
          p_question_marks_json: row.questionMarks,
          p_see_marks_raw: row.seeMarksRaw,
          p_moderation_marks: row.moderationMarks,
          p_final_see_marks: row.finalSeeMarks,
          p_see_marks_scaled: row.scaledMarks,
          p_evaluator_remarks: target.evaluator_remarks,
        })
        if (!error) saved += 1
      }

      if (parsed.evaluatorName && parsed.evaluatorName !== activeBundle.evaluator_name) {
        await supabase.rpc('update_blind_bundle_meta', {
          p_institution_id: institutionId,
          p_bundle_id: activeBundle.id,
          p_evaluator_name: parsed.evaluatorName,
        })
      }

      setDrafts({})
      setNotice(
        `Imported question-wise marks for ${saved} script(s) into ${activeBundle.bundle_code}` +
          (skippedMpc > 0 ? ` (${skippedMpc} MPC/Absent script(s) skipped)` : '') +
          (parsed.evaluatorName ? ` · Evaluator: ${parsed.evaluatorName}` : '') +
          '.'
      )
      queryClient.invalidateQueries({ queryKey: ['blind_eval_scripts', institutionId, activeBundle.id] })
      queryClient.invalidateQueries({ queryKey: ['blind_eval_bundles', institutionId, cycle?.id] })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Workbook import failed')
    }
  }

  const printSignedEvaluationStatement = async () => {
    if (!cycle || !activeBundle) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigs = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? sigs.get(branding.coe_signature_path) : null
    const evalName = evaluatorNameInput.trim() || activeBundle.evaluator_name || '________________________'
    const gradable = scripts.filter((s) => !s.is_absent && !s.is_malpractice)

    const rowsHtml = gradable
      .map((s, idx) => {
        const d = getDraft(s)
        const c = computeScriptEvaluation(activePattern, d.questionMarks, d.directRaw, d.moderation)
        const finalVal = c.finalSeeMarks ?? s.final_see_marks ?? s.see_marks_raw
        return `<tr>
          <td style="text-align:center">${idx + 1}</td>
          <td style="font-family:monospace;font-weight:700">${escapeHtml(s.dummy_code)}</td>
          <td style="text-align:center;font-weight:700">${finalVal !== null ? finalVal : ''}</td>
          <td>${escapeHtml(marksToDigitWords(finalVal))}</td>
        </tr>`
      })
      .join('')

    openBrandedPrintWindow({
      title: `${activeBundle.bundle_code}_Signed_Marks_Statement`,
      landscape: false,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: `
        ${renderWatermarkHtml(branding, 'per-page')}
        ${renderBrandedHeaderHtml(
          branding,
          `SEE EVALUATION MARKS STATEMENT (${cycle.name})`,
          `Course: ${activeBundle.effective_course_code} — ${activeBundle.course_title} | Bundle: ${activeBundle.bundle_code} | Pattern: ${activePattern.name}`
        )}
        <table>
          <thead>
            <tr>
              <th style="width:45px;text-align:center">Sl. No.</th>
              <th style="width:180px">Answer Booklet Code</th>
              <th style="width:140px;text-align:center">SEE Marks in Figures (${activePattern.max_raw_marks})</th>
              <th>SEE Marks in Words</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="signatures" style="margin-top:34px">
          ${renderSignatureBlockHtml(`Evaluator: ${evalName}`, null)}
          ${renderSignatureBlockHtml('Chief Valuator / Moderator', null)}
          ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSigUrl)}
        </div>
      `,
    })
  }

  const dirtyCount = Object.values(drafts).filter((d) => d.dirty).length
  const mpcScripts = scripts.filter((s) => s.is_malpractice)
  const gradableScripts = scripts.filter((s) => !s.is_malpractice && !s.is_absent)
  const isDirectOmr = activePattern.rule_type === 'DIRECT_OMR' || activePattern.total_questions === 0
  const subparts = activePattern.subparts.length > 0 ? activePattern.subparts : ['total']

  if (!cycle) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        Select an Exam Cycle to open the Blind Evaluation Marks-Entry Desk.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Blind Evaluation Marks-Entry Desk — {cycle.code}
          </h2>
          <p className="text-xs text-slate-500">
            Dedicated COE lab marks-entry portal fed from Locked Form A bundles. Student USNs and names are strictly
            masked; Absent scripts are excluded and Malpractice (MPC) scripts are isolated.
          </p>
        </div>

        {dirtyCount > 0 && !isBundleLocked && (
          <button
            type="button"
            disabled={saveAllDirtyMutation.isPending}
            onClick={() => saveAllDirtyMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            {saveAllDirtyMutation.isPending ? 'Saving...' : `Save All Changes (${dirtyCount})`}
          </button>
        )}
      </div>

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

      {loadingBundles ? (
        <div className="py-10 text-center text-xs text-slate-500">Loading blind evaluation bundles...</div>
      ) : bundles.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
          No bundles available for <strong>{cycle.code}</strong> yet. Lock Form A in <strong>A/B Forms &amp; QPDS</strong>{' '}
          and generate bundles in <strong>Bundles &amp; Decoding</strong> first.
        </div>
      ) : activeBundle ? (
        <>
          {/* Controls Bar: Bundle, QP Pattern Dropdown, Evaluator Name, Excel & Print */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
              <div className="md:col-span-4">
                <label className="block font-semibold text-slate-700 mb-1">Active Bundle (Blind)</label>
                <select
                  value={activeBundle.id}
                  onChange={(e) => {
                    const next = bundles.find((b) => b.id === e.target.value)
                    setSelectedBundleId(e.target.value)
                    setEvaluatorNameInput(next?.evaluator_name ?? '')
                    setDrafts({})
                  }}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono font-medium"
                >
                  {bundles.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bundle_code} · {b.entered_count}/{b.script_count - b.mpc_count} entered ({b.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-5">
                <label className="block font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1">
                    <SlidersHorizontal className="h-3 w-3 text-indigo-600" />
                    QP Evaluation Pattern
                  </span>
                  {canConfigurePatterns && (
                    <button
                      type="button"
                      onClick={() => setShowCustomModal(true)}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      <Plus className="h-3 w-3" /> Custom Pattern
                    </button>
                  )}
                </label>
                <select
                  disabled={isBundleLocked}
                  value={activePattern.code}
                  onChange={(e) => {
                    const picked = allPatterns.find((p) => p.code === e.target.value)
                    if (picked) updateBundlePatternMutation.mutate({ pattern: picked })
                  }}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-medium disabled:bg-slate-100"
                >
                  {allPatterns.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block font-semibold text-slate-700 mb-1">Evaluator Name</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    disabled={isBundleLocked}
                    placeholder="Evaluator Name"
                    value={evaluatorNameInput || activeBundle.evaluator_name || ''}
                    onChange={(e) => setEvaluatorNameInput(e.target.value)}
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    disabled={isBundleLocked}
                    onClick={() =>
                      updateBundlePatternMutation.mutate({
                        evaluatorName: evaluatorNameInput.trim() || activeBundle.evaluator_name || '',
                      })
                    }
                    className="rounded-md bg-slate-900 px-2.5 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-100 px-2 py-1 font-mono font-semibold text-slate-800">
                  {activeBundle.effective_course_code} · {activeBundle.program_code} ({activeBundle.program_level})
                </span>
                {activeBundle.locked_from_form_a && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-2 py-1 font-semibold text-emerald-700">
                    <Lock className="h-3 w-3" /> Locked Form A Verified
                  </span>
                )}
                {mpcScripts.length > 0 && (
                  <span className="rounded bg-amber-50 border border-amber-300 px-2 py-1 font-semibold text-amber-800">
                    {mpcScripts.length} MPC Script(s) Isolated
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    exportBundleEvaluationWorkbook({
                      institutionName,
                      cycleName: cycle.name,
                      bundleCode: activeBundle.bundle_code,
                      courseCode: activeBundle.effective_course_code,
                      courseTitle: activeBundle.course_title,
                      evaluatorName: evaluatorNameInput.trim() || activeBundle.evaluator_name || '',
                      pattern: activePattern,
                      scripts,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-900 hover:bg-emerald-100"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export .xlsx (Marks Entry + Print)
                </button>

                <input
                  ref={xlsxInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleImportXlsx(f)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={isBundleLocked}
                  onClick={() => xlsxInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 font-medium text-indigo-900 hover:bg-indigo-100 disabled:opacity-40"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import Filled .xlsx
                </button>

                <button
                  type="button"
                  onClick={printSignedEvaluationStatement}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Statement (Figures &amp; Words)
                </button>
              </div>
            </div>
          </div>

          {/* Blind Question-Wise Marks Grid */}
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 border-r border-slate-200 text-center w-10">
                      Sl.
                    </th>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2.5 py-2 border-r border-slate-200 min-w-[140px]">
                      Coding / Dummy ID
                    </th>
                    {!isDirectOmr &&
                      Array.from({ length: activePattern.total_questions }, (_, idx) => {
                        const qNum = idx + 1
                        const isMand = activePattern.mandatory_questions.includes(qNum)
                        const qMax = getQuestionMax(activePattern, qNum)
                        return (
                          <th
                            key={qNum}
                            colSpan={subparts.length + 1}
                            className={cn(
                              'px-1.5 py-1 border-r border-slate-200 text-center font-bold',
                              isMand ? 'bg-amber-50 text-amber-900' : idx % 2 === 0 ? 'bg-slate-50' : 'bg-indigo-50/40'
                            )}
                          >
                            Q.{qNum} {isMand ? '(MAND)' : ''} <span className="font-normal text-[10px]">/{qMax}</span>
                          </th>
                        )
                      })}
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 border-r border-slate-200 text-center min-w-[74px]">
                      Total SEE ({activePattern.max_raw_marks})
                    </th>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 border-r border-slate-200 text-center min-w-[74px]">
                      Moderation
                    </th>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 border-r border-slate-200 text-center min-w-[54px]">
                      Diff
                    </th>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 border-r border-slate-200 text-center min-w-[74px]">
                      Final ({activePattern.max_raw_marks})
                    </th>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 border-r border-slate-200 text-center min-w-[66px]">
                      Scaled ({activePattern.scale_to_marks})
                    </th>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 border-r border-slate-200 min-w-[110px]">
                      In Words
                    </th>
                    <th rowSpan={isDirectOmr ? 1 : 2} className="px-2 py-2 text-center w-16">
                      Save
                    </th>
                  </tr>
                  {!isDirectOmr && (
                    <tr className="bg-slate-50/70 border-t border-slate-200">
                      {Array.from({ length: activePattern.total_questions }, (_, idx) => {
                        const qNum = idx + 1
                        return (
                          <FragmentSubHeaders key={qNum} subparts={subparts} />
                        )
                      })}
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingScripts ? (
                    <tr>
                      <td colSpan={40} className="px-4 py-8 text-center text-slate-500">
                        Loading blind scripts...
                      </td>
                    </tr>
                  ) : (
                    gradableScripts.map((s, idx) => {
                      const d = getDraft(s)
                      const computed = computeScriptEvaluation(
                        activePattern,
                        d.questionMarks,
                        d.directRaw,
                        d.moderation
                      )
                      return (
                        <tr key={s.id} className={cn('hover:bg-slate-50', d.dirty && 'bg-amber-50/30')}>
                          <td className="px-2 py-1.5 border-r border-slate-100 text-center text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="px-2.5 py-1.5 border-r border-slate-100 font-mono font-bold text-slate-900">
                            {s.dummy_code}
                          </td>

                          {!isDirectOmr &&
                            Array.from({ length: activePattern.total_questions }, (_, qIdx) => {
                              const qNum = qIdx + 1
                              const qTot = computed.questionTotals[qNum] ?? 0
                              const isCounted = computed.countedQuestions.has(qNum)
                              const isExceeded = computed.exceededQuestions.includes(qNum)
                              return (
                                <QuestionCells
                                  key={qNum}
                                  qNum={qNum}
                                  subparts={subparts}
                                  qValues={d.questionMarks[String(qNum)] ?? {}}
                                  qTotal={qTot}
                                  isCounted={isCounted}
                                  isExceeded={isExceeded}
                                  disabled={isBundleLocked}
                                  onChange={(sp, val) => updateSubpart(s, qNum, sp, val)}
                                />
                              )
                            })}

                          <td className="px-1.5 py-1.5 border-r border-slate-100 text-center font-mono font-bold">
                            {isDirectOmr ? (
                              <input
                                type="number"
                                min={0}
                                max={activePattern.max_raw_marks}
                                step="0.5"
                                disabled={isBundleLocked}
                                value={d.directRaw ?? ''}
                                onChange={(e) => updateDirectOrMod(s, 'directRaw', e.target.value)}
                                className="w-16 rounded border border-slate-300 px-1.5 py-1 text-center font-mono"
                              />
                            ) : (
                              <span className="text-slate-900">{computed.totalSeeMarks ?? '—'}</span>
                            )}
                          </td>

                          <td className="px-1.5 py-1.5 border-r border-slate-100 text-center">
                            <input
                              type="number"
                              min={0}
                              max={activePattern.max_raw_marks}
                              step="0.5"
                              disabled={isBundleLocked}
                              value={d.moderation ?? ''}
                              placeholder="—"
                              onChange={(e) => updateDirectOrMod(s, 'moderation', e.target.value)}
                              className="w-14 rounded border border-slate-300 px-1 py-1 text-center font-mono disabled:bg-slate-100"
                            />
                          </td>

                          <td className="px-1.5 py-1.5 border-r border-slate-100 text-center font-mono text-slate-600">
                            {computed.marksDifference !== null ? computed.marksDifference : '—'}
                          </td>

                          <td className="px-2 py-1.5 border-r border-slate-100 text-center font-mono font-bold text-indigo-800">
                            {computed.finalSeeMarks ?? '—'}
                          </td>

                          <td className="px-2 py-1.5 border-r border-slate-100 text-center font-mono font-semibold text-emerald-700">
                            {computed.scaledMarks ?? '—'}
                          </td>

                          <td className="px-2 py-1.5 border-r border-slate-100 text-slate-600">
                            {marksToDigitWords(computed.finalSeeMarks)}
                          </td>

                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              disabled={isBundleLocked || !d.dirty || saveScriptMutation.isPending}
                              onClick={() => saveScriptMutation.mutate(s)}
                              className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-30"
                            >
                              Save
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Isolated Malpractice (MPC) Queue */}
          {mpcScripts.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3.5 space-y-2">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                Isolated Malpractice (MPC) Scripts ({mpcScripts.length}) — Blocked from Evaluation
              </p>
              <div className="flex flex-wrap gap-2">
                {mpcScripts.map((m) => (
                  <span
                    key={m.id}
                    className="rounded-md bg-white border border-amber-300 px-2.5 py-1 text-xs font-mono font-semibold text-amber-900"
                  >
                    {m.dummy_code} · MPC / WITHHELD
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Custom Pattern Builder Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-lg">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Create Configurable QP Evaluation Pattern</h3>
              <button type="button" onClick={() => setShowCustomModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Code *</label>
                  <input
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value)}
                    placeholder="MBA_8Q_Q8M"
                    className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono uppercase"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Display Name *</label>
                  <input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="MBA 8Q · Best 4 of Q1–Q7 + Q8 Case Study"
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Scoring Rule</label>
                <select
                  value={customRuleType}
                  onChange={(e) => setCustomRuleType(e.target.value as EvaluationRuleType)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5"
                >
                  <option value="PAIRED_OR">Paired Modules (OR) — e.g. Max(Q1,Q2) + Max(Q3,Q4)...</option>
                  <option value="BEST_N_PLUS_MANDATORY">Best N Questions + Mandatory Question(s) — e.g. Q1–Q7 Best 4 + Q8 Mandatory</option>
                  <option value="SUM_ALL">Sum All Questions</option>
                  <option value="DIRECT_OMR">Direct Score / OMR (No Question Grid)</option>
                </select>
              </div>

              {customRuleType !== 'DIRECT_OMR' && (
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Total Questions</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={customTotalQ}
                      onChange={(e) => setCustomTotalQ(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Sub-parts (CSV)</label>
                    <input
                      value={customSubparts}
                      onChange={(e) => setCustomSubparts(e.target.value)}
                      placeholder="a,b,c"
                      className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Max Marks / Q</label>
                    <input
                      type="number"
                      min={1}
                      value={customPerQMax}
                      onChange={(e) => setCustomPerQMax(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                </div>
              )}

              {customRuleType === 'BEST_N_PLUS_MANDATORY' && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Pick Best N (Optional Pool)</label>
                    <input
                      type="number"
                      min={1}
                      value={customPickN}
                      onChange={(e) => setCustomPickN(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Mandatory Question(s) (CSV)</label>
                    <input
                      value={customMandatory}
                      onChange={(e) => setCustomMandatory(e.target.value)}
                      placeholder="8"
                      className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Max Raw SEE Marks</label>
                  <input
                    type="number"
                    min={1}
                    value={customMaxRaw}
                    onChange={(e) => setCustomMaxRaw(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Scale To Marks</label>
                  <input
                    type="number"
                    min={1}
                    value={customScaleTo}
                    onChange={(e) => setCustomScaleTo(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saveCustomPatternMutation.isPending}
                  onClick={() => saveCustomPatternMutation.mutate()}
                  className="rounded bg-indigo-600 px-3.5 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  Save Pattern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FragmentSubHeaders({ subparts }: { subparts: string[] }) {
  return (
    <>
      {subparts.map((sp) => (
        <th key={sp} className="px-1 py-1 text-center font-medium text-slate-500 border-r border-slate-100 w-10">
          {sp}
        </th>
      ))}
      <th className="px-1 py-1 text-center font-semibold text-slate-700 border-r border-slate-200 w-11">Tot</th>
    </>
  )
}

function QuestionCells({
  qNum,
  subparts,
  qValues,
  qTotal,
  isCounted,
  isExceeded,
  disabled,
  onChange,
}: {
  qNum: number
  subparts: string[]
  qValues: Record<string, number | null>
  qTotal: number
  isCounted: boolean
  isExceeded: boolean
  disabled: boolean
  onChange: (sp: string, val: string) => void
}) {
  return (
    <>
      {subparts.map((sp) => (
        <td key={`${qNum}-${sp}`} className="px-0.5 py-1 border-r border-slate-100 text-center">
          <input
            type="number"
            min={0}
            step="0.5"
            disabled={disabled}
            value={qValues[sp] ?? ''}
            onChange={(e) => onChange(sp, e.target.value)}
            className="w-9 rounded border border-slate-200 px-0.5 py-0.5 text-center font-mono text-[11px] focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
          />
        </td>
      ))}
      <td
        className={cn(
          'px-1 py-1 border-r border-slate-200 text-center font-mono font-bold',
          isExceeded
            ? 'bg-red-100 text-red-700'
            : isCounted
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-slate-50/70 text-slate-400'
        )}
      >
        {qTotal}
      </td>
    </>
  )
}
