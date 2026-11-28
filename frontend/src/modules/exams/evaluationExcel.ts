import * as XLSX from 'xlsx'
import {
  computeScriptEvaluation,
  type EvaluationPatternConfig,
  type QuestionMarksMap,
} from './evaluationPatterns'

export interface ExcelExportScriptRow {
  script_sequence: number
  dummy_code: string
  question_marks_json?: QuestionMarksMap | null
  see_marks_raw?: number | null
  moderation_marks?: number | null
  final_see_marks?: number | null
  is_malpractice?: boolean
  is_absent?: boolean
}

export interface ExcelExportParams {
  institutionName: string
  cycleName: string
  bundleCode: string
  courseCode: string
  courseTitle: string
  evaluatorName: string
  pattern: EvaluationPatternConfig
  scripts: ExcelExportScriptRow[]
}

function colLetter(idx0: number): string {
  let n = idx0 + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function buildMarksInWordsFormula(cellRef: string): string {
  const words = '"Zero","One","Two","Three","Four","Five","Six","Seven","Eight","Nine"'
  return (
    `IF(${cellRef}="","",TRIM(` +
    `IF(LEN(${cellRef})>=1,CHOOSE(MID(${cellRef},1,1)+1,${words}),"")&` +
    `IF(LEN(${cellRef})>=2," "&CHOOSE(MID(${cellRef},2,1)+1,${words}),"")&` +
    `IF(LEN(${cellRef})>=3," "&CHOOSE(MID(${cellRef},3,1)+1,${words}),"")))`
  )
}

export function exportBundleEvaluationWorkbook(params: ExcelExportParams): void {
  const { institutionName, cycleName, bundleCode, courseCode, courseTitle, evaluatorName, pattern, scripts } = params
  const activeScripts = scripts.filter((s) => !s.is_absent && !s.is_malpractice)
  const isDirectOmr = pattern.rule_type === 'DIRECT_OMR' || pattern.total_questions === 0
  const subparts = pattern.subparts.length > 0 ? pattern.subparts : ['total']

  const ws: XLSX.WorkSheet = {}
  const merges: XLSX.Range[] = []
  const setCell = (r0: number, c0: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r: r0, c: c0 })] = cell
  }

  // Track column indices
  const qCols: Array<{ q: number; subCols: number[]; totalCol: number }> = []
  let curCol = 2 // 0=Sl.No., 1=Coding No.

  if (!isDirectOmr) {
    for (let q = 1; q <= pattern.total_questions; q++) {
      const subCols: number[] = []
      for (let s = 0; s < subparts.length; s++) {
        subCols.push(curCol++)
      }
      const totalCol = curCol++
      qCols.push({ q, subCols, totalCol })
    }
  }

  const totalSeeCol = curCol++
  const modCol = curCol++
  const diffCol = curCol++
  const finalCol = curCol++
  const lastColIdx = finalCol

  // Header banners (Rows 1..6, 0-based 0..5)
  setCell(0, 0, { t: 's', v: institutionName })
  setCell(1, 0, { t: 's', v: `Examination: ${cycleName}` })
  setCell(2, 0, { t: 's', v: `Evaluation Pattern: ${pattern.name}` })
  setCell(4, 0, { t: 's', v: `Course: ${courseCode} - ${courseTitle} | Bundle: ${bundleCode}` })
  merges.push(
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColIdx } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColIdx } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: lastColIdx } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: lastColIdx } }
  )

  // Table headers at Row 8 (r0=7) and Row 9 (r0=8) matching BNDL-47039_EC_1BCEDEC203.xlsx
  setCell(7, 0, { t: 's', v: 'Sl. No.' })
  setCell(7, 1, { t: 's', v: 'Coding No.' })
  merges.push({ s: { r: 7, c: 0 }, e: { r: 8, c: 0 } }, { s: { r: 7, c: 1 }, e: { r: 8, c: 1 } })

  if (!isDirectOmr) {
    for (const qc of qCols) {
      const isMand = pattern.mandatory_questions.includes(qc.q)
      setCell(7, qc.subCols[0], { t: 's', v: isMand ? `Q. ${qc.q} (M)` : `Q. ${qc.q}` })
      if (qc.subCols.length > 1) {
        merges.push({ s: { r: 7, c: qc.subCols[0] }, e: { r: 7, c: qc.subCols[qc.subCols.length - 1] } })
      }
      qc.subCols.forEach((colIdx, sIdx) => {
        setCell(8, colIdx, { t: 's', v: subparts[sIdx] })
      })
      setCell(7, qc.totalCol, { t: 's', v: `Q.${qc.q} Total` })
      merges.push({ s: { r: 7, c: qc.totalCol }, e: { r: 8, c: qc.totalCol } })
    }
  }

  setCell(7, totalSeeCol, { t: 's', v: `Total SEE Marks (${pattern.max_raw_marks})` })
  setCell(7, modCol, { t: 's', v: 'Total Moderation' })
  setCell(7, diffCol, { t: 's', v: 'Marks Difference' })
  setCell(7, finalCol, { t: 's', v: `Final SEE Marks (${pattern.max_raw_marks})` })
  merges.push(
    { s: { r: 7, c: totalSeeCol }, e: { r: 8, c: totalSeeCol } },
    { s: { r: 7, c: modCol }, e: { r: 8, c: modCol } },
    { s: { r: 7, c: diffCol }, e: { r: 8, c: diffCol } },
    { s: { r: 7, c: finalCol }, e: { r: 8, c: finalCol } }
  )

  const seeColL = colLetter(totalSeeCol)
  const modColL = colLetter(modCol)
  const finalColL = colLetter(finalCol)

  // Data rows starting at Row 10 (r0=9)
  activeScripts.forEach((s, idx) => {
    const r0 = 9 + idx
    const excelRow = r0 + 1
    setCell(r0, 0, { t: 'n', v: idx + 1 })
    setCell(r0, 1, { t: 's', v: s.dummy_code })

    const qm = s.question_marks_json ?? {}
    if (!isDirectOmr) {
      const qTotRef = new Map<number, string>()
      for (const qc of qCols) {
        const qEntry = qm[String(qc.q)] ?? {}
        qc.subCols.forEach((colIdx, sIdx) => {
          const val = qEntry[subparts[sIdx]]
          if (typeof val === 'number' && !Number.isNaN(val)) {
            setCell(r0, colIdx, { t: 'n', v: val })
          }
        })
        const startL = colLetter(qc.subCols[0])
        const endL = colLetter(qc.subCols[qc.subCols.length - 1])
        setCell(r0, qc.totalCol, { t: 'n', f: `SUM(${startL}${excelRow}:${endL}${excelRow})` })
        qTotRef.set(qc.q, `${colLetter(qc.totalCol)}${excelRow}`)
      }

      // Pattern-specific Total SEE formula
      let totalFormula = '0'
      if (pattern.rule_type === 'PAIRED_OR') {
        const pairs =
          pattern.or_pairs.length > 0
            ? pattern.or_pairs
            : Array.from({ length: Math.floor(pattern.total_questions / 2) }, (_, p) => [
                p * 2 + 1,
                p * 2 + 2,
              ] as [number, number])
        totalFormula = pairs
          .map(([a, b]) => `MAX(${qTotRef.get(a) ?? 0},${qTotRef.get(b) ?? 0})`)
          .join('+')
      } else if (pattern.rule_type === 'BEST_N_PLUS_MANDATORY') {
        const mandSet = new Set(pattern.mandatory_questions)
        const optPool =
          pattern.optional_questions.length > 0
            ? pattern.optional_questions.filter((q) => !mandSet.has(q))
            : Array.from({ length: pattern.total_questions }, (_, i) => i + 1).filter((q) => !mandSet.has(q))
        const unionRef = `(${optPool.map((q) => qTotRef.get(q)).filter(Boolean).join(',')})`
        const parts: string[] = []
        for (let k = 1; k <= Math.min(pattern.pick_best_n, optPool.length); k++) {
          parts.push(`LARGE(${unionRef},${k})`)
        }
        for (const mq of pattern.mandatory_questions) {
          const ref = qTotRef.get(mq)
          if (ref) parts.push(ref)
        }
        totalFormula = parts.length > 0 ? parts.join('+') : '0'
      } else {
        totalFormula = `SUM(${Array.from(qTotRef.values()).join(',')})`
      }

      setCell(r0, totalSeeCol, { t: 'n', f: `MIN(${pattern.max_raw_marks},${totalFormula})` })
    } else {
      if (typeof s.see_marks_raw === 'number') {
        setCell(r0, totalSeeCol, { t: 'n', v: s.see_marks_raw })
      }
    }

    if (typeof s.moderation_marks === 'number') {
      setCell(r0, modCol, { t: 'n', v: s.moderation_marks })
    }
    setCell(r0, diffCol, {
      t: 's',
      f: `IF(${modColL}${excelRow}>0,${seeColL}${excelRow}-${modColL}${excelRow},"")`,
    })
    setCell(r0, finalCol, {
      t: 'n',
      f: `MAX(${seeColL}${excelRow},${modColL}${excelRow})`,
    })
  })

  // Evaluator Name footer row
  const evalRow0 = 9 + activeScripts.length + 2
  const evalExcelRow = evalRow0 + 1
  setCell(evalRow0, 0, { t: 's', v: 'Evaluator Name:' })
  setCell(evalRow0, 2, { t: 's', v: evaluatorName || '' })
  merges.push(
    { s: { r: evalRow0, c: 0 }, e: { r: evalRow0, c: 1 } },
    { s: { r: evalRow0, c: 2 }, e: { r: evalRow0, c: Math.min(5, lastColIdx) } }
  )

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: evalRow0, c: lastColIdx } })
  ws['!merges'] = merges
  ws['!cols'] = Array.from({ length: lastColIdx + 1 }, (_, idx) => {
    if (idx === 0) return { wch: 7 }
    if (idx === 1) return { wch: 24 }
    if (idx >= totalSeeCol) return { wch: 16 }
    return { wch: 7 }
  })

  // ------------------------------------------------------------------
  // Sheet 2: Print (Exact match to BNDL-47039_EC_1BCEDEC203.xlsx Print sheet)
  // ------------------------------------------------------------------
  const wsPrint: XLSX.WorkSheet = {}
  const setP = (r0: number, c0: number, cell: XLSX.CellObject) => {
    wsPrint[XLSX.utils.encode_cell({ r: r0, c: c0 })] = cell
  }

  setP(0, 0, { t: 's', v: institutionName })
  setP(1, 0, { t: 's', v: cycleName })
  setP(2, 0, { t: 's', v: `Course Code: ${courseCode} | Course Title: ${courseTitle} | Bundle: ${bundleCode}` })
  setP(4, 0, { t: 's', v: 'Sl. No.' })
  setP(4, 1, { t: 's', v: 'Answer Booklet Code' })
  setP(4, 2, { t: 's', v: `SEE Marks in Figures (${pattern.max_raw_marks})` })
  setP(4, 3, { t: 's', v: 'SEE Marks in Words' })

  activeScripts.forEach((s, idx) => {
    const pRow0 = 5 + idx
    const pExcelRow = pRow0 + 1
    const srcExcelRow = 10 + idx
    setP(pRow0, 0, { t: 'n', v: idx + 1 })
    setP(pRow0, 1, { t: 's', v: s.dummy_code })
    setP(pRow0, 2, { t: 'n', f: `'Marks Entry'!${finalColL}${srcExcelRow}` })
    setP(pRow0, 3, { t: 's', f: buildMarksInWordsFormula(`C${pExcelRow}`) })
  })

  const pFoot0 = 5 + activeScripts.length + 2
  setP(pFoot0, 1, { t: 's', v: 'Evaluator Name:' })
  setP(pFoot0, 2, { t: 's', f: `IF('Marks Entry'!C${evalExcelRow}="","",'Marks Entry'!C${evalExcelRow})` })
  setP(pFoot0, 3, { t: 's', v: 'Signature with Date: _________________________' })

  wsPrint['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: pFoot0, c: 3 } })
  wsPrint['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
  ]
  wsPrint['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 24 }, { wch: 36 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Marks Entry')
  XLSX.utils.book_append_sheet(wb, wsPrint, 'Print')
  XLSX.writeFile(wb, `${bundleCode}_Evaluation_Sheet.xlsx`)
}

