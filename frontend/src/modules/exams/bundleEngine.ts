import type { CourseResultStatus, GradeScaleItemRow, ProgramLevel } from '@/types/exams'

export interface BundleSourceScript {
  seat_allotment_id: string | null
  registration_id: string
  registration_course_id: string
  student_id: string
  student_reg_no: string
  student_name: string
  course_id: string
  course_code: string
  course_title: string
  effective_course_code: string
  program_id: string
  program_code: string
  program_level: ProgramLevel
  booklet_number: string | null
  is_malpractice: boolean
}

export interface PlannedBundle {
  bundle_code: string
  bundle_sequence: number
  course_id: string
  effective_course_code: string
  course_title: string
  program_id: string
  program_code: string
  program_level: ProgramLevel
  usn_series_prefix: string | null
  scripts: Array<BundleSourceScript & { script_sequence: number; dummy_code: string }>
}

/**
 * Extracts the leading 3-character college/series code from a VTU-style USN
 * (e.g. "1AM25CS001" -> "1AM", "1AX25CS014" -> "1AX").
 */
export function extractUsnSeriesPrefix(usn: string): string {
  const clean = usn.trim().toUpperCase()
  const match = clean.match(/^([0-9][A-Z]{2})/)
  return match ? match[1] : clean.slice(0, 3) || 'GEN'
}

/**
 * Strips spaces from course codes (ensuring PG codes like 25MCS214C stay compact)
 * and normalizes uppercase.
 */
export function normalizeCourseCode(code: string): string {
  return code.trim().replace(/\s+/g, '').toUpperCase()
}

