import { supabase } from '@/services/supabase'
import type { ImportMode, MigrationEntityType, StagedPreviewRow } from '@/types/migrations'
import {
  cleanDateString,
  normalizeProgramLevel,
  normalizeRawHeaders,
  normalizeStudentCategory,
  parseBool,
} from './csvTemplates'

export async function fetchAllInstitutionRows<T extends Record<string, unknown>>(
  table: string,
  selectColumns: string,
  institutionId: string,
  filterDeleted = false
): Promise<T[]> {
  const all: T[] = []
  let start = 0
  const step = 1000
  while (true) {
    let query = supabase
      .from(table)
      .select(selectColumns)
      .eq('institution_id', institutionId)
      .range(start, start + step - 1)
    if (filterDeleted) {
      query = query.is('deleted_at', null)
    }
    const { data, error } = await query
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as unknown as T[]))
    if (data.length < step) break
    start += step
  }
  return all
}

async function ensureCsvMigrationSource(institutionId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('migration_sources')
    .select('id, code')
    .eq('institution_id', institutionId)
    .in('code', ['CSV_IMPORT', 'AMC_LEGACY_STREAMLIT'])
    .limit(2)

  const preferred = existing?.find((s) => s.code === 'CSV_IMPORT') ?? existing?.[0]
  if (preferred) return preferred.id as string

  const { data: created, error } = await supabase
    .from('migration_sources')
    .insert({
      institution_id: institutionId,
      code: 'CSV_IMPORT',
      name: 'Command Center CSV Importer',
      source_type: 'CSV_UPLOAD',
      description: 'Validated CSV staging and idempotent import source',
    })
    .select('id')
    .single()
  if (error) throw error
  return created.id as string
}

interface InstitutionLookupContext {
  programsByCode: Map<string, { id: string; code: string; name: string }>
  unitsByCode: Map<string, { id: string; code: string }>
  categoriesByCode: Map<string, { id: string; code: string; is_online: boolean; is_elective: boolean }>
  periodsBySeq: Map<number, { id: string; code: string; period_type_id: string }>
  defaultPeriodTypeId: string | null
  coursesByCode: Map<string, { id: string; course_code: string }>
  studentsByReg: Map<string, { id: string; registration_number: string; full_name: string }>
  staffByCode: Map<string, { id: string; employee_code: string }>
  tmpMaxSeqByBranch: Map<string, number>
  staffMaxSeqByBranchYear: Map<string, number>
  activeAcademicYear: string
}

async function loadLookupContext(institutionId: string): Promise<InstitutionLookupContext> {
  const [programs, units, categories, periods, periodTypes, courses, students, staff, settingsRes] =
    await Promise.all([
      fetchAllInstitutionRows<{ id: string; code: string; name: string }>('programs', 'id, code, name', institutionId, true),
      fetchAllInstitutionRows<{ id: string; code: string }>('academic_units', 'id, code', institutionId, true),
      fetchAllInstitutionRows<{ id: string; code: string; is_online: boolean; is_elective: boolean }>(
        'course_categories',
        'id, code, is_online, is_elective',
        institutionId
      ),
      fetchAllInstitutionRows<{ id: string; code: string; sequence_number: number; legacy_semester_id: number | null; period_type_id: string }>(
        'academic_periods',
        'id, code, sequence_number, legacy_semester_id, period_type_id',
        institutionId
      ),
      fetchAllInstitutionRows<{ id: string; code: string }>('academic_period_types', 'id, code', institutionId),
      fetchAllInstitutionRows<{ id: string; course_code: string }>('course_catalog', 'id, course_code', institutionId, true),
      fetchAllInstitutionRows<{ id: string; registration_number: string; full_name: string }>(
        'students',
        'id, registration_number, full_name',
        institutionId,
        true
      ),
      fetchAllInstitutionRows<{ id: string; employee_code: string }>('staff_profiles', 'id, employee_code', institutionId, true),
      supabase
        .from('institution_settings')
        .select('setting_key, setting_value')
        .eq('institution_id', institutionId)
        .eq('setting_key', 'active_academic_year')
        .maybeSingle(),
    ])

  const programsByCode = new Map(programs.map((p) => [p.code.toUpperCase(), p]))
  const unitsByCode = new Map(units.map((u) => [u.code.toUpperCase(), u]))
  const categoriesByCode = new Map(categories.map((c) => [c.code.toUpperCase(), c]))
  const periodsBySeq = new Map<number, { id: string; code: string; period_type_id: string }>()
  for (const p of periods) {
    const key = p.legacy_semester_id ?? p.sequence_number
    if (!periodsBySeq.has(key)) periodsBySeq.set(key, { id: p.id, code: p.code, period_type_id: p.period_type_id })
  }
  const defaultPeriodTypeId =
    periodTypes.find((pt) => pt.code === 'SEMESTER')?.id ?? periodTypes[0]?.id ?? null

  const coursesByCode = new Map(courses.map((c) => [c.course_code.toUpperCase(), c]))
  const studentsByReg = new Map(students.map((s) => [s.registration_number.toUpperCase(), s]))
  const staffByCode = new Map(staff.map((s) => [s.employee_code.toUpperCase(), s]))

  const tmpMaxSeqByBranch = new Map<string, number>()
  for (const s of students) {
    const u = s.registration_number.toUpperCase()
    if (u.startsWith('TMP-')) {
      const parts = u.split('-')
      if (parts.length >= 3) {
        const seq = Number(parts[parts.length - 1])
        const br = parts.slice(1, -1).join('-')
        if (!Number.isNaN(seq) && seq > (tmpMaxSeqByBranch.get(br) ?? 0)) {
          tmpMaxSeqByBranch.set(br, seq)
        }
      }
    }
  }

  const currentYearTwoDigit = String(new Date().getFullYear()).slice(-2)
  const staffMaxSeqByBranchYear = new Map<string, number>()
  for (const st of staff) {
    const fid = st.employee_code.toUpperCase()
    const match = /^([A-Z]+)(\d{2})(\d{2,})$/.exec(fid)
    if (match && match[2] === currentYearTwoDigit) {
      const br = match[1]
      const seq = Number(match[3])
      if (seq > (staffMaxSeqByBranchYear.get(br) ?? 0)) {
        staffMaxSeqByBranchYear.set(br, seq)
      }
    }
  }

  const ayVal = settingsRes.data?.setting_value
  const activeAcademicYear = typeof ayVal === 'string' && ayVal.trim() ? ayVal.trim() : '2026-27'

  return {
    programsByCode,
    unitsByCode,
    categoriesByCode,
    periodsBySeq,
    defaultPeriodTypeId,
    coursesByCode,
    studentsByReg,
    staffByCode,
    tmpMaxSeqByBranch,
    staffMaxSeqByBranchYear,
    activeAcademicYear,
  }
}

