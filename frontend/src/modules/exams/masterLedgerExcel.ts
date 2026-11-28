import ExcelJS from 'exceljs'
import JSZip from 'jszip'
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

const NON_CREDIT_GRADES = new Set(['PP', 'NP', 'EX'])
const FAIL_HIGHLIGHT_TOKENS = new Set(['F', 'AB', 'MP', 'NP', 'NE', 'FAIL', 'WITHHELD', 'W'])

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF334155' } },
  left: { style: 'thin', color: { argb: 'FF334155' } },
  bottom: { style: 'thin', color: { argb: 'FF334155' } },
  right: { style: 'thin', color: { argb: 'FF334155' } },
}

const FILL_HEADER_MAIN: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9D9D9' },
}

const FILL_HEADER_SUB: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF2F2F2' },
}

const FILL_ZEBRA: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
}

const FILL_TOTAL_ROW: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
}

function isNonCreditCourse(c: ExtendedCourseRow): boolean {
  if (c.is_online_exempt) return true
  const grd = (c.grade_code ?? '').trim().toUpperCase()
  if (NON_CREDIT_GRADES.has(grd)) return true
  if (Number(c.credits ?? 0) === 0 && (c.see_max_marks === 0 || grd === 'PP' || grd === 'NP')) return true
  return false
}

/**
 * Infers semester number from VTU/AMCEC course codes (e.g. 1BMATC101 -> 1, 1BMATC201 -> 2, 1BPRJ258 -> 2, 25MCS214C -> 2).
 */
export function inferCourseSemester(courseCode: string, fallbackPeriodName?: string | null): number {
  const m = courseCode.trim().match(/[A-Za-z]+([1-8])\d{1,2}[A-Za-z]*$/)
  if (m) return Number(m[1])
  const pm = (fallbackPeriodName ?? '').match(/([1-8])/)
  if (pm) return Number(pm[1])
  return 1
}