function deterministicShuffle<T>(items: T[], seedStr: string): T[] {
  const arr = [...items]
  let seed = 2166136261
  for (let i = 0; i < seedStr.length; i += 1) {
    seed ^= seedStr.charCodeAt(i)
    seed = Math.imul(seed, 16777619)
  }
  for (let i = arr.length - 1; i > 0; i -= 1) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507)
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909)
    const rand = ((seed ^ (seed >>> 16)) >>> 0) / 4294967296
    const j = Math.floor(rand * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/**
 * Groups answer scripts strictly by (effective_course_code, program_code) — never by room.
 * Branches listed in splitSeriesBranches (default: CS, CSE) — or all branches if splitAllBranches
 * is enabled — are further separated by USN series prefix (e.g. 1AM vs 1AX).
 * Works uniformly for UG and PG courses.
 */
export function buildCourseBranchBundles(params: {
  scripts: BundleSourceScript[]
  maxBundleSize: number
  splitSeriesBranches: string[]
  splitAllBranches: boolean
  shuffleDummyCodes: boolean
  cycleCode: string
}): PlannedBundle[] {
  const { scripts, maxBundleSize, splitSeriesBranches, splitAllBranches, shuffleDummyCodes, cycleCode } = params
  const chunkCap = Math.max(1, maxBundleSize)
  const splitBranchSet = new Set(splitSeriesBranches.map((b) => b.trim().toUpperCase()).filter(Boolean))

  // Deduplicate by registration_course_id
  const uniqueMap = new Map<string, BundleSourceScript>()
  for (const s of scripts) {
    if (!uniqueMap.has(s.registration_course_id)) {
      uniqueMap.set(s.registration_course_id, {
        ...s,
        effective_course_code: normalizeCourseCode(s.effective_course_code || s.course_code),
      })
    }
  }

  // First group by (effective_course_code, program_code) to inspect whether multiple series exist
  const baseGroups = new Map<string, BundleSourceScript[]>()
  for (const s of uniqueMap.values()) {
    const key = `${s.effective_course_code}::${s.program_code.trim().toUpperCase()}`
    const arr = baseGroups.get(key) ?? []
    arr.push(s)
    baseGroups.set(key, arr)
  }

  const finalGroups: Array<{
    effective_course_code: string
    program_code: string
    usn_series_prefix: string | null
    items: BundleSourceScript[]
  }> = []

  for (const [, items] of baseGroups.entries()) {
    const first = items[0]
    const progCode = first.program_code.trim().toUpperCase()
    const shouldSplitSeries = splitAllBranches || splitBranchSet.has(progCode)

    if (shouldSplitSeries) {
      const seriesMap = new Map<string, BundleSourceScript[]>()
      for (const s of items) {
        const prefix = extractUsnSeriesPrefix(s.student_reg_no)
        const arr = seriesMap.get(prefix) ?? []
        arr.push(s)
        seriesMap.set(prefix, arr)
      }
      const distinctSeries = Array.from(seriesMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      for (const [seriesPrefix, seriesItems] of distinctSeries) {
        finalGroups.push({
          effective_course_code: first.effective_course_code,
          program_code: progCode,
          usn_series_prefix: seriesPrefix,
          items: seriesItems,
        })
      }
    } else {
      finalGroups.push({
        effective_course_code: first.effective_course_code,
        program_code: progCode,
        usn_series_prefix: null,
        items,
      })
    }
  }

  finalGroups.sort((a, b) => {
    const cCmp = a.effective_course_code.localeCompare(b.effective_course_code)
    if (cCmp !== 0) return cCmp
    const pCmp = a.program_code.localeCompare(b.program_code)
    if (pCmp !== 0) return pCmp
    return (a.usn_series_prefix ?? '').localeCompare(b.usn_series_prefix ?? '')
  })

  const planned: PlannedBundle[] = []
  const cycleTag = cycleCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)

  for (const grp of finalGroups) {
    const sortedItems = [...grp.items].sort((a, b) =>
      a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true })
    )

    let bundleSeq = 1
    for (let i = 0; i < sortedItems.length; i += chunkCap) {
      const slice = sortedItems.slice(i, i + chunkCap)
      const seqPad = String(bundleSeq).padStart(2, '0')
      const bundleCode = grp.usn_series_prefix
        ? `${grp.effective_course_code}-${grp.program_code}-${grp.usn_series_prefix}-B${seqPad}`
        : `${grp.effective_course_code}-${grp.program_code}-B${seqPad}`

      const orderedForCoding = shuffleDummyCodes
        ? deterministicShuffle(slice, `${cycleTag}::${bundleCode}`)
        : slice

      const codedScripts = orderedForCoding.map((item, idx) => {
        const scriptSeq = idx + 1
        const dummyCode = `${bundleCode}-${String(scriptSeq).padStart(3, '0')}`
        return {
          ...item,
          script_sequence: scriptSeq,
          dummy_code: dummyCode,
        }
      })

      planned.push({
        bundle_code: bundleCode,
        bundle_sequence: bundleSeq,
        course_id: slice[0].course_id,
        effective_course_code: grp.effective_course_code,
        course_title: slice[0].course_title,
        program_id: slice[0].program_id,
        program_code: grp.program_code,
        program_level: slice[0].program_level,
        usn_series_prefix: grp.usn_series_prefix,
        scripts: codedScripts,
      })
      bundleSeq += 1
    }
  }

  return planned
}

/**
 * Standard VTU 10-point fallback grading scale if an institution has not yet
 * configured rows in grade_scale_items.
 */
export const DEFAULT_VTU_GRADE_SCALE: GradeScaleItemRow[] = [
  { grade_code: 'O', description: 'Outstanding', grade_point: 10, min_percentage: 90, max_percentage: 100, is_pass: true, sort_order: 1 },
  { grade_code: 'A+', description: 'Excellent', grade_point: 9, min_percentage: 80, max_percentage: 89.99, is_pass: true, sort_order: 2 },
  { grade_code: 'A', description: 'Very Good', grade_point: 8, min_percentage: 70, max_percentage: 79.99, is_pass: true, sort_order: 3 },
  { grade_code: 'B+', description: 'Good', grade_point: 7, min_percentage: 60, max_percentage: 69.99, is_pass: true, sort_order: 4 },
  { grade_code: 'B', description: 'Above Average', grade_point: 6, min_percentage: 55, max_percentage: 59.99, is_pass: true, sort_order: 5 },
  { grade_code: 'C', description: 'Average', grade_point: 5, min_percentage: 50, max_percentage: 54.99, is_pass: true, sort_order: 6 },
  { grade_code: 'P', description: 'Pass', grade_point: 4, min_percentage: 40, max_percentage: 49.99, is_pass: true, sort_order: 7 },
  { grade_code: 'F', description: 'Fail', grade_point: 0, min_percentage: 0, max_percentage: 39.99, is_pass: false, sort_order: 8 },
]