export async function validateCsvRows(
  institutionId: string,
  entityType: MigrationEntityType,
  rawRows: Record<string, unknown>[]
): Promise<StagedPreviewRow[]> {
  const ctx = await loadLookupContext(institutionId)
  const seenKeysInCsv = new Set<string>()
  const localTmpSeq = new Map(ctx.tmpMaxSeqByBranch)
  const localStaffSeq = new Map(ctx.staffMaxSeqByBranchYear)
  const currentYearTwoDigit = String(new Date().getFullYear()).slice(-2)

  return rawRows.map((raw, idx) => {
    const rowNumber = idx + 2
    const clean = normalizeRawHeaders(raw)
    const messages: string[] = []
    let sourceKey = ''
    let existingTargetId: string | undefined
    const normalized: Record<string, unknown> = {}

    if (entityType === 'PROGRAMS') {
      const code = (clean.branch_code || clean.code || '').toUpperCase()
      const name = clean.branch_name || clean.name || ''
      if (!code) messages.push('Missing required branch_code.')
      if (!name) messages.push('Missing required branch_name.')
      sourceKey = code || `ROW_${rowNumber}`
      const level = normalizeProgramLevel(clean.program_type || clean.program_level || 'UG')
      const duration = Number(clean.duration_years) || (level === 'PG' ? 2 : level === 'DIPLOMA' ? 3 : 4)
      const qual = clean.qualification || (level === 'PG' ? 'M.Tech / MBA / MCA' : level === 'DIPLOMA' ? 'Diploma' : 'B.E.')

      Object.assign(normalized, {
        code,
        name,
        program_level: level,
        qualification: qual,
        duration_years: duration,
        dept_code: (clean.dept_code || clean.dept_name || '').toUpperCase() || null,
      })

      const existing = ctx.programsByCode.get(code)
      if (existing) existingTargetId = existing.id
    } else if (entityType === 'COURSE_CATALOG') {
      const courseCode = (clean.course_code || '').toUpperCase()
      const title = clean.title || ''
      if (!courseCode) messages.push('Missing required course_code.')
      if (!title) messages.push('Missing required title.')
      sourceKey = courseCode || `ROW_${rowNumber}`

      const courseType = (clean.course_type || 'CORE').toUpperCase()
      const isOnline = courseType === 'ONLINE'
      const rawTotal = Number(clean.total_marks)
      const totalMarks = isOnline ? (rawTotal > 0 ? rawTotal : 100) : (Number.isNaN(rawTotal) ? 100 : rawTotal)
      const maxCie = isOnline ? 0 : (Number(clean.max_cie) || 0)
      const maxSee = isOnline ? 0 : (Number(clean.max_see) || 0)
      const branchCodes = (clean.branch_code || '')
        .split(',')
        .map((b) => b.trim().toUpperCase())
        .filter(Boolean)

      for (const b of branchCodes) {
        if (!ctx.programsByCode.has(b)) {
          messages.push(`Branch/Program '${b}' not found in Programs (course will still be added to catalog if fixed or program created first).`)
        }
      }

      Object.assign(normalized, {
        course_code: courseCode,
        title,
        branch_codes: branchCodes,
        semester_id: clean.semester_id ? Number(clean.semester_id) : null,
        credits: clean.credits !== '' ? Number(clean.credits) : 3,
        max_cie: maxCie,
        max_see: maxSee,
        total_marks: totalMarks,
        course_type: courseType,
        scheme_batch: clean.scheme_batch ? Number(clean.scheme_batch) : 25,
        offering_department: (clean.offering_department || '').toUpperCase() || null,
        specialization: (clean.specialization || 'GENERAL').toUpperCase() || 'GENERAL',
      })

      const existing = ctx.coursesByCode.get(courseCode)
      if (existing) existingTargetId = existing.id
    } else if (entityType === 'STAFF') {
      const fullName = clean.full_name || ''
      const dept = (clean.dept || 'GEN').toUpperCase()
      const branch = (clean.branch || dept || 'GEN').toUpperCase()
      let empCode = (clean.faculty_id || clean.employee_code || '').toUpperCase()
      if (!fullName) messages.push('Missing required full_name.')

      if (!empCode || ['MISSING', 'NAN', 'NONE', 'NULL'].includes(empCode)) {
        const nextSeq = (localStaffSeq.get(branch) ?? 0) + 1
        localStaffSeq.set(branch, nextSeq)
        empCode = `${branch}${currentYearTwoDigit}${String(nextSeq).padStart(2, '0')}`
      }
      sourceKey = empCode

      Object.assign(normalized, {
        employee_code: empCode,
        full_name: fullName,
        designation: clean.role || clean.designation || 'Faculty',
        department_label: dept,
        branch_label: branch,
        email: clean.email && !['none', 'nan', 'null'].includes(clean.email.toLowerCase()) ? clean.email.toLowerCase() : null,
        is_evaluator: parseBool(clean.is_evaluator || 'false'),
      })

      const existing = ctx.staffByCode.get(empCode)
      if (existing) existingTargetId = existing.id
    } else if (entityType === 'STUDENTS') {
      const fullName = (clean.full_name || '').toUpperCase()
      const branch = (clean.branch_code || '').toUpperCase()
      if (!fullName) messages.push('Missing required full_name.')
      if (!branch) {
        messages.push('Missing required branch_code.')
      } else if (!ctx.programsByCode.has(branch)) {
        messages.push(`Program '${branch}' does not exist yet. Import Programs first.`)
      }

      let regNo = (clean.usn || clean.registration_number || '').toUpperCase()
      let isTemp = false
      if (!regNo || ['NAN', 'NONE', 'NULL'].includes(regNo)) {
        const nextSeq = (localTmpSeq.get(branch || 'GEN') ?? 0) + 1
        localTmpSeq.set(branch || 'GEN', nextSeq)
        regNo = `TMP-${branch || 'GEN'}-${String(nextSeq).padStart(3, '0')}`
        isTemp = true
      } else if (regNo.startsWith('TMP-')) {
        isTemp = true
      }
      sourceKey = regNo

      const semNum = clean.current_sem ? Number(clean.current_sem) : null
      if (semNum && !ctx.periodsBySeq.has(semNum)) {
        messages.push(`Academic period #${semNum} not configured for this institution.`)
      }

      Object.assign(normalized, {
        registration_number: regNo,
        is_temporary_registration: isTemp,
        full_name: fullName,
        branch_code: branch,
        current_sem: semNum,
        section: clean.section ? clean.section.toUpperCase() : null,
        scheme_batch: clean.scheme_batch ? Number(clean.scheme_batch) : 25,
        phone: clean.contact ? clean.contact.split('.')[0].trim() : null,
        email: clean.email && !['none', 'nan', 'null'].includes(clean.email.toLowerCase()) ? clean.email.toLowerCase() : null,
        dob: cleanDateString(clean.dob || ''),
        student_category: normalizeStudentCategory(clean.student_category || 'REGULAR'),
        specialization: (clean.specialization || 'GENERAL').toUpperCase() || 'GENERAL',
      })

      const existing = ctx.studentsByReg.get(regNo)
      if (existing) existingTargetId = existing.id
    } else if (entityType === 'STUDENT_USN_MIGRATION') {
      const tempUsn = (clean.temp_usn || '').toUpperCase()
      const officialUsn = (clean.official_usn || '').toUpperCase()
      if (!tempUsn) messages.push('Missing required temp_usn.')
      if (!officialUsn) messages.push('Missing required official_usn.')
      if (tempUsn && !ctx.studentsByReg.has(tempUsn)) {
        messages.push(`Temporary USN '${tempUsn}' not found in institution students.`)
      }
      if (officialUsn && ctx.studentsByReg.has(officialUsn)) {
        messages.push(`Official USN '${officialUsn}' already exists.`)
      }
      sourceKey = `${tempUsn}->${officialUsn}`
      Object.assign(normalized, { temp_usn: tempUsn, official_usn: officialUsn })
    } else if (entityType === 'STUDENT_STATUS') {
      const usn = (clean.usn || '').toUpperCase()
      const status = (clean.status || '').toUpperCase()
      const allowed = ['ACTIVE', 'DETAINED', 'DISCONTINUED', 'COMPLETED', 'TRANSFERRED', 'SUSPENDED']
      if (!usn) messages.push('Missing required usn.')
      if (!allowed.includes(status)) messages.push(`Invalid status '${status}'. Allowed: ${allowed.join(', ')}.`)
      const found = usn ? ctx.studentsByReg.get(usn) : undefined
      if (usn && !found) messages.push(`Student '${usn}' not found.`)
      sourceKey = usn || `ROW_${rowNumber}`
      Object.assign(normalized, { usn, status, student_id: found?.id })
    } else if (entityType === 'STUDENT_SPECIALIZATIONS') {
      const usn = (clean.usn || '').toUpperCase()
      const spec = (clean.specialization || '').toUpperCase() || 'GENERAL'
      if (!usn) messages.push('Missing required usn.')
      const found = usn ? ctx.studentsByReg.get(usn) : undefined
      if (usn && !found) messages.push(`Student '${usn}' not found.`)
      sourceKey = usn || `ROW_${rowNumber}`
      Object.assign(normalized, { usn, specialization: spec, student_id: found?.id })
    }

    let status: 'VALID' | 'DUPLICATE' | 'ERROR' = 'VALID'
    if (messages.length > 0) {
      status = 'ERROR'
    } else if (seenKeysInCsv.has(sourceKey)) {
      status = 'DUPLICATE'
      messages.push(`Duplicate key '${sourceKey}' repeated inside the uploaded CSV.`)
    } else if (existingTargetId) {
      status = 'DUPLICATE'
      messages.push(`Record '${sourceKey}' already exists in the database (Skipped in Safe Mode; Updated in Overwrite Mode).`)
    }

    if (sourceKey) seenKeysInCsv.add(sourceKey)

    return {
      rowNumber,
      sourceKey,
      rawPayload: clean,
      normalizedPayload: normalized,
      status,
      messages,
      existingTargetId,
    }
  })
}