function sgpaToOverallGrade(result: string, sgpa: number): string {
  if (result === 'WITHHELD') return 'W'
  if (result !== 'PASS') return 'F'
  if (sgpa >= 9.0) return 'O'
  if (sgpa >= 8.0) return 'A+'
  if (sgpa >= 7.0) return 'A'
  if (sgpa >= 6.0) return 'B+'
  if (sgpa >= 5.5) return 'B'
  if (sgpa >= 5.0) return 'C'
  if (sgpa >= 4.0) return 'P'
  return 'F'
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
      // Exclude non-credit PP/NP/ONLINE courses from Grand Total & Percentage (VTU/AMCEC rule)
      if (!isNonCreditCourse(c)) {
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

interface BranchSemBucket {
  programCode: string
  programName: string
  programLevel: string
  semNumber: number
  orderedCourses: string[]
  students: Array<{
    student_id: string
    usn: string
    name: string
    isWithheld: boolean
    withheldReason: string | null
    courses: Map<string, ExtendedCourseRow>
    grandTotal: number
    maxTotal: number
    percentage: number
    result: 'PASS' | 'FAIL' | 'WITHHELD' | 'PENDING'
    sgpa: number
    overallGrade: string
    creditsEarned: number
    classAward: ClassAward
  }>
}

function buildBranchSemesterBuckets(
  semesterResults: ExamSemesterResultItem[],
  courseResults: ExtendedCourseRow[],
  programFilter = 'ALL'
): BranchSemBucket[] {
  const semMetaByStudent = new Map(semesterResults.map((sr) => [sr.student_id, sr]))

  // Group course rows by (program_code, inferred_course_semester)
  const bucketMap = new Map<
    string,
    {
      programCode: string
      programName: string
      programLevel: string
      semNumber: number
      courseCodes: Set<string>
      byStudent: Map<string, { usn: string; name: string; rows: Map<string, ExtendedCourseRow> }>
    }
  >()

  const allowedStudents = semMetaByStudent.size > 0 ? semMetaByStudent : null
  for (const cr of courseResults) {
    if (programFilter !== 'ALL' && cr.program_code !== programFilter) continue
    if (allowedStudents && !allowedStudents.has(cr.student_id)) continue
    // Exclude purely PENDING rows if there are no marks at all and grade is PND
    const semNum = inferCourseSemester(cr.effective_course_code, cr.period_name)
    const key = `${cr.program_code}::${semNum}`
    const sr = semMetaByStudent.get(cr.student_id)
    const bucket = bucketMap.get(key) ?? {
      programCode: cr.program_code,
      programName: sr?.program_name ?? cr.program_code,
      programLevel: sr?.program_level ?? cr.program_level ?? 'UG',
      semNumber: semNum,
      courseCodes: new Set<string>(),
      byStudent: new Map(),
    }
    bucket.courseCodes.add(cr.effective_course_code)

    const stuEntry = bucket.byStudent.get(cr.student_id) ?? {
      usn: cr.student_reg_no,
      name: cr.student_name,
      rows: new Map<string, ExtendedCourseRow>(),
    }
    stuEntry.rows.set(cr.effective_course_code, cr)
    bucket.byStudent.set(cr.student_id, stuEntry)
    bucketMap.set(key, bucket)
  }

  const buckets: BranchSemBucket[] = []
  const sortedKeys = Array.from(bucketMap.keys()).sort((a, b) => {
    const [pA, sA] = a.split('::')
    const [pB, sB] = b.split('::')
    return pA.localeCompare(pB) || Number(sA) - Number(sB)
  })

  for (const key of sortedKeys) {
    const raw = bucketMap.get(key)!
    const orderedCourses = Array.from(raw.courseCodes).sort((a, b) => a.localeCompare(b))
    const students = Array.from(raw.byStudent.entries())
      .map(([studentId, info]) => {
        const sr = semMetaByStudent.get(studentId)
        const isWithheld = Boolean(sr?.is_withheld || sr?.overall_status === 'WITHHELD')

        let grandTotal = 0
        let maxTotal = 0
        let creditsEarned = 0
        let gradedCredits = 0
        let weightedGp = 0
        let hasFail = false
        let hasPending = false

        for (const cr of info.rows.values()) {
          const grd = (cr.grade_code ?? '').trim().toUpperCase()
          const nonCredit = isNonCreditCourse(cr)

          if (!nonCredit) {
            grandTotal += Number(cr.total_marks ?? 0)
            maxTotal += Number(cr.max_total_marks ?? 100)
          }

          if (cr.result_status === 'PASS') {
            creditsEarned += Number(cr.credits ?? 0)
            if (!nonCredit) {
              gradedCredits += Number(cr.credits ?? 0)
              weightedGp += Number(cr.credits ?? 0) * Number(cr.grade_point ?? 0)
            }
          } else if (cr.result_status === 'EXEMPT' || grd === 'PP') {
            creditsEarned += Number(cr.credits ?? 0)
          } else if (
            cr.result_status === 'FAIL' ||
            cr.result_status === 'ABSENT' ||
            cr.result_status === 'MALPRACTICE' ||
            grd === 'F' ||
            grd === 'AB' ||
            grd === 'MP' ||
            grd === 'NP' ||
            grd === 'NE'
          ) {
            hasFail = true
            if (!nonCredit) {
              gradedCredits += Number(cr.credits ?? 0)
            }
          } else {
            hasPending = true
          }
        }

        const sgpa = gradedCredits > 0 ? Number((weightedGp / gradedCredits).toFixed(2)) : 0
        const result: 'PASS' | 'FAIL' | 'WITHHELD' | 'PENDING' = isWithheld
          ? 'WITHHELD'
          : hasFail
            ? 'FAIL'
            : hasPending
              ? 'PENDING'
              : 'PASS'
        const { percentage, award } = classifyStudentAward(result, isWithheld, sgpa, grandTotal, maxTotal)
        const overallGrade = sgpaToOverallGrade(result, sgpa)

        return {
          student_id: studentId,
          usn: info.usn,
          name: info.name,
          isWithheld,
          withheldReason: sr?.withheld_reason ?? null,
          courses: info.rows,
          grandTotal: Number(grandTotal.toFixed(2)),
          maxTotal: Number(maxTotal.toFixed(2)),
          percentage,
          result,
          sgpa,
          overallGrade,
          creditsEarned: Number(creditsEarned.toFixed(2)),
          classAward: award,
        }
      })
      .sort((a, b) => a.usn.localeCompare(b.usn, undefined, { numeric: true }))

    buckets.push({
      programCode: raw.programCode,
      programName: raw.programName,
      programLevel: raw.programLevel,
      semNumber: raw.semNumber,
      orderedCourses,
      students,
    })
  }

  return buckets
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  const clean = raw.replace(/[:\\/?*[\]]/g, '_').trim().slice(0, 31) || 'Ledger'
  let name = clean
  let suffix = 2
  while (used.has(name)) {
    name = `${clean.slice(0, 27)}_${suffix++}`
  }
  used.add(name)
  return name
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function populateStyledBranchSemesterSheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  institutionName: string,
  cycle: ExamCycle,
  bucket: BranchSemBucket
): void {
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 7 }],
    pageSetup: {
      paperSize: 8 as unknown as ExcelJS.PaperSize, // A3
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.2, right: 0.2, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })

  const totalCols = 3 + bucket.orderedCourses.length * 4 + 6

  // Institutional 4-Row Header Banner (matches legacy A3 ledger format)
  const bannerLines = [
    { row: 1, text: institutionName.toUpperCase(), size: 14 },
    { row: 2, text: 'Autonomous Institution affiliated to VTU, Belagavi', size: 11 },
    { row: 3, text: `DEPARTMENT OF ${bucket.programName.toUpperCase()}`, size: 11 },
    {
      row: 4,
      text: `Consolidated Result Sheet - ${cycle.name} (${cycle.code}) - SEM ${bucket.semNumber} (${cycle.cycle_type})`,
      size: 11,
    },
  ]

  for (const line of bannerLines) {
    ws.mergeCells(line.row, 1, line.row, totalCols)
    const cell = ws.getCell(line.row, 1)
    cell.value = line.text
    cell.font = { name: 'Calibri', size: line.size, bold: true, color: { argb: 'FF0F172A' } }
    cell.alignment = { horizontal: 'left', vertical: 'middle' }
    ws.getRow(line.row).height = line.row === 1 ? 22 : 18
  }
  ws.getRow(5).height = 8

  // Row 6 & Row 7: Merged 2-Tier Table Headers
  const staticLeft = [
    { col: 1, label: 'Sl. No' },
    { col: 2, label: 'USN' },
    { col: 3, label: 'Name of the Student' },
  ]
  for (const s of staticLeft) {
    ws.mergeCells(6, s.col, 7, s.col)
    const cell = ws.getCell(6, s.col)
    cell.value = s.label
    cell.font = { name: 'Calibri', size: 10, bold: true }
    cell.fill = FILL_HEADER_MAIN
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
    ws.getCell(7, s.col).border = THIN_BORDER
  }

  let col = 4
  for (const code of bucket.orderedCourses) {
    ws.mergeCells(6, col, 6, col + 3)
    const hCell = ws.getCell(6, col)
    hCell.value = code
    hCell.font = { name: 'Calibri', size: 10, bold: true }
    hCell.fill = FILL_HEADER_MAIN
    hCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    for (let k = 0; k < 4; k++) {
      ws.getCell(6, col + k).border = THIN_BORDER
      ws.getCell(6, col + k).fill = FILL_HEADER_MAIN
    }

    const subLabels = ['CIE', 'SEE', 'TOT', 'GRD']
    subLabels.forEach((lbl, idx) => {
      const sc = ws.getCell(7, col + idx)
      sc.value = lbl
      sc.font = { name: 'Calibri', size: 9, bold: true }
      sc.fill = FILL_HEADER_SUB
      sc.alignment = { horizontal: 'center', vertical: 'middle' }
      sc.border = THIN_BORDER
    })
    col += 4
  }

  const tailStart = col
  const tailHeaders = ['GRAND TOT', '%', 'RESULT', 'SGPA', 'GRADE', 'CREDITS']
  tailHeaders.forEach((lbl, idx) => {
    const c = tailStart + idx
    ws.mergeCells(6, c, 7, c)
    const cell = ws.getCell(6, c)
    cell.value = lbl
    cell.font = { name: 'Calibri', size: 9.5, bold: true }
    cell.fill = FILL_HEADER_MAIN
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
    ws.getCell(7, c).border = THIN_BORDER
  })

  ws.getRow(6).height = 22
  ws.getRow(7).height = 18
  ws.pageSetup.printTitlesRow = '6:7'

  // Data Rows (starting at Row 8)
  bucket.students.forEach((stu, idx) => {
    const r = 8 + idx
    const rowObj = ws.getRow(r)
    rowObj.height = 17
    const useZebra = idx % 2 === 1

    const setDataCell = (
      c: number,
      val: string | number,
      opts?: { align?: 'left' | 'center' | 'right'; bold?: boolean; red?: boolean; numFmt?: string }
    ) => {
      const cell = ws.getCell(r, c)
      cell.value = val
      cell.font = {
        name: 'Calibri',
        size: 9.5,
        bold: Boolean(opts?.bold || opts?.red),
        color: { argb: opts?.red ? 'FFFF0000' : 'FF0F172A' },
      }
      cell.alignment = { horizontal: opts?.align ?? 'center', vertical: 'middle' }
      cell.border = THIN_BORDER
      if (useZebra) cell.fill = FILL_ZEBRA
      if (opts?.numFmt) cell.numFmt = opts.numFmt
    }

    setDataCell(1, idx + 1)
    setDataCell(2, stu.usn)
    setDataCell(3, stu.name, { align: 'left' })

    let cPos = 4
    for (const code of bucket.orderedCourses) {
      const cr = stu.courses.get(code)
      if (!cr) {
        setDataCell(cPos, '-')
        setDataCell(cPos + 1, '-')
        setDataCell(cPos + 2, '-')
        setDataCell(cPos + 3, '-')
      } else if (stu.isWithheld) {
        setDataCell(cPos, 'W', { red: true })
        setDataCell(cPos + 1, 'W', { red: true })
        setDataCell(cPos + 2, 'W', { red: true })
        setDataCell(cPos + 3, 'W', { red: true })
      } else {
        const grdRaw = (cr.grade_code ?? cr.result_status ?? '-').trim().toUpperCase()
        const isNonCredit = isNonCreditCourse(cr)
        const cieVal: string | number = cr.cie_marks !== null && cr.cie_marks !== undefined ? Number(cr.cie_marks) : '-'
        const seeVal: string | number = isNonCredit
          ? '-'
          : cr.see_marks !== null && cr.see_marks !== undefined
            ? Number(cr.see_marks)
            : 0
        const totVal: string | number = cr.total_marks !== null && cr.total_marks !== undefined ? Number(cr.total_marks) : 0
        const grdDisplay = cr.is_graced ? `${grdRaw}+G` : grdRaw
        const isRed = FAIL_HIGHLIGHT_TOKENS.has(grdRaw)

        setDataCell(cPos, cieVal)
        setDataCell(cPos + 1, seeVal)
        setDataCell(cPos + 2, totVal)
        setDataCell(cPos + 3, grdDisplay, { red: isRed })
      }
      cPos += 4
    }

    if (stu.isWithheld) {
      setDataCell(tailStart, 'W', { red: true })
      setDataCell(tailStart + 1, 'W', { red: true })
      setDataCell(tailStart + 2, 'WITHHELD', { red: true })
      setDataCell(tailStart + 3, 'W', { red: true })
      setDataCell(tailStart + 4, 'W', { red: true })
      setDataCell(tailStart + 5, 'W', { red: true })
    } else {
      const isFail = stu.result !== 'PASS'
      setDataCell(tailStart, stu.grandTotal, { bold: true })
      setDataCell(tailStart + 1, stu.percentage, { numFmt: '0.00' })
      setDataCell(tailStart + 2, stu.result, { red: isFail, bold: true })
      setDataCell(tailStart + 3, stu.sgpa, { numFmt: '0.00', bold: true })
      setDataCell(tailStart + 4, stu.overallGrade, { red: isFail, bold: true })
      setDataCell(tailStart + 5, stu.creditsEarned)
    }
  })

  // Summary Stats & Official Signature Footer
  const totalStu = bucket.students.length
  const passStu = bucket.students.filter((s) => s.result === 'PASS').length
  const failStu = bucket.students.filter((s) => s.result === 'FAIL').length
  const whStu = bucket.students.filter((s) => s.result === 'WITHHELD').length
  const fcdStu = bucket.students.filter((s) => s.classAward === 'FCD').length
  const fcStu = bucket.students.filter((s) => s.classAward === 'FC').length
  const scStu = bucket.students.filter((s) => s.classAward === 'SC').length
  const passPct = totalStu - whStu > 0 ? ((passStu / (totalStu - whStu)) * 100).toFixed(2) : '0.00'

  const statRow = 8 + bucket.students.length + 1
  ws.mergeCells(statRow, 1, statRow, totalCols)
  const statCell = ws.getCell(statRow, 1)
  statCell.value = `Summary: Appeared: ${totalStu} | Passed: ${passStu} (${passPct}%) | Failed: ${failStu} | Withheld: ${whStu} | FCD: ${fcdStu} | FC: ${fcStu} | SC: ${scStu}   |   Legend: '-' = Not Registered / CIE-Only | PP/NP = Non-Credit Mandatory (Excluded from Grand Total & %) | +G = Grace`
  statCell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: 'FF1E293B' } }
  statCell.fill = FILL_TOTAL_ROW
  statCell.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(statRow).height = 20

  const sigRow = statRow + 4
  const midCol = Math.max(5, Math.floor(totalCols / 2))
  const rightCol = Math.max(midCol + 4, totalCols - 6)
  ws.getCell(sigRow, 2).value = 'Tabulated & Verified By'
  ws.getCell(sigRow, midCol).value = 'Controller of Examinations (COE)'
  ws.getCell(sigRow, rightCol).value = 'Principal / Head of Institution'
  for (const c of [2, midCol, rightCol]) {
    ws.getCell(sigRow, c).font = { name: 'Calibri', size: 10, bold: true }
  }

  // Exact Column Widths matching legacy A3 print fit
  ws.getColumn(1).width = 6
  ws.getColumn(2).width = 14
  ws.getColumn(3).width = 24
  for (let c = 4; c < tailStart; c++) {
    ws.getColumn(c).width = 5.5
  }
  ws.getColumn(tailStart).width = 10
  ws.getColumn(tailStart + 1).width = 7.5
  ws.getColumn(tailStart + 2).width = 9.5
  ws.getColumn(tailStart + 3).width = 7.5
  ws.getColumn(tailStart + 4).width = 7.5
  ws.getColumn(tailStart + 5).width = 8.5
}

