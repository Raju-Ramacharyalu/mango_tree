import * as XLSX from 'xlsx'
import type { ExamCourseResultItem, ExamCycle, ExamSemesterResultItem } from '@/types/exams'

export type ClassAward = 'FCD' | 'FC' | 'SC' | 'PASS' | 'FAIL' | 'WITHHELD' | 'PENDING'

export interface ExtendedCourseRow extends ExamCourseResultItem {
  is_graced?: boolean
  grace_marks_added?: number
}

export interface RankedStudentRow {
  rank: number | null
  student_id: string
  usn: string
  student_name: string
  program_code: string
  program_name: string
  program_level: string
  period_name: string
  total_courses: number
  passed_courses: number
  failed_courses: number
  credits_registered: number
  credits_earned: number
  total_obtained: number
  total_max: number
  percentage: number
  sgpa: number
  overall_status: string
  is_withheld: boolean
  has_grace: boolean
  class_award: ClassAward
}

export function classifyStudentAward(
  overallStatus: string,
  isWithheld: boolean,
  sgpa: number,
  totalObtained: number,
  totalMax: number
): { percentage: number; award: ClassAward } {
  const pct =
    totalMax > 0
      ? Number(((totalObtained / totalMax) * 100).toFixed(2))
      : Number(Math.max(0, (sgpa - 0.75) * 10).toFixed(2))

  if (isWithheld || overallStatus === 'WITHHELD') return { percentage: pct, award: 'WITHHELD' }
  if (overallStatus === 'PENDING') return { percentage: pct, award: 'PENDING' }
  if (overallStatus !== 'PASS') return { percentage: pct, award: 'FAIL' }
  if (pct >= 70) return { percentage: pct, award: 'FCD' }
  if (pct >= 60) return { percentage: pct, award: 'FC' }
  if (pct >= 50) return { percentage: pct, award: 'SC' }
  return { percentage: pct, award: 'PASS' }
}

export function buildRankedStudentRows(
  semesterResults: ExamSemesterResultItem[],
  courseResults: ExtendedCourseRow[],
  excludeGracedFromRanks = true
): RankedStudentRow[] {
  const coursesByStudent = new Map<string, ExtendedCourseRow[]>()
  for (const c of courseResults) {
    const arr = coursesByStudent.get(c.student_id) ?? []
    arr.push(c)
    coursesByStudent.set(c.student_id, arr)
  }

  const rows: RankedStudentRow[] = semesterResults.map((sr) => {
    const lines = coursesByStudent.get(sr.student_id) ?? []
    let totalObtained = 0
    let totalMax = 0
    let hasGrace = false

    for (const c of lines) {
      if (c.is_graced) hasGrace = true
      if (!c.is_online_exempt) {
        totalObtained += Number(c.total_marks ?? 0)
        totalMax += Number(c.max_total_marks ?? 100)
      }
    }

    const isWithheld = Boolean(sr.is_withheld || sr.overall_status === 'WITHHELD')
    const { percentage, award } = classifyStudentAward(
      sr.overall_status,
      isWithheld,
      sr.sgpa,
      totalObtained,
      totalMax
    )

    return {
      rank: null,
      student_id: sr.student_id,
      usn: sr.student_reg_no,
      student_name: sr.student_name,
      program_code: sr.program_code,
      program_name: sr.program_name,
      program_level: sr.program_level,
      period_name: sr.period_name ?? '—',
      total_courses: sr.total_courses,
      passed_courses: sr.passed_courses,
      failed_courses: sr.failed_courses,
      credits_registered: sr.credits_registered,
      credits_earned: sr.credits_earned,
      total_obtained: Number(totalObtained.toFixed(2)),
      total_max: Number(totalMax.toFixed(2)),
      percentage,
      sgpa: sr.sgpa,
      overall_status: sr.overall_status,
      is_withheld: isWithheld,
      has_grace: hasGrace,
      class_award: award,
    }
  })

  // Assign dense merit ranks among PASS students (SGPA DESC -> Total Marks DESC -> Percentage DESC)
  const eligible = rows
    .filter((r) => r.overall_status === 'PASS' && !r.is_withheld && r.failed_courses === 0)
    .filter((r) => !excludeGracedFromRanks || !r.has_grace)
    .sort((a, b) => b.sgpa - a.sgpa || b.total_obtained - a.total_obtained || b.percentage - a.percentage)

  let currentRank = 0
  let prevKey = ''
  for (const item of eligible) {
    const key = `${item.sgpa.toFixed(2)}::${item.total_obtained.toFixed(2)}`
    if (key !== prevKey) {
      currentRank += 1
      prevKey = key
    }
    item.rank = currentRank
  }

  return rows.sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank || a.usn.localeCompare(b.usn)
    if (a.rank !== null) return -1
    if (b.rank !== null) return 1
    return b.sgpa - a.sgpa || a.usn.localeCompare(b.usn)
  })
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  const clean = raw.replace(/[:\\/?*[\]]/g, '_').trim().slice(0, 28) || 'Sheet'
  let name = clean
  let suffix = 2
  while (used.has(name)) {
    name = `${clean.slice(0, 25)}_${suffix++}`
  }
  used.add(name)
  return name
}

