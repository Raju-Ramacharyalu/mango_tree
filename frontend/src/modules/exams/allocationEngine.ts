import type { ExamCourseAlias, ExamRoom } from '@/types/exams'

export interface AllocationCandidate {
  student_id: string
  student_reg_no: string
  student_name: string
  registration_id: string
  registration_course_id: string
  course_id: string
  course_code: string
  course_title: string
  program_id: string
  program_code: string
  is_omr_exam: boolean
}

export interface PlannedSeat {
  room_id: string
  room_number: string
  seat_number: number
  seat_label: string
  student_id: string
  student_reg_no: string
  student_name: string
  registration_id: string
  registration_course_id: string
  course_id: string
  course_code: string
  effective_course_code: string
  program_id: string
  program_code: string
  is_omr_exam: boolean
}

export interface RoomPlanSummary {
  room: ExamRoom
  assignedCount: number
  remainingCapacity: number
  courseBranchCounts: Array<{
    effective_course_code: string
    program_code: string
    count: number
    firstUsn: string
    lastUsn: string
    is_omr_exam: boolean
  }>
}

export interface AllocationResult {
  seats: PlannedSeat[]
  unallocated: AllocationCandidate[]
  roomSummaries: RoomPlanSummary[]
  totalRoomsUsed: number
}

interface NormalizedCandidate extends AllocationCandidate {
  effective_course_code: string
}

interface RoomBucket {
  room: ExamRoom
  candidates: NormalizedCandidate[]
  remaining: number
}

/**
 * Clean room number formatting: removes trailing ".0" from spreadsheet imports
 * and trims whitespace.
 */
export function cleanRoomNumber(raw: string): string {
  return raw.trim().replace(/\.0+$/, '').toUpperCase()
}

/**
 * Natural numeric comparator so rooms sort as 101, 102, 201, LH-2, LH-10
 * rather than lexicographically (101, 102, 10, 20).
 */
export function naturalRoomCompare(a: Pick<ExamRoom, 'room_number' | 'sort_order'>, b: Pick<ExamRoom, 'room_number' | 'sort_order'>): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  const na = cleanRoomNumber(a.room_number)
  const nb = cleanRoomNumber(b.room_number)
  return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' })
}

function makeSeatLabel(seatNumber: number, columnsCount: number): string {
  const cols = Math.max(1, columnsCount)
  const row = Math.floor((seatNumber - 1) / cols) + 1
  const col = ((seatNumber - 1) % cols) + 1
  return `R${row}-C${col}`
}

/**
 * Deterministic multi-tenant room allocation engine:
 * 1. Resolves subject aliases (e.g. 1BKSK109 -> 1BKSK209, 1BENG106 -> 1BENG206).
 * 2. Sorts rooms numerically by sort_order + natural room number.
 * 3. OMR courses: strictly sequential, un-shuffled placement by course -> branch -> USN.
 * 4. Descriptive courses: consolidates small branches (<= threshold) into intact blocks
 *    so branches like ME/EE/CV are not split across unnecessary extra Form-B sheets,
 *    fills rooms to full capacity, and optionally interleaves distinct courses within
 *    shared rooms while keeping USN order monotonic per course.
 */