export function evaluateCourseGrade(params: {
  is_online_exempt: boolean
  current_status: CourseResultStatus
  cie_marks: number | null
  cie_max_marks: number
  see_marks: number | null
  see_max_marks: number
  min_cie_percent: number
  min_see_percent: number
  min_total_percent: number
  scaleItems: GradeScaleItemRow[]
}): {
  total_marks: number | null
  max_total_marks: number
  percentage: number | null
  grade_code: string
  grade_point: number
  result_status: CourseResultStatus
} {
  const {
    is_online_exempt,
    current_status,
    cie_marks,
    cie_max_marks,
    see_marks,
    see_max_marks,
    min_cie_percent,
    min_see_percent,
    min_total_percent,
    scaleItems,
  } = params

  const maxTotal = Math.max(1, (cie_max_marks || 0) + (see_max_marks || 0))

  if (is_online_exempt) {
    return {
      total_marks: null,
      max_total_marks: maxTotal,
      percentage: null,
      grade_code: 'PP',
      grade_point: 0,
      result_status: 'EXEMPT',
    }
  }

  if (current_status === 'ABSENT') {
    return {
      total_marks: cie_marks ?? 0,
      max_total_marks: maxTotal,
      percentage: 0,
      grade_code: 'AB',
      grade_point: 0,
      result_status: 'ABSENT',
    }
  }

  if (current_status === 'MALPRACTICE') {
    return {
      total_marks: 0,
      max_total_marks: maxTotal,
      percentage: 0,
      grade_code: 'MP',
      grade_point: 0,
      result_status: 'MALPRACTICE',
    }
  }

  if (current_status === 'WITHHELD') {
    return {
      total_marks: cie_marks !== null && see_marks !== null ? Number((cie_marks + see_marks).toFixed(2)) : null,
      max_total_marks: maxTotal,
      percentage: null,
      grade_code: 'WH',
      grade_point: 0,
      result_status: 'WITHHELD',
    }
  }

  const needsCie = cie_max_marks > 0
  const needsSee = see_max_marks > 0
  if ((needsCie && cie_marks === null) || (needsSee && see_marks === null)) {
    return {
      total_marks: null,
      max_total_marks: maxTotal,
      percentage: null,
      grade_code: '—',
      grade_point: 0,
      result_status: 'PENDING',
    }
  }

  const cie = cie_marks ?? 0
  const see = see_marks ?? 0
  const total = Number((cie + see).toFixed(2))
  const pct = Number(((total / maxTotal) * 100).toFixed(2))

  const ciePass = !needsCie || (cie / cie_max_marks) * 100 >= min_cie_percent
  const seePass = !needsSee || (see / see_max_marks) * 100 >= min_see_percent
  const totalPass = pct >= min_total_percent

  const effectiveScale = (scaleItems.length > 0 ? scaleItems : DEFAULT_VTU_GRADE_SCALE).sort(
    (a, b) => (b.min_percentage ?? -1) - (a.min_percentage ?? -1)
  )

  if (!ciePass || !seePass || !totalPass) {
    return {
      total_marks: total,
      max_total_marks: maxTotal,
      percentage: pct,
      grade_code: 'F',
      grade_point: 0,
      result_status: 'FAIL',
    }
  }

  const matched =
    effectiveScale.find(
      (g) => g.is_pass && g.min_percentage !== null && pct >= g.min_percentage
    ) ?? effectiveScale.find((g) => g.is_pass)

  return {
    total_marks: total,
    max_total_marks: maxTotal,
    percentage: pct,
    grade_code: matched?.grade_code ?? 'P',
    grade_point: Number(matched?.grade_point ?? 4),
    result_status: 'PASS',
  }
}