async function applySingleNormalizedRow(
  institutionId: string,
  entityType: MigrationEntityType,
  mode: ImportMode,
  row: StagedPreviewRow,
  ctx: InstitutionLookupContext
): Promise<{ outcome: 'IMPORTED' | 'SKIPPED'; targetTable: string; targetId: string }> {
  const n = row.normalizedPayload

  if (entityType === 'PROGRAMS') {
    const code = String(n.code)
    const existing = ctx.programsByCode.get(code)
    if (existing && mode === 'SAFE') {
      return { outcome: 'SKIPPED', targetTable: 'programs', targetId: existing.id }
    }

    let unitId: string | null = null
    if (n.dept_code) {
      const deptCode = String(n.dept_code)
      const existingUnit = ctx.unitsByCode.get(deptCode)
      if (existingUnit) {
        unitId = existingUnit.id
      } else {
        const { data: uData } = await supabase
          .from('academic_units')
          .insert({
            institution_id: institutionId,
            code: deptCode,
            name: deptCode,
            unit_type: 'DEPARTMENT',
          })
          .select('id, code')
          .single()
        if (uData) {
          unitId = uData.id
          ctx.unitsByCode.set(deptCode, { id: uData.id, code: deptCode })
        }
      }
    }

    const payload = {
      institution_id: institutionId,
      academic_unit_id: unitId,
      code,
      name: String(n.name),
      program_level: String(n.program_level),
      qualification: String(n.qualification),
      duration_years: Number(n.duration_years),
    }

    if (existing) {
      const { error } = await supabase.from('programs').update(payload).eq('id', existing.id)
      if (error) throw error
      return { outcome: 'IMPORTED', targetTable: 'programs', targetId: existing.id }
    }

    const { data: created, error } = await supabase.from('programs').insert(payload).select('id').single()
    if (error) throw error
    ctx.programsByCode.set(code, { id: created.id, code, name: String(n.name) })

    await supabase
      .from('program_specializations')
      .upsert(
        {
          institution_id: institutionId,
          program_id: created.id,
          code: 'GENERAL',
          name: 'General Track',
          is_default: true,
        },
        { onConflict: 'program_id,code' }
      )

    return { outcome: 'IMPORTED', targetTable: 'programs', targetId: created.id }
  }

  if (entityType === 'COURSE_CATALOG') {
    const courseCode = String(n.course_code)
    const existing = ctx.coursesByCode.get(courseCode)
    if (existing && mode === 'SAFE') {
      return { outcome: 'SKIPPED', targetTable: 'course_catalog', targetId: existing.id }
    }

    const catCode = String(n.course_type || 'CORE')
    const cat = ctx.categoriesByCode.get(catCode)
    let offeringUnitId: string | null = null
    if (n.offering_department) {
      const offCode = String(n.offering_department)
      const u = ctx.unitsByCode.get(offCode)
      if (u) {
        offeringUnitId = u.id
      } else {
        const { data: createdUnit } = await supabase
          .from('academic_units')
          .insert({
            institution_id: institutionId,
            code: offCode,
            name: offCode,
            unit_type: 'DEPARTMENT',
          })
          .select('id')
          .single()
        if (createdUnit) {
          offeringUnitId = createdUnit.id
          ctx.unitsByCode.set(offCode, { id: createdUnit.id, code: offCode })
        }
      }
    }

    let courseId: string
    const catalogPayload = {
      institution_id: institutionId,
      offering_academic_unit_id: offeringUnitId,
      course_category_id: cat?.id ?? null,
      course_code: courseCode,
      title: String(n.title),
      default_credits: Number(n.credits ?? 3),
    }

    if (existing) {
      const { error } = await supabase.from('course_catalog').update(catalogPayload).eq('id', existing.id)
      if (error) throw error
      courseId = existing.id
    } else {
      const { data: created, error } = await supabase
        .from('course_catalog')
        .insert(catalogPayload)
        .select('id')
        .single()
      if (error) throw error
      courseId = created.id
      ctx.coursesByCode.set(courseCode, { id: courseId, course_code: courseCode })
    }

    const branchCodes = (n.branch_codes as string[]) ?? []
    const semId = n.semester_id ? Number(n.semester_id) : null
    const period = semId ? ctx.periodsBySeq.get(semId) : undefined

    if (branchCodes.length > 0 && period && ctx.defaultPeriodTypeId) {
      const schemeBatch = Number(n.scheme_batch ?? 25)
      const specCode = String(n.specialization || 'GENERAL')

      for (const bCode of branchCodes) {
        const prog = ctx.programsByCode.get(bCode)
        if (!prog) continue

        const curCode = `${prog.code}_${schemeBatch}`
        const { data: curRow } = await supabase
          .from('curricula')
          .upsert(
            {
              institution_id: institutionId,
              program_id: prog.id,
              period_type_id: ctx.defaultPeriodTypeId,
              code: curCode,
              name: `${prog.code} ${schemeBatch} Scheme`,
              scheme_batch: schemeBatch,
              version_number: 1,
            },
            { onConflict: 'institution_id,code,version_number' }
          )
          .select('id')
          .single()

        if (!curRow) continue

        let specId: string | null = null
        if (specCode && specCode !== 'GENERAL') {
          const { data: specRow } = await supabase
            .from('program_specializations')
            .upsert(
              {
                institution_id: institutionId,
                program_id: prog.id,
                code: specCode,
                name: specCode,
              },
              { onConflict: 'program_id,code' }
            )
            .select('id')
            .single()
          specId = specRow?.id ?? null
        }

        let existingMapQuery = supabase
          .from('curriculum_courses')
          .select('id')
          .eq('curriculum_id', curRow.id)
          .eq('course_id', courseId)
          .eq('academic_period_id', period.id)
        existingMapQuery = specId
          ? existingMapQuery.eq('program_specialization_id', specId)
          : existingMapQuery.is('program_specialization_id', null)
        const { data: existingMap } = await existingMapQuery.maybeSingle()

        const ccPayload = {
          institution_id: institutionId,
          curriculum_id: curRow.id,
          course_id: courseId,
          academic_period_id: period.id,
          program_specialization_id: specId,
          course_category_id: cat?.id ?? null,
          credits: Number(n.credits ?? 3),
          max_internal_marks: Number(n.max_cie ?? 50),
          max_external_marks: Number(n.max_see ?? 50),
          total_marks: Number(n.total_marks ?? 100),
          is_elective: cat?.is_elective ?? false,
          is_lab: catCode === 'LAB',
        }

        if (existingMap) {
          await supabase.from('curriculum_courses').update(ccPayload).eq('id', existingMap.id)
        } else {
          await supabase.from('curriculum_courses').insert(ccPayload)
        }
      }
    }

    return { outcome: 'IMPORTED', targetTable: 'course_catalog', targetId: courseId }
  }

  if (entityType === 'STAFF') {
    const empCode = String(n.employee_code)
    const existing = ctx.staffByCode.get(empCode)
    if (existing && mode === 'SAFE') {
      return { outcome: 'SKIPPED', targetTable: 'staff_profiles', targetId: existing.id }
    }

    const payload = {
      institution_id: institutionId,
      employee_code: empCode,
      full_name: String(n.full_name),
      designation: String(n.designation),
      department_label: (n.department_label as string | null) ?? null,
      branch_label: (n.branch_label as string | null) ?? null,
      email: (n.email as string | null) ?? null,
      is_evaluator: Boolean(n.is_evaluator),
    }

    if (existing) {
      const { error } = await supabase.from('staff_profiles').update(payload).eq('id', existing.id)
      if (error) throw error
      return { outcome: 'IMPORTED', targetTable: 'staff_profiles', targetId: existing.id }
    }

    const { data: created, error } = await supabase
      .from('staff_profiles')
      .insert(payload)
      .select('id')
      .single()
    if (error) throw error
    ctx.staffByCode.set(empCode, { id: created.id, employee_code: empCode })
    return { outcome: 'IMPORTED', targetTable: 'staff_profiles', targetId: created.id }
  }

  if (entityType === 'STUDENTS') {
    const regNo = String(n.registration_number)
    const existing = ctx.studentsByReg.get(regNo)
    if (existing && mode === 'SAFE') {
      return { outcome: 'SKIPPED', targetTable: 'students', targetId: existing.id }
    }

    const studentPayload = {
      institution_id: institutionId,
      registration_number: regNo,
      is_temporary_registration: Boolean(n.is_temporary_registration),
      full_name: String(n.full_name),
      email: (n.email as string | null) ?? null,
      phone: (n.phone as string | null) ?? null,
      dob: (n.dob as string | null) ?? null,
    }

    let studentId: string
    if (existing) {
      const { error } = await supabase.from('students').update(studentPayload).eq('id', existing.id)
      if (error) throw error
      studentId = existing.id
    } else {
      const { data: created, error } = await supabase
        .from('students')
        .insert(studentPayload)
        .select('id')
        .single()
      if (error) throw error
      studentId = created.id
      ctx.studentsByReg.set(regNo, { id: studentId, registration_number: regNo, full_name: String(n.full_name) })
    }

    const prog = ctx.programsByCode.get(String(n.branch_code))
    if (prog) {
      const period = n.current_sem ? ctx.periodsBySeq.get(Number(n.current_sem)) : undefined
      const schemeBatch = Number(n.scheme_batch ?? 25)
      const batchCode = `${prog.code}-${2000 + schemeBatch}`

      const { data: batchRow } = await supabase
        .from('academic_batches')
        .upsert(
          {
            institution_id: institutionId,
            program_id: prog.id,
            code: batchCode,
            name: `${prog.code} ${2000 + schemeBatch} Batch`,
            admission_year: 2000 + schemeBatch,
            scheme_batch: schemeBatch,
          },
          { onConflict: 'institution_id,program_id,code' }
        )
        .select('id')
        .single()

      let sectionId: string | null = null
      if (n.section && period) {
        const { data: secRow } = await supabase
          .from('academic_sections')
          .upsert(
            {
              institution_id: institutionId,
              program_id: prog.id,
              academic_batch_id: batchRow?.id ?? null,
              academic_period_id: period.id,
              academic_year: ctx.activeAcademicYear,
              section_name: String(n.section),
            },
            { onConflict: 'institution_id,academic_year,program_id,academic_period_id,section_name' }
          )
          .select('id')
          .single()
        sectionId = secRow?.id ?? null
      }

      const specCode = String(n.specialization || 'GENERAL')
      const { data: specRow } = await supabase
        .from('program_specializations')
        .upsert(
          {
            institution_id: institutionId,
            program_id: prog.id,
            code: specCode,
            name: specCode === 'GENERAL' ? 'General Track' : specCode,
            is_default: specCode === 'GENERAL',
          },
          { onConflict: 'program_id,code' }
        )
        .select('id')
        .single()

      const { data: existingEnroll } = await supabase
        .from('student_enrollments')
        .select('id')
        .eq('student_id', studentId)
        .eq('program_id', prog.id)
        .eq('is_current', true)
        .maybeSingle()

      const enrollPayload = {
        institution_id: institutionId,
        student_id: studentId,
        program_id: prog.id,
        program_specialization_id: specRow?.id ?? null,
        academic_batch_id: batchRow?.id ?? null,
        current_period_id: period?.id ?? null,
        academic_section_id: sectionId,
        student_category: String(n.student_category || 'REGULAR'),
        is_current: true,
      }

      if (existingEnroll) {
        const { error } = await supabase
          .from('student_enrollments')
          .update(enrollPayload)
          .eq('id', existingEnroll.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('student_enrollments').insert(enrollPayload)
        if (error) throw error
      }
    }

    return { outcome: 'IMPORTED', targetTable: 'students', targetId: studentId }
  }

  if (entityType === 'STUDENT_USN_MIGRATION') {
    const { data: updatedStudentId, error } = await supabase.rpc('migrate_student_registration_number', {
      p_institution_id: institutionId,
      p_temp_reg_no: String(n.temp_usn),
      p_official_reg_no: String(n.official_usn),
    })
    if (error) throw error
    return { outcome: 'IMPORTED', targetTable: 'students', targetId: String(updatedStudentId) }
  }

  if (entityType === 'STUDENT_STATUS') {
    const studentId = String(n.student_id)
    const { error } = await supabase
      .from('student_enrollments')
      .update({ enrollment_status: String(n.status) })
      .eq('institution_id', institutionId)
      .eq('student_id', studentId)
      .eq('is_current', true)
    if (error) throw error
    return { outcome: 'IMPORTED', targetTable: 'student_enrollments', targetId: studentId }
  }

  if (entityType === 'STUDENT_SPECIALIZATIONS') {
    const studentId = String(n.student_id)
    const specCode = String(n.specialization || 'GENERAL')
    const { data: enroll, error: eErr } = await supabase
      .from('student_enrollments')
      .select('id, program_id')
      .eq('institution_id', institutionId)
      .eq('student_id', studentId)
      .eq('is_current', true)
      .maybeSingle()
    if (eErr || !enroll) throw new Error(`Active enrollment not found for student ${String(n.usn)}`)

    const { data: specRow, error: sErr } = await supabase
      .from('program_specializations')
      .upsert(
        {
          institution_id: institutionId,
          program_id: enroll.program_id,
          code: specCode,
          name: specCode,
        },
        { onConflict: 'program_id,code' }
      )
      .select('id')
      .single()
    if (sErr) throw sErr

    const { error: uErr } = await supabase
      .from('student_enrollments')
      .update({ program_specialization_id: specRow.id })
      .eq('id', enroll.id)
    if (uErr) throw uErr
    return { outcome: 'IMPORTED', targetTable: 'student_enrollments', targetId: enroll.id }
  }

  throw new Error(`Unsupported entity type: ${entityType}`)
}

export async function commitMigrationJob(params: {
  institutionId: string
  entityType: MigrationEntityType
  importMode: ImportMode
  fileName: string
  stagedRows: StagedPreviewRow[]
  actorUserId: string | null
  onProgress?: (done: number, total: number) => void
}) {
  const { institutionId, entityType, importMode, fileName, stagedRows, actorUserId, onProgress } = params
  const sourceId = await ensureCsvMigrationSource(institutionId)
  const ctx = await loadLookupContext(institutionId)

  const validCount = stagedRows.filter(
    (r) => r.status === 'VALID' || (r.status === 'DUPLICATE' && importMode === 'OVERWRITE' && r.existingTargetId)
  ).length

  const { data: job, error: jobErr } = await supabase
    .from('migration_jobs')
    .insert({
      institution_id: institutionId,
      source_id: sourceId,
      entity_type: entityType,
      import_mode: importMode,
      status: 'IMPORTING',
      file_name: fileName,
      total_rows: stagedRows.length,
      valid_rows: validCount,
      started_at: new Date().toISOString(),
      created_by: actorUserId,
    })
    .select('id')
    .single()
  if (jobErr) throw jobErr

  const jobId = job.id as string

  await supabase.from('migration_audit_log').insert({
    institution_id: institutionId,
    job_id: jobId,
    action: 'JOB_STARTED',
    actor_user_id: actorUserId,
    details: { entity_type: entityType, import_mode: importMode, file_name: fileName, total_rows: stagedRows.length },
  })

  if (entityType === 'STUDENTS') {
    let importedRows = 0
    let skippedRows = 0
    let errorRows = 0
    const chunkSize = 100
    for (let i = 0; i < stagedRows.length; i += chunkSize) {
      const slice = stagedRows.slice(i, i + chunkSize).map((r) => ({
        row_number: r.rowNumber,
        source_key: r.sourceKey,
        status: r.status,
        messages: r.messages,
        existing_target_id: r.existingTargetId ?? null,
        raw_payload: r.rawPayload,
        normalized_payload: r.normalizedPayload,
      }))
      const { data: chunkRes, error: rpcErr } = await supabase.rpc('bulk_import_students_chunk', {
        p_institution_id: institutionId,
        p_job_id: jobId,
        p_source_id: sourceId,
        p_import_mode: importMode,
        p_rows: slice,
      })
      if (rpcErr) throw rpcErr
      const stats = (chunkRes ?? {}) as { imported?: number; skipped?: number; errors?: number }
      importedRows += stats.imported ?? 0
      skippedRows += stats.skipped ?? 0
      errorRows += stats.errors ?? 0
      onProgress?.(Math.min(i + chunkSize, stagedRows.length), stagedRows.length)
    }

    const finalStatus =
      errorRows === 0
        ? 'COMPLETED'
        : importedRows > 0 || skippedRows > 0
          ? 'COMPLETED_WITH_ERRORS'
          : 'FAILED'

    await supabase
      .from('migration_jobs')
      .update({
        status: finalStatus,
        imported_rows: importedRows,
        skipped_rows: skippedRows,
        error_rows: errorRows,
        completed_at: new Date().toISOString(),
        summary: { importedRows, skippedRows, errorRows, totalRows: stagedRows.length },
      })
      .eq('id', jobId)

    await supabase.from('migration_audit_log').insert({
      institution_id: institutionId,
      job_id: jobId,
      action: 'JOB_FINISHED',
      actor_user_id: actorUserId,
      details: { status: finalStatus, importedRows, skippedRows, errorRows, bulkRpc: true },
    })

    return { jobId, status: finalStatus, importedRows, skippedRows, errorRows }
  }

  const stagingIdByRow = new Map<number, string>()
  for (let i = 0; i < stagedRows.length; i += 200) {
    const chunk = stagedRows.slice(i, i + 200).map((r) => ({
      institution_id: institutionId,
      job_id: jobId,
      row_number: r.rowNumber,
      source_key: r.sourceKey,
      raw_payload: r.rawPayload,
      normalized_payload: r.normalizedPayload,
      validation_status: r.status,
      validation_messages: r.messages,
    }))
    const { data: insertedStaging } = await supabase
      .from('migration_staging_rows')
      .insert(chunk)
      .select('id, row_number')
    for (const s of insertedStaging ?? []) {
      stagingIdByRow.set(s.row_number as number, s.id as string)
    }
  }

  let importedRows = 0
  let skippedRows = 0
  let errorRows = 0

  for (let i = 0; i < stagedRows.length; i++) {
    const row = stagedRows[i]
    const stagingRowId = stagingIdByRow.get(row.rowNumber) ?? null

    if (row.status === 'ERROR') {
      errorRows += 1
      await supabase.from('migration_errors').insert({
        institution_id: institutionId,
        job_id: jobId,
        staging_row_id: stagingRowId,
        row_number: row.rowNumber,
        error_code: 'VALIDATION_ERROR',
        error_message: row.messages.join(' '),
        raw_payload: row.rawPayload,
        resolution_status: 'OPEN',
      })
      onProgress?.(i + 1, stagedRows.length)
      continue
    }

    if (row.status === 'DUPLICATE' && (!row.existingTargetId || importMode === 'SAFE')) {
      skippedRows += 1
      if (stagingRowId) {
        await supabase
          .from('migration_staging_rows')
          .update({ validation_status: 'SKIPPED', target_record_id: row.existingTargetId ?? null })
          .eq('id', stagingRowId)
      }
      onProgress?.(i + 1, stagedRows.length)
      continue
    }

    try {
      const res = await applySingleNormalizedRow(institutionId, entityType, importMode, row, ctx)
      if (res.outcome === 'IMPORTED') {
        importedRows += 1
        if (stagingRowId) {
          await supabase
            .from('migration_staging_rows')
            .update({ validation_status: 'IMPORTED', target_record_id: res.targetId })
            .eq('id', stagingRowId)
        }
        await supabase.from('migration_mappings').upsert(
          {
            institution_id: institutionId,
            source_id: sourceId,
            entity_type: entityType,
            source_key: row.sourceKey,
            target_table: res.targetTable,
            target_id: res.targetId,
            last_job_id: jobId,
          },
          { onConflict: 'institution_id,source_id,entity_type,source_key' }
        )
      } else {
        skippedRows += 1
        if (stagingRowId) {
          await supabase
            .from('migration_staging_rows')
            .update({ validation_status: 'SKIPPED', target_record_id: res.targetId })
            .eq('id', stagingRowId)
        }
      }
    } catch (err) {
      errorRows += 1
      const errMessage = err instanceof Error ? err.message : 'Database import failed'
      if (stagingRowId) {
        await supabase
          .from('migration_staging_rows')
          .update({ validation_status: 'ERROR', validation_messages: [errMessage] })
          .eq('id', stagingRowId)
      }
      await supabase.from('migration_errors').insert({
        institution_id: institutionId,
        job_id: jobId,
        staging_row_id: stagingRowId,
        row_number: row.rowNumber,
        error_code: 'COMMIT_ERROR',
        error_message: errMessage,
        raw_payload: row.rawPayload,
        resolution_status: 'OPEN',
      })
    }

    onProgress?.(i + 1, stagedRows.length)
  }

  const finalStatus =
    errorRows === 0
      ? 'COMPLETED'
      : importedRows > 0 || skippedRows > 0
        ? 'COMPLETED_WITH_ERRORS'
        : 'FAILED'

  await supabase
    .from('migration_jobs')
    .update({
      status: finalStatus,
      imported_rows: importedRows,
      skipped_rows: skippedRows,
      error_rows: errorRows,
      completed_at: new Date().toISOString(),
      summary: { importedRows, skippedRows, errorRows, totalRows: stagedRows.length },
    })
    .eq('id', jobId)

  await supabase.from('migration_audit_log').insert({
    institution_id: institutionId,
    job_id: jobId,
    action: 'JOB_FINISHED',
    actor_user_id: actorUserId,
    details: { status: finalStatus, importedRows, skippedRows, errorRows },
  })

  return { jobId, status: finalStatus, importedRows, skippedRows, errorRows }
}

export async function reprocessMigrationErrorRow(params: {
  institutionId: string
  errorId: string
  jobId: string
  entityType: MigrationEntityType
  importMode: ImportMode
  correctedPayload: Record<string, unknown>
  actorUserId: string | null
}) {
  const { institutionId, errorId, jobId, entityType, importMode, correctedPayload, actorUserId } = params
  const validated = await validateCsvRows(institutionId, entityType, [correctedPayload])
  const row = validated[0]
  if (!row) throw new Error('Unable to parse corrected payload.')
  if (row.status === 'ERROR') {
    throw new Error(row.messages.join(' '))
  }

  const ctx = await loadLookupContext(institutionId)
  const res = await applySingleNormalizedRow(institutionId, entityType, importMode, row, ctx)

  const sourceId = await ensureCsvMigrationSource(institutionId)
  await supabase.from('migration_mappings').upsert(
    {
      institution_id: institutionId,
      source_id: sourceId,
      entity_type: entityType,
      source_key: row.sourceKey,
      target_table: res.targetTable,
      target_id: res.targetId,
      last_job_id: jobId,
    },
    { onConflict: 'institution_id,source_id,entity_type,source_key' }
  )

  await supabase
    .from('migration_errors')
    .update({
      raw_payload: correctedPayload,
      resolution_status: 'REPROCESSED',
      resolved_by: actorUserId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', errorId)

  await supabase.from('migration_audit_log').insert({
    institution_id: institutionId,
    job_id: jobId,
    action: 'ERROR_REPROCESSED',
    actor_user_id: actorUserId,
    details: { errorId, sourceKey: row.sourceKey, targetId: res.targetId },
  })

  return res
}