export function buildRoomAllotment(params: {
  candidates: AllocationCandidate[]
  rooms: ExamRoom[]
  aliases: ExamCourseAlias[]
  smallBranchThreshold: number
  interleaveDescriptive: boolean
  omrSequential: boolean
}): AllocationResult {
  const { candidates, rooms, aliases, smallBranchThreshold, interleaveDescriptive, omrSequential } = params

  const aliasMap = new Map<string, string>()
  for (const a of aliases) {
    if (!a.is_active) continue
    aliasMap.set(a.source_course_code.trim().toUpperCase(), a.canonical_course_code.trim().toUpperCase())
  }

  const normalized: NormalizedCandidate[] = candidates.map((c) => {
    const code = c.course_code.trim().toUpperCase()
    return {
      ...c,
      course_code: code,
      effective_course_code: aliasMap.get(code) ?? code,
    }
  })

  // Deduplicate by student_id for safety within a single date+session
  const uniqueByStudent = new Map<string, NormalizedCandidate>()
  for (const c of normalized) {
    if (!uniqueByStudent.has(c.student_id)) {
      uniqueByStudent.set(c.student_id, c)
    }
  }
  const allCandidates = Array.from(uniqueByStudent.values())

  const sortedRooms = [...rooms].filter((r) => r.is_active && r.capacity > 0).sort(naturalRoomCompare)
  const buckets: RoomBucket[] = sortedRooms.map((room) => ({
    room,
    candidates: [],
    remaining: room.capacity,
  }))

  const unallocated: AllocationCandidate[] = []

  const omrList = allCandidates
    .filter((c) => c.is_omr_exam)
    .sort((a, b) => {
      const cCmp = a.effective_course_code.localeCompare(b.effective_course_code)
      if (cCmp !== 0) return cCmp
      const pCmp = a.program_code.localeCompare(b.program_code)
      if (pCmp !== 0) return pCmp
      return a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true })
    })

  const descList = allCandidates.filter((c) => !c.is_omr_exam)

  // Phase A: OMR Courses — Strictly sequential, un-shuffled placement filling rooms in numeric order
  let omrCursor = 0
  for (const bucket of buckets) {
    if (omrCursor >= omrList.length) break
    if (bucket.remaining <= 0) continue
    const take = Math.min(bucket.remaining, omrList.length - omrCursor)
    const slice = omrList.slice(omrCursor, omrCursor + take)
    bucket.candidates.push(...slice)
    bucket.remaining -= slice.length
    omrCursor += take
  }
  if (omrCursor < omrList.length) {
    unallocated.push(...omrList.slice(omrCursor))
  }

  // Phase B: Descriptive Courses — Group by (effective_course_code, program_code)
  const descGroupMap = new Map<string, NormalizedCandidate[]>()
  for (const c of descList) {
    const key = `${c.effective_course_code}::${c.program_code}`
    const arr = descGroupMap.get(key) ?? []
    arr.push(c)
    descGroupMap.set(key, arr)
  }

  const descGroups = Array.from(descGroupMap.values()).map((items) =>
    items.sort((a, b) => a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true }))
  )

  const largeGroups = descGroups
    .filter((g) => g.length > smallBranchThreshold)
    .sort((a, b) => b.length - a.length || a[0].effective_course_code.localeCompare(b[0].effective_course_code))

  const smallGroups = descGroups
    .filter((g) => g.length <= smallBranchThreshold)
    .sort((a, b) => b.length - a.length || a[0].program_code.localeCompare(b[0].program_code))

  // Place large groups first, filling rooms fully in numeric order
  for (const group of largeGroups) {
    let idx = 0
    for (const bucket of buckets) {
      if (idx >= group.length) break
      if (bucket.remaining <= 0) continue
      const take = Math.min(bucket.remaining, group.length - idx)
      bucket.candidates.push(...group.slice(idx, idx + take))
      bucket.remaining -= take
      idx += take
    }
    if (idx < group.length) {
      unallocated.push(...group.slice(idx))
    }
  }

  // Place small branches intact using Best-Fit (prefer partially filled rooms that fit the entire branch
  // without splitting; otherwise open the next available numeric room)
  for (const group of smallGroups) {
    // 1. Best-fit partially occupied room that fits the whole branch without splitting
    const partialFit = buckets
      .filter((b) => b.candidates.length > 0 && b.remaining >= group.length)
      .sort((a, b) => a.remaining - b.remaining)[0]

    if (partialFit) {
      partialFit.candidates.push(...group)
      partialFit.remaining -= group.length
      continue
    }

    // 2. First empty room that fits the whole branch intact
    const emptyFit = buckets.find((b) => b.candidates.length === 0 && b.remaining >= group.length)
    if (emptyFit) {
      emptyFit.candidates.push(...group)
      emptyFit.remaining -= group.length
      continue
    }

    // 3. Fallback if total remaining capacity is fragmented: pack remaining slots
    let idx = 0
    for (const bucket of buckets) {
      if (idx >= group.length) break
      if (bucket.remaining <= 0) continue
      const take = Math.min(bucket.remaining, group.length - idx)
      bucket.candidates.push(...group.slice(idx, idx + take))
      bucket.remaining -= take
      idx += take
    }
    if (idx < group.length) {
      unallocated.push(...group.slice(idx))
    }
  }

  // Phase C: Assign seat numbers within each room
  const seats: PlannedSeat[] = []
  const roomSummaries: RoomPlanSummary[] = []

  for (const bucket of buckets) {
    if (bucket.candidates.length === 0) continue

    const roomOmr = bucket.candidates.filter((c) => c.is_omr_exam)
    const roomDesc = bucket.candidates.filter((c) => !c.is_omr_exam)

    let ordered: NormalizedCandidate[] = []

    // OMR candidates stay strictly sequential (un-shuffled) if omrSequential is true
    if (roomOmr.length > 0) {
      const sortedOmr = omrSequential
        ? roomOmr
        : [...roomOmr].sort((a, b) => a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true }))
      ordered.push(...sortedOmr)
    }

    // Descriptive candidates: interleave distinct effective courses when multiple courses share a room
    if (roomDesc.length > 0) {
      const byCourse = new Map<string, NormalizedCandidate[]>()
      for (const c of roomDesc) {
        const arr = byCourse.get(c.effective_course_code) ?? []
        arr.push(c)
        byCourse.set(c.effective_course_code, arr)
      }
      const queues = Array.from(byCourse.values())
        .map((q) =>
          q.sort((a, b) => {
            const p = a.program_code.localeCompare(b.program_code)
            if (p !== 0) return p
            return a.student_reg_no.localeCompare(b.student_reg_no, undefined, { numeric: true })
          })
        )
        .sort((a, b) => b.length - a.length)

      if (interleaveDescriptive && queues.length > 1) {
        let added = true
        while (added) {
          added = false
          for (const q of queues) {
            const next = q.shift()
            if (next) {
              ordered.push(next)
              added = true
            }
          }
        }
      } else {
        for (const q of queues) {
          ordered.push(...q)
        }
      }
    }

    const summaryMap = new Map<
      string,
      {
        effective_course_code: string
        program_code: string
        usns: string[]
        is_omr_exam: boolean
      }
    >()

    ordered.forEach((cand, idx) => {
      const seatNumber = idx + 1
      seats.push({
        room_id: bucket.room.id,
        room_number: cleanRoomNumber(bucket.room.room_number),
        seat_number: seatNumber,
        seat_label: makeSeatLabel(seatNumber, bucket.room.columns_count),
        student_id: cand.student_id,
        student_reg_no: cand.student_reg_no,
        student_name: cand.student_name,
        registration_id: cand.registration_id,
        registration_course_id: cand.registration_course_id,
        course_id: cand.course_id,
        course_code: cand.course_code,
        effective_course_code: cand.effective_course_code,
        program_id: cand.program_id,
        program_code: cand.program_code,
        is_omr_exam: cand.is_omr_exam,
      })

      const key = `${cand.effective_course_code}::${cand.program_code}`
      const entry = summaryMap.get(key) ?? {
        effective_course_code: cand.effective_course_code,
        program_code: cand.program_code,
        usns: [],
        is_omr_exam: cand.is_omr_exam,
      }
      entry.usns.push(cand.student_reg_no)
      summaryMap.set(key, entry)
    })

    const courseBranchCounts = Array.from(summaryMap.values())
      .map((e) => {
        const sortedUsns = [...e.usns].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        return {
          effective_course_code: e.effective_course_code,
          program_code: e.program_code,
          count: sortedUsns.length,
          firstUsn: sortedUsns[0] ?? '—',
          lastUsn: sortedUsns[sortedUsns.length - 1] ?? '—',
          is_omr_exam: e.is_omr_exam,
        }
      })
      .sort(
        (a, b) =>
          a.effective_course_code.localeCompare(b.effective_course_code) ||
          a.program_code.localeCompare(b.program_code)
      )

    roomSummaries.push({
      room: bucket.room,
      assignedCount: ordered.length,
      remainingCapacity: bucket.room.capacity - ordered.length,
      courseBranchCounts,
    })
  }

  return {
    seats,
    unallocated,
    roomSummaries,
    totalRoomsUsed: roomSummaries.length,
  }
}