/**
 * Exports a single styled multi-sheet A3 Landscape Master Ledger (.xlsx)
 * with a Summary sheet + one cleanly split sheet per Branch × Semester (e.g. AE_Sem1, AE_Sem2).
 */
export async function exportA3MasterLedgerWorkbook(params: {
  institutionName: string
  cycle: ExamCycle
  semesterResults: ExamSemesterResultItem[]
  courseResults: ExtendedCourseRow[]
  programFilter?: string
}): Promise<void> {
  const { institutionName, cycle, semesterResults, courseResults, programFilter = 'ALL' } = params
  const buckets = buildBranchSemesterBuckets(semesterResults, courseResults, programFilter)
  if (buckets.length === 0) {
    throw new Error('No course-level marks loaded yet for this filter. Wait for the Marks Ledger to finish loading and retry.')
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Mango Tree ERP'
  wb.created = new Date()

  // 1. Institutional Summary Sheet (Branch × Semester breakdown)
  const wsSum = wb.addWorksheet('Summary', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: {
      paperSize: 8 as unknown as ExcelJS.PaperSize, // A3
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })

  wsSum.mergeCells(1, 1, 1, 13)
  wsSum.getCell(1, 1).value = institutionName.toUpperCase()
  wsSum.getCell(1, 1).font = { name: 'Calibri', size: 14, bold: true }

  wsSum.mergeCells(2, 1, 2, 13)
  wsSum.getCell(2, 1).value = `MASTER TABULATION SUMMARY — ${cycle.name} (${cycle.code}) · AY ${cycle.academic_year}`
  wsSum.getCell(2, 1).font = { name: 'Calibri', size: 11, bold: true }

  const sumHeaders = [
    'Branch',
    'Semester',
    'Level',
    'Appeared',
    'Passed',
    'Failed',
    'Withheld',
    'Pass %',
    'FCD (>=70%)',
    'FC (60-69%)',
    'SC (50-59%)',
    'Pass Class',
    'Top SGPA',
  ]
  sumHeaders.forEach((h, i) => {
    const cell = wsSum.getCell(4, i + 1)
    cell.value = h
    cell.font = { name: 'Calibri', size: 10, bold: true }
    cell.fill = FILL_HEADER_MAIN
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = THIN_BORDER
  })
  wsSum.getRow(4).height = 22

  let rIdx = 5
  let gApp = 0
  let gPass = 0
  let gFail = 0
  let gWh = 0
  let gFcd = 0
  let gFc = 0
  let gSc = 0
  let gPcls = 0

  for (const b of buckets) {
    const app = b.students.length
    const pass = b.students.filter((s) => s.result === 'PASS').length
    const fail = b.students.filter((s) => s.result === 'FAIL' || s.result === 'PENDING').length
    const wh = b.students.filter((s) => s.result === 'WITHHELD').length
    const fcd = b.students.filter((s) => s.classAward === 'FCD').length
    const fc = b.students.filter((s) => s.classAward === 'FC').length
    const sc = b.students.filter((s) => s.classAward === 'SC').length
    const pcls = b.students.filter((s) => s.classAward === 'PASS').length
    const topSgpa = b.students.reduce((m, s) => (!s.isWithheld && s.sgpa > m ? s.sgpa : m), 0)
    const pct = Number(((pass / Math.max(1, app - wh)) * 100).toFixed(2))

    const vals = [b.programCode, `SEM ${b.semNumber}`, b.programLevel, app, pass, fail, wh, pct, fcd, fc, sc, pcls, Number(topSgpa.toFixed(2))]
    vals.forEach((v, i) => {
      const cell = wsSum.getCell(rIdx, i + 1)
      cell.value = v
      cell.font = { name: 'Calibri', size: 10, bold: i === 0 }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = THIN_BORDER
      if ((rIdx - 5) % 2 === 1) cell.fill = FILL_ZEBRA
      if (i === 7 || i === 12) cell.numFmt = '0.00'
    })
    gApp += app
    gPass += pass
    gFail += fail
    gWh += wh
    gFcd += fcd
    gFc += fc
    gSc += sc
    gPcls += pcls
    rIdx += 1
  }

  const totVals = [
    'TOTAL',
    'ALL',
    'ALL',
    gApp,
    gPass,
    gFail,
    gWh,
    Number(((gPass / Math.max(1, gApp - gWh)) * 100).toFixed(2)),
    gFcd,
    gFc,
    gSc,
    gPcls,
    '',
  ]
  totVals.forEach((v, i) => {
    const cell = wsSum.getCell(rIdx, i + 1)
    cell.value = v
    cell.font = { name: 'Calibri', size: 10, bold: true }
    cell.fill = FILL_TOTAL_ROW
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = THIN_BORDER
    if (i === 7) cell.numFmt = '0.00'
  })

  ;[11, 10, 8, 10, 10, 10, 10, 10, 13, 13, 13, 11, 10].forEach((w, i) => {
    wsSum.getColumn(i + 1).width = w
  })

  // 2. Styled Branch × Semester Sheets
  const usedNames = new Set<string>(['Summary'])
  for (const b of buckets) {
    const sheetTitle = sanitizeSheetName(`${b.programCode}_Sem${b.semNumber}`, usedNames)
    populateStyledBranchSemesterSheet(wb, sheetTitle, institutionName, cycle, b)
  }

  const buffer = await wb.xlsx.writeBuffer()
  triggerBlobDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${cycle.code}_A3_Master_Ledger_${programFilter}.xlsx`
  )
}

/**
 * Exports a ZIP archive of individual styled A3 Branch × Semester Ledgers
 * (e.g. Ledger_AE_Sem1_REGULAR.xlsx, Ledger_AE_Sem2_REGULAR.xlsx) — 1-to-1 match with legacy COE split ZIP!
 */
export async function exportSplitA3LedgersZip(params: {
  institutionName: string
  cycle: ExamCycle
  semesterResults: ExamSemesterResultItem[]
  courseResults: ExtendedCourseRow[]
  programFilter?: string
}): Promise<number> {
  const { institutionName, cycle, semesterResults, courseResults, programFilter = 'ALL' } = params
  const buckets = buildBranchSemesterBuckets(semesterResults, courseResults, programFilter)
  if (buckets.length === 0) {
    throw new Error('No course-level marks loaded yet for this filter. Wait for the Marks Ledger to finish loading and retry.')
  }
  const zip = new JSZip()

  for (const b of buckets) {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Mango Tree ERP'
    wb.created = new Date()
    populateStyledBranchSemesterSheet(wb, `${b.programCode}_Ledger`, institutionName, cycle, b)
    const buf = await wb.xlsx.writeBuffer()
    const fileName = `Ledger_${b.programCode}_Sem${b.semNumber}_${cycle.cycle_type}.xlsx`
    zip.file(fileName, new Uint8Array(buf as ArrayBuffer))
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const safeCycle = cycle.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim() || cycle.code
  triggerBlobDownload(zipBlob, `A3_Ledgers_Split_${safeCycle}.zip`)
  return buckets.length
}

export async function exportRankListWorkbook(params: {
  institutionName: string
  cycle: ExamCycle
  rows: RankedStudentRow[]
  branchLabel: string
}): Promise<void> {
  const { institutionName, cycle, rows, branchLabel } = params
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Mango Tree ERP'
  const ws = wb.addWorksheet('Merit Rank List', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  ws.mergeCells(1, 1, 1, 13)
  ws.getCell(1, 1).value = institutionName.toUpperCase()
  ws.getCell(1, 1).font = { name: 'Calibri', size: 14, bold: true }

  ws.mergeCells(2, 1, 2, 13)
  ws.getCell(2, 1).value = `OFFICIAL MERIT RANK & CLASS LIST — ${cycle.name} (${cycle.code}) · ${branchLabel}`
  ws.getCell(2, 1).font = { name: 'Calibri', size: 11, bold: true }

  const headers = [
    'Rank',
    'USN',
    'Candidate Name',
    'Program',
    'Level',
    'Semester',
    'Credits Earned',
    'Total Marks',
    'Max Marks',
    '%',
    'SGPA',
    'Class Award',
    'Grace?',
  ]
  headers.forEach((h, i) => {
    const c = ws.getCell(4, i + 1)
    c.value = h
    c.font = { name: 'Calibri', size: 10, bold: true }
    c.fill = FILL_HEADER_MAIN
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.border = THIN_BORDER
  })
  ws.getRow(4).height = 20

  rows.forEach((r, idx) => {
    const rowNum = 5 + idx
    const vals = [
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
    ]
    vals.forEach((v, i) => {
      const c = ws.getCell(rowNum, i + 1)
      c.value = v
      c.font = { name: 'Calibri', size: 10, bold: i === 0 || i === 10 || i === 11 }
      c.alignment = { horizontal: i === 2 ? 'left' : 'center', vertical: 'middle' }
      c.border = THIN_BORDER
      if (idx % 2 === 1) c.fill = FILL_ZEBRA
      if (i === 9 || i === 10) c.numFmt = '0.00'
    })
  })

  ;[7, 14, 26, 10, 7, 12, 13, 11, 10, 8, 8, 12, 8].forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  const buffer = await wb.xlsx.writeBuffer()
  triggerBlobDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${cycle.code}_Rank_List_${branchLabel}.xlsx`
  )
}