/**
 * Generates an official A3 Landscape Tabulation Register / Master Marks Ledger (.xlsx)
 * with an Institutional Summary sheet + one branch-wise ledger sheet per Program.
 */
export function exportA3MasterLedgerWorkbook(params: {
  institutionName: string
  cycle: ExamCycle
  semesterResults: ExamSemesterResultItem[]
  courseResults: ExtendedCourseRow[]
  programFilter?: string
}): void {
  const { institutionName, cycle, semesterResults, courseResults, programFilter = 'ALL' } = params
  const filteredSem =
    programFilter === 'ALL'
      ? semesterResults
      : semesterResults.filter((s) => s.program_code === programFilter)

  const rankedAll = buildRankedStudentRows(filteredSem, courseResults, true)
  const rankedByStudent = new Map(rankedAll.map((r) => [r.student_id, r]))

  const coursesByStudent = new Map<string, Map<string, ExtendedCourseRow>>()
  for (const c of courseResults) {
    const map = coursesByStudent.get(c.student_id) ?? new Map<string, ExtendedCourseRow>()
    map.set(c.effective_course_code, c)
    coursesByStudent.set(c.student_id, map)
  }

  const byProgram = new Map<string, ExamSemesterResultItem[]>()
  for (const sr of filteredSem) {
    const list = byProgram.get(sr.program_code) ?? []
    list.push(sr)
    byProgram.set(sr.program_code, list)
  }

  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()

  // 1. Institutional Summary Sheet
  const summaryRows: Array<Array<string | number>> = [
    [institutionName],
    [`MASTER TABULATION SUMMARY — ${cycle.name} (${cycle.code}) · AY ${cycle.academic_year}`],
    [],
    ['Program', 'Level', 'Appeared', 'Passed', 'Failed', 'Withheld', 'Pass %', 'FCD (>=70%)', 'FC (60-69%)', 'SC (50-59%)', 'Pass Class', 'Top SGPA'],
  ]

  let gApp = 0
  let gPass = 0
  let gFail = 0
  let gWith = 0
  let gFcd = 0
  let gFc = 0
  let gSc = 0
  let gPassCls = 0

  const sortedPrograms = Array.from(byProgram.entries()).sort(([a], [b]) => a.localeCompare(b))
  for (const [progCode, list] of sortedPrograms) {
    const app = list.length
    let pass = 0
    let fail = 0
    let withh = 0
    let fcd = 0
    let fc = 0
    let sc = 0
    let pcls = 0
    let topSgpa = 0

    for (const sr of list) {
      const r = rankedByStudent.get(sr.student_id)
      if (!r) continue
      if (r.sgpa > topSgpa && !r.is_withheld) topSgpa = r.sgpa
      if (r.class_award === 'WITHHELD') withh += 1
      else if (r.class_award === 'FAIL' || r.class_award === 'PENDING') fail += 1
      else {
        pass += 1
        if (r.class_award === 'FCD') fcd += 1
        else if (r.class_award === 'FC') fc += 1
        else if (r.class_award === 'SC') sc += 1
        else pcls += 1
      }
    }
    const denom = Math.max(1, app - withh)
    summaryRows.push([
      progCode,
      list[0]?.program_level ?? 'UG',
      app,
      pass,
      fail,
      withh,
      Number(((pass / denom) * 100).toFixed(2)),
      fcd,
      fc,
      sc,
      pcls,
      Number(topSgpa.toFixed(2)),
    ])
    gApp += app
    gPass += pass
    gFail += fail
    gWith += withh
    gFcd += fcd
    gFc += fc
    gSc += sc
    gPassCls += pcls
  }

  summaryRows.push([
    'TOTAL',
    'ALL',
    gApp,
    gPass,
    gFail,
    gWith,
    Number(((gPass / Math.max(1, gApp - gWith)) * 100).toFixed(2)),
    gFcd,
    gFc,
    gSc,
    gPassCls,
    '',
  ])

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows)
  wsSummary['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
  ]
  wsSummary['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 10 },
  ]
  ;(wsSummary as Record<string, unknown>)['!pageSetup'] = {
    paperSize: 8, // A3
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
  }
  XLSX.utils.book_append_sheet(wb, wsSummary, sanitizeSheetName('Summary', usedNames))

  // 2. One A3 Landscape Tabulation Register Sheet per Program
  for (const [progCode, rawList] of sortedPrograms) {
    const list = [...rawList].sort((a, b) =>
      a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true })
    )

    // Collect distinct courses taken by students in this branch
    const courseMeta = new Map<string, { title: string; credits: number }>()
    for (const sr of list) {
      const cmap = coursesByStudent.get(sr.student_id)
      if (!cmap) continue
      for (const [code, row] of cmap.entries()) {
        if (!courseMeta.has(code)) {
          courseMeta.set(code, { title: row.course_title, credits: row.credits })
        }
      }
    }
    const orderedCourses = Array.from(courseMeta.entries()).sort(([a], [b]) => a.localeCompare(b))

    const ws: XLSX.WorkSheet = {}
    const merges: XLSX.Range[] = []
    const setCell = (r0: number, c0: number, val: string | number) => {
      const t = typeof val === 'number' ? 'n' : 's'
      ws[XLSX.utils.encode_cell({ r: r0, c: c0 })] = { t, v: val }
    }

    const totalCols = 3 + orderedCourses.length * 4 + 6 // Sl, USN, Name + 4*courses + CrReg, CrEarn, Tot, Pct, SGPA, Result/Class
    const lastCol = totalCols - 1

    setCell(0, 0, `${institutionName} — A3 MASTER TABULATION REGISTER`)
    setCell(1, 0, `Examination: ${cycle.name} (${cycle.code}) · AY ${cycle.academic_year}`)
    setCell(2, 0, `Branch: ${progCode} (${list[0]?.program_name ?? ''}) · Level: ${list[0]?.program_level ?? 'UG'} · Students: ${list.length}`)
    merges.push(
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } }
    )

    // Row 5 (r0=4) & Row 6 (r0=5): 2-tier table headers
    setCell(4, 0, 'Sl.')
    setCell(4, 1, 'USN')
    setCell(4, 2, 'Candidate Name')
    merges.push(
      { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } },
      { s: { r: 4, c: 1 }, e: { r: 5, c: 1 } },
      { s: { r: 4, c: 2 }, e: { r: 5, c: 2 } }
    )

    let cIdx = 3
    for (const [code, meta] of orderedCourses) {
      setCell(4, cIdx, `${code} (${meta.credits} Cr)`)
      merges.push({ s: { r: 4, c: cIdx }, e: { r: 4, c: cIdx + 3 } })
      setCell(5, cIdx, 'CIE')
      setCell(5, cIdx + 1, 'SEE')
      setCell(5, cIdx + 2, 'TOT')
      setCell(5, cIdx + 3, 'GRD')
      cIdx += 4
    }

    const tailHeaders = ['Cr.Reg', 'Cr.Earn', 'Total', '%', 'SGPA', 'Result / Class']
    tailHeaders.forEach((lbl, idx) => {
      setCell(4, cIdx + idx, lbl)
      merges.push({ s: { r: 4, c: cIdx + idx }, e: { r: 5, c: cIdx + idx } })
    })

    // Student data rows starting at Row 7 (r0=6)
    list.forEach((sr, idx) => {
      const r0 = 6 + idx
      const rk = rankedByStudent.get(sr.student_id)
      const cmap = coursesByStudent.get(sr.student_id)
      const isWithheld = Boolean(sr.is_withheld || sr.overall_status === 'WITHHELD')

      setCell(r0, 0, idx + 1)
      setCell(r0, 1, sr.student_reg_no)
      setCell(r0, 2, sr.student_name)

      let col = 3
      for (const [code] of orderedCourses) {
        const cr = cmap?.get(code)
        if (!cr) {
          setCell(r0, col, '')
          setCell(r0, col + 1, '')
          setCell(r0, col + 2, '')
          setCell(r0, col + 3, '')
        } else if (isWithheld) {
          setCell(r0, col, 'W')
          setCell(r0, col + 1, 'W')
          setCell(r0, col + 2, 'W')
          setCell(r0, col + 3, 'W')
        } else if (cr.is_online_exempt) {
          setCell(r0, col, 'EX')
          setCell(r0, col + 1, 'EX')
          setCell(r0, col + 2, 'EX')
          setCell(r0, col + 3, 'EX')
        } else {
          setCell(r0, col, cr.cie_marks ?? '')
          setCell(r0, col + 1, cr.result_status === 'ABSENT' ? 'AB' : cr.result_status === 'MALPRACTICE' ? 'MP' : (cr.see_marks ?? ''))
          setCell(r0, col + 2, cr.total_marks ?? '')
          setCell(r0, col + 3, `${cr.grade_code ?? cr.result_status}${cr.is_graced ? '+G' : ''}`)
        }
        col += 4
      }

      setCell(r0, col, sr.credits_registered)
      setCell(r0, col + 1, isWithheld ? 'W' : sr.credits_earned)
      setCell(r0, col + 2, isWithheld ? 'W' : (rk?.total_obtained ?? ''))
      setCell(r0, col + 3, isWithheld ? 'W' : (rk?.percentage ?? ''))
      setCell(r0, col + 4, isWithheld ? 'W' : Number(sr.sgpa.toFixed(2)))
      setCell(r0, col + 5, isWithheld ? `WITHHELD (${sr.withheld_reason ?? 'COE'})` : `${sr.overall_status} · ${rk?.class_award ?? ''}`)
    })

    // Legend & Signature Footer
    const footRow = 6 + list.length + 2
    setCell(footRow, 0, 'Legend: EX = Online Exempt | AB = Absent | MP = Malpractice | W = Withheld | +G = Grace Applied')
    merges.push({ s: { r: footRow, c: 0 }, e: { r: footRow, c: lastCol } })

    const sigRow = footRow + 3
    setCell(sigRow, 1, 'Tabulated & Verified By: ___________________')
    setCell(sigRow, Math.max(4, Math.floor(lastCol / 2)), 'Controller of Examinations (COE): ___________________')
    setCell(sigRow, Math.max(8, lastCol - 4), 'Principal / Director: ___________________')

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sigRow, c: lastCol } })
    ws['!merges'] = merges
    ws['!cols'] = Array.from({ length: totalCols }, (_, i) => {
      if (i === 0) return { wch: 5 }
      if (i === 1) return { wch: 14 }
      if (i === 2) return { wch: 24 }
      if (i >= totalCols - 1) return { wch: 18 }
      if (i >= totalCols - 6) return { wch: 8 }
      return { wch: 6 }
    })
    ;(ws as Record<string, unknown>)['!pageSetup'] = {
      paperSize: 8, // A3
      orientation: 'landscape',
      fitToWidth: 1,
      fitToHeight: 0,
    }
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(progCode, usedNames))
  }

  XLSX.writeFile(wb, `${cycle.code}_A3_Master_Ledger_${programFilter}.xlsx`)
}

