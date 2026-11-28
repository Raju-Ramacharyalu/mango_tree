export type EvaluationRuleType =
  | 'PAIRED_OR'
  | 'BEST_N_PLUS_MANDATORY'
  | 'SUM_ALL'
  | 'DIRECT_OMR'

export interface EvaluationPatternConfig {
  id?: string
  code: string
  name: string
  rule_type: EvaluationRuleType
  total_questions: number
  subparts: string[]
  or_pairs: Array<[number, number]>
  optional_questions: number[]
  pick_best_n: number
  mandatory_questions: number[]
  per_question_max: number
  question_max_overrides: Record<string, number>
  max_raw_marks: number
  scale_to_marks: number
  is_system?: boolean
}

export type QuestionMarksMap = Record<string, Record<string, number | null>>

export const BUILTIN_EVALUATION_PATTERNS: EvaluationPatternConfig[] = [
  {
    code: 'VTU_10Q_5MOD_OR',
    name: '10 Questions · 5 Modules (OR) · 100M → 50M',
    rule_type: 'PAIRED_OR',
    total_questions: 10,
    subparts: ['a', 'b', 'c'],
    or_pairs: [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
    ],
    optional_questions: [],
    pick_best_n: 0,
    mandatory_questions: [],
    per_question_max: 20,
    question_max_overrides: {},
    max_raw_marks: 100,
    scale_to_marks: 50,
    is_system: true,
  },
  {
    code: 'PG_8Q_BEST4_Q8M',
    name: '8 Questions · Best 4 of Q1–Q7 + Q8 Mandatory (20M each) · 100M → 50M',
    rule_type: 'BEST_N_PLUS_MANDATORY',
    total_questions: 8,
    subparts: ['a', 'b', 'c'],
    or_pairs: [],
    optional_questions: [1, 2, 3, 4, 5, 6, 7],
    pick_best_n: 4,
    mandatory_questions: [8],
    per_question_max: 20,
    question_max_overrides: {},
    max_raw_marks: 100,
    scale_to_marks: 50,
    is_system: true,
  },
  {
    code: 'PG_8Q_BEST5_Q8M',
    name: '8 Questions · Best 5 of Q1–Q7 (16M) + Q8 Mandatory (20M) · 100M → 50M',
    rule_type: 'BEST_N_PLUS_MANDATORY',
    total_questions: 8,
    subparts: ['a', 'b', 'c'],
    or_pairs: [],
    optional_questions: [1, 2, 3, 4, 5, 6, 7],
    pick_best_n: 5,
    mandatory_questions: [8],
    per_question_max: 16,
    question_max_overrides: { '8': 20 },
    max_raw_marks: 100,
    scale_to_marks: 50,
    is_system: true,
  },
  {
    code: 'OMR_50',
    name: 'OMR Objective · 50 Marks Direct → 50M',
    rule_type: 'DIRECT_OMR',
    total_questions: 0,
    subparts: [],
    or_pairs: [],
    optional_questions: [],
    pick_best_n: 0,
    mandatory_questions: [],
    per_question_max: 50,
    question_max_overrides: {},
    max_raw_marks: 50,
    scale_to_marks: 50,
    is_system: true,
  },
  {
    code: 'OMR_100',
    name: 'OMR Objective · 100 Marks Direct → 50M',
    rule_type: 'DIRECT_OMR',
    total_questions: 0,
    subparts: [],
    or_pairs: [],
    optional_questions: [],
    pick_best_n: 0,
    mandatory_questions: [],
    per_question_max: 100,
    question_max_overrides: {},
    max_raw_marks: 100,
    scale_to_marks: 50,
    is_system: true,
  },
]

export function getQuestionMax(pattern: EvaluationPatternConfig, qNum: number): number {
  const override = pattern.question_max_overrides?.[String(qNum)]
  return typeof override === 'number' && !Number.isNaN(override) ? override : pattern.per_question_max
}

export function resolvePattern(
  code: string | null | undefined,
  snapshot: EvaluationPatternConfig | null | undefined,
  customPatterns: EvaluationPatternConfig[] = []
): EvaluationPatternConfig {
  if (snapshot && snapshot.rule_type) return snapshot
  const all = [...customPatterns, ...BUILTIN_EVALUATION_PATTERNS]
  return all.find((p) => p.code === code) ?? BUILTIN_EVALUATION_PATTERNS[0]
}

export interface ComputedScriptScore {
  questionTotals: Record<number, number>
  countedQuestions: Set<number>
  hasAnyInput: boolean
  totalSeeMarks: number | null
  marksDifference: number | null
  finalSeeMarks: number | null
  scaledMarks: number | null
  exceededQuestions: number[]
}