export interface ParsedWorkbookRow {
  dummyCode: string
  questionMarks: QuestionMarksMap
  seeMarksRaw: number | null
  moderationMarks: number | null
  finalSeeMarks: number | null
  scaledMarks: number | null
}

export interface ParsedEvaluationWorkbook {
  evaluatorName: string | null
  rows: ParsedWorkbookRow[]
}

export async function parseEvaluationWorkbookFile(
  file: File,
  pattern: EvaluationPatternConfig
): Promise<ParsedEvaluationWorkbook> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames.includes('Marks Entry') ? 'Marks Entry' : wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | null>>(ws, { header: 1, defval: null })

  // Locate header row containing "Coding No." or "Dummy_Code"
  let headerRowIdx = -1
  let dummyColIdx = -1
  for (let r = 0; r < Math.min(20, matrix.length); r++) {
    const row = matrix[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? '').trim().toLowerCase()
      if (cell === 'coding no.' || cell === 'dummy_code' || cell === 'answer booklet code' || cell === 'code') {
        headerRowIdx = r
        dummyColIdx = c
        break
      }
    }
    if (headerRowIdx !== -1) break
  }

  if (headerRowIdx === -1 || dummyColIdx === -1) {
    throw new Error('Could not find "Coding No." or "Dummy_Code" column in uploaded workbook.')
  }

  const headerRow = matrix[headerRowIdx] ?? []
  const subHeaderRow = matrix[headerRowIdx + 1] ?? []
  const hasSubHeader = subHeaderRow.some((v) => ['a', 'b', 'c', 'd', 'total'].includes(String(v ?? '').trim().toLowerCase()))
  const dataStartRow = hasSubHeader ? headerRowIdx + 2 : headerRowIdx + 1

  // Map each question subpart column + Total SEE + Moderation columns
  const subpartColMap: Array<{ colIdx: number; q: number; sub: string }> = []
  let totalSeeCol = -1
  let modCol = -1
  let activeQ: number | null = null

  for (let c = 0; c < headerRow.length; c++) {
    const h = String(headerRow[c] ?? '').trim()
    const hLow = h.toLowerCase()
    const sub = String(subHeaderRow[c] ?? '').trim().toLowerCase()

    const qMatch = h.match(/^Q\.?\s*(\d+)(?:\s*\(M\))?$/i)
    if (qMatch && !hLow.includes('total')) {
      activeQ = Number(qMatch[1])
    } else if (hLow.includes('total') && hLow.startsWith('q')) {
      activeQ = null
    } else if (hLow.includes('total see') || hLow === 'see_raw_marks' || hLow === 'see_marks' || hLow === 'marks') {
      totalSeeCol = c
      activeQ = null
    } else if (hLow.includes('moderation')) {
      modCol = c
      activeQ = null
    } else if (hLow.includes('final see') || hLow.includes('difference')) {
      activeQ = null
    }

    if (activeQ !== null && hasSubHeader && ['a', 'b', 'c', 'd', 'total'].includes(sub)) {
      subpartColMap.push({ colIdx: c, q: activeQ, sub })
    }
  }

  let evaluatorName: string | null = null
  const rows: ParsedWorkbookRow[] = []

  for (let r = dataStartRow; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const firstCell = String(row[0] ?? '').trim().toLowerCase()
    if (firstCell.startsWith('evaluator name')) {
      for (let c = 1; c < row.length; c++) {
        const val = String(row[c] ?? '').trim()
        if (val) {
          evaluatorName = val
          break
        }
      }
      continue
    }

    const dummyCode = String(row[dummyColIdx] ?? '').trim().toUpperCase()
    if (!dummyCode || dummyCode.startsWith('EVALUATOR')) continue

    const questionMarks: QuestionMarksMap = {}
    for (const m of subpartColMap) {
      const rawVal = row[m.colIdx]
      if (rawVal !== null && rawVal !== '' && !Number.isNaN(Number(rawVal))) {
        const qKey = String(m.q)
        if (!questionMarks[qKey]) questionMarks[qKey] = {}
        questionMarks[qKey][m.sub] = Number(rawVal)
      }
    }

    const directRaw =
      totalSeeCol !== -1 && row[totalSeeCol] !== null && row[totalSeeCol] !== '' && !Number.isNaN(Number(row[totalSeeCol]))
        ? Number(row[totalSeeCol])
        : null
    const modMarks =
      modCol !== -1 && row[modCol] !== null && row[modCol] !== '' && !Number.isNaN(Number(row[modCol]))
        ? Number(row[modCol])
        : null

    const computed = computeScriptEvaluation(pattern, questionMarks, directRaw, modMarks)
    if (!computed.hasAnyInput && directRaw === null && modMarks === null) continue

    const finalSee = computed.finalSeeMarks ?? directRaw
    const finalScaled =
      finalSee !== null
        ? Number(((finalSee / Math.max(1, pattern.max_raw_marks)) * pattern.scale_to_marks).toFixed(2))
        : null

    rows.push({
      dummyCode,
      questionMarks,
      seeMarksRaw: computed.totalSeeMarks ?? directRaw,
      moderationMarks: modMarks,
      finalSeeMarks: finalSee,
      scaledMarks: finalScaled,
    })
  }

  return { evaluatorName, rows }
}