export function exportRankListWorkbook(params: {
  institutionName: string
  cycle: ExamCycle
  rows: RankedStudentRow[]
  branchLabel: string
}): void {
  const { institutionName, cycle, rows, branchLabel } = params
  const sheetData: Array<Array<string | number>> = [
    [institutionName],
    [`OFFICIAL MERIT RANK & CLASS LIST — ${cycle.name} (${cycle.code}) · ${branchLabel}`],
    [],
    ['Rank', 'USN', 'Candidate Name', 'Program', 'Level', 'Semester', 'Credits Earned', 'Total Marks', 'Max Marks', '%', 'SGPA', 'Class Award', 'Grace?'],
    ...rows.map((r) => [
      r.rank ?? '—',
      r.usn,
      r.student_name,
      r.program_code,
      r.program_level,
      r.period_name,
      r.credits_earned,
      r.total_obtained,
      r.total_max,
      r.percentage,
      Number(r.sgpa.toFixed(2)),
      r.class_award,
      r.has_grace ? 'Yes' : 'No',
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(sheetData)
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },
  ]
  ws['!cols'] = [
    { wch: 7 }, { wch: 14 }, { wch: 26 }, { wch: 10 }, { wch: 7 }, { wch: 12 },
    { wch: 13 }, { wch: 11 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 8 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Merit Rank List')
  XLSX.writeFile(wb, `${cycle.code}_Rank_List_${branchLabel}.xlsx`)
}