export function computeScriptEvaluation(
  pattern: EvaluationPatternConfig,
  questionMarks: QuestionMarksMap,
  directRawMarks: number | null,
  moderationMarks: number | null
): ComputedScriptScore {
  const questionTotals: Record<number, number> = {}
  const countedQuestions = new Set<number>()
  const exceededQuestions: number[] = []
  let hasAnyInput = false

  if (pattern.rule_type === 'DIRECT_OMR' || pattern.total_questions === 0) {
    const raw = directRawMarks !== null && !Number.isNaN(directRawMarks) ? directRawMarks : null
    hasAnyInput = raw !== null
    const clamped = raw !== null ? Math.min(pattern.max_raw_marks, Math.max(0, raw)) : null
    const mod = moderationMarks !== null && !Number.isNaN(moderationMarks) ? moderationMarks : null
    const diff = clamped !== null && mod !== null && mod > 0 ? Number((clamped - mod).toFixed(2)) : null
    const finalSee = clamped !== null ? (mod !== null && mod > 0 ? Math.max(clamped, mod) : clamped) : null
    const scaled =
      finalSee !== null
        ? Number(((finalSee / Math.max(1, pattern.max_raw_marks)) * pattern.scale_to_marks).toFixed(2))
        : null
    return {
      questionTotals,
      countedQuestions,
      hasAnyInput,
      totalSeeMarks: clamped,
      marksDifference: diff,
      finalSeeMarks: finalSee,
      scaledMarks: scaled,
      exceededQuestions,
    }
  }

  const subparts = pattern.subparts.length > 0 ? pattern.subparts : ['total']

  for (let q = 1; q <= pattern.total_questions; q++) {
    const qObj = questionMarks[String(q)] ?? {}
    let sum = 0
    for (const sp of subparts) {
      const v = qObj[sp]
      if (typeof v === 'number' && !Number.isNaN(v)) {
        hasAnyInput = true
        sum += v
      }
    }
    sum = Number(sum.toFixed(2))
    const qMax = getQuestionMax(pattern, q)
    if (sum > qMax) exceededQuestions.push(q)
    questionTotals[q] = sum
  }

  let totalRaw = 0
  if (pattern.rule_type === 'PAIRED_OR') {
    const pairs =
      pattern.or_pairs.length > 0
        ? pattern.or_pairs
        : Array.from({ length: Math.floor(pattern.total_questions / 2) }, (_, idx) => [
            idx * 2 + 1,
            idx * 2 + 2,
          ] as [number, number])
    for (const [qA, qB] of pairs) {
      const aVal = questionTotals[qA] ?? 0
      const bVal = questionTotals[qB] ?? 0
      if (aVal >= bVal) {
        totalRaw += aVal
        if (aVal > 0) countedQuestions.add(qA)
      } else {
        totalRaw += bVal
        if (bVal > 0) countedQuestions.add(qB)
      }
    }
  } else if (pattern.rule_type === 'BEST_N_PLUS_MANDATORY') {
    const mandatorySet = new Set(pattern.mandatory_questions)
    const optionalPool =
      pattern.optional_questions.length > 0
        ? pattern.optional_questions.filter((q) => !mandatorySet.has(q))
        : Array.from({ length: pattern.total_questions }, (_, i) => i + 1).filter((q) => !mandatorySet.has(q))

    const ranked = optionalPool
      .map((q) => ({ q, val: questionTotals[q] ?? 0 }))
      .sort((a, b) => b.val - a.val || a.q - b.q)

    const pickN = Math.max(0, pattern.pick_best_n)
    for (const item of ranked.slice(0, pickN)) {
      totalRaw += item.val
      if (item.val > 0) countedQuestions.add(item.q)
    }
    for (const mq of pattern.mandatory_questions) {
      const mv = questionTotals[mq] ?? 0
      totalRaw += mv
      countedQuestions.add(mq)
    }
  } else {
    // SUM_ALL
    for (let q = 1; q <= pattern.total_questions; q++) {
      const v = questionTotals[q] ?? 0
      totalRaw += v
      if (v > 0) countedQuestions.add(q)
    }
  }

  const clampedTotal = hasAnyInput ? Number(Math.min(pattern.max_raw_marks, totalRaw).toFixed(2)) : null
  const mod = moderationMarks !== null && !Number.isNaN(moderationMarks) ? moderationMarks : null
  const diff = clampedTotal !== null && mod !== null && mod > 0 ? Number((clampedTotal - mod).toFixed(2)) : null
  const finalSee =
    clampedTotal !== null
      ? mod !== null && mod > 0
        ? Math.max(clampedTotal, mod)
        : clampedTotal
      : null
  const scaled =
    finalSee !== null
      ? Number(((finalSee / Math.max(1, pattern.max_raw_marks)) * pattern.scale_to_marks).toFixed(2))
      : null

  return {
    questionTotals,
    countedQuestions,
    hasAnyInput,
    totalSeeMarks: clampedTotal,
    marksDifference: diff,
    finalSeeMarks: finalSee,
    scaledMarks: scaled,
    exceededQuestions,
  }
}

const DIGIT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

/** Matches AMCEC Excel Print sheet convention: 85 -> "Eight Five", 0 -> "Zero" */
export function marksToDigitWords(marks: number | null | undefined): string {
  if (marks === null || marks === undefined || Number.isNaN(marks)) return ''
  const rounded = Math.round(marks)
  return String(rounded)
    .split('')
    .map((ch) => {
      const idx = Number(ch)
      return Number.isNaN(idx) ? ch : DIGIT_WORDS[idx]
    })
    .join(' ')
}
