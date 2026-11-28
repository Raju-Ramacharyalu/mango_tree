import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderWatermarkHtml,
  signStudentPhotosWithFallback,
} from '@/modules/exams/printBranding'

export interface PrintableRegStudent {
  id: string
  registration_number: string
  admission_number?: string | null
  full_name: string
  program_code: string
  program_level?: string | null
  specialization_code?: string | null
  current_sem: number
  scheme_batch?: number | null
  photo_url?: string | null
  photo_pin?: string | null
}

export interface PrintableRegCourse {
  course_code: string
  course_title: string
  credits: number
  course_type?: string | null
}

function sortByCourseSeq(courses: PrintableRegCourse[]): PrintableRegCourse[] {
  const seq = (code: string) => {
    const m = code.match(/\d{3}/)
    return m ? Number(m[0]) : 999
  }
  return [...courses].sort((a, b) => seq(a.course_code) - seq(b.course_code) || a.course_code.localeCompare(b.course_code))
}

function formatBranchWithSpec(code: string, spec?: string | null): string {
  const cleanSpec = String(spec ?? 'GENERAL').trim().toUpperCase()
  if (!cleanSpec || ['GENERAL', 'NONE', 'NAN', 'NULL'].includes(cleanSpec)) return code
  return `${code} (${cleanSpec})`
}

/**
 * Prints official AMCEC Course Registration Copy (single student or multi-page bulk class batch)
 * matching brs (14).py: Logos, Watermark, Student Details + Photo / Photo Booth PIN, Sorted Courses,
 * Total Credits, 4 Student Undertaking Checkboxes, Declaration, Date, and Student Signature.
 */
export async function printOfficialCourseRegistrationForms(params: {
  institutionId: string
  institutionName?: string
  academicYear: string
  term: string
  items: Array<{ student: PrintableRegStudent; courses: PrintableRegCourse[] }>
  documentTitle?: string
}): Promise<void> {
  const { institutionId, institutionName, academicYear, term, items, documentTitle } = params
  if (items.length === 0) return

  const branding = await fetchInstitutionBranding(institutionId, institutionName)
  const photoMap = await signStudentPhotosWithFallback(
    institutionId,
    items.map(({ student }) => ({
      key: student.id,
      photo_url: student.photo_url ?? null,
      registration_number: student.registration_number,
      admission_number: student.admission_number ?? null,
    }))
  )

  const todayStr = new Date().toLocaleDateString('en-IN')

  const pagesHtml = items
    .map(({ student, courses }) => {
      const sorted = sortByCourseSeq(courses)
      const totalCredits = sorted.reduce((s, c) => s + Number(c.credits || 0), 0)
      const photoSrc = photoMap.get(student.id) ?? null
      const displayId = student.registration_number || student.admission_number || '—'
      const branchDisp = formatBranchWithSpec(student.program_code, student.specialization_code)
      const levelDisp = student.program_level || 'UG'

      const photoBlock = photoSrc
        ? `<img src="${escapeHtml(photoSrc)}" style="width:74px;height:94px;object-fit:cover;border:1px solid #475569;display:block;margin:0 auto" alt="Photo" />`
        : `<div style="border:1px dashed #64748b;padding:6px;font-size:8.5px;text-align:center;color:#334155;line-height:1.35">
             <strong>Photo Pending</strong><br/>
             Upload at Photo Booth<br/>
             ID: <strong>${escapeHtml(displayId)}</strong><br/>
             PIN: <strong>${escapeHtml(student.photo_pin || 'Ask Office')}</strong><br/>
             <em>or Affix Physical Photo</em>
           </div>`

      const courseRows = sorted
        .map(
          (c) => `<tr>
            <td style="font-family:monospace;font-weight:700;text-align:center">${escapeHtml(c.course_code)}</td>
            <td>${escapeHtml(c.course_title)}${c.course_type && c.course_type !== 'CORE' ? ` <span style="font-size:9px;color:#475569">(${escapeHtml(c.course_type)})</span>` : ''}</td>
            <td style="text-align:center">${Number.isInteger(c.credits) ? c.credits : c.credits.toFixed(1)}</td>
            <td style="text-align:center;font-weight:600">Yes</td>
          </tr>`
        )
        .join('')

      return `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="border:1.5px solid #1e293b;padding:14px">
          ${renderBrandedHeaderHtml(
            branding,
            `Course Registration — ${term.toUpperCase()} Semester ${academicYear}`,
            student.scheme_batch ? `Scheme: ${student.scheme_batch} Scheme · Student Copy / Office Record` : 'Student Copy / Office Record'
          )}

          <p style="font-weight:700;margin:6px 0 4px;font-size:10.5px">Student Details</p>
          <table>
            <thead>
              <tr>
                <th style="width:105px;text-align:center">USN / Admin No.</th>
                <th style="text-align:center">Student Name</th>
                <th style="width:88px;text-align:center">Branch</th>
                <th style="width:42px;text-align:center">Type</th>
                <th style="width:38px;text-align:center">Sem</th>
                <th style="width:118px;text-align:center">Student Photo</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-family:monospace;font-weight:700;text-align:center">${escapeHtml(displayId)}</td>
                <td style="text-align:center"><strong>${escapeHtml(student.full_name)}</strong></td>
                <td style="text-align:center">${escapeHtml(branchDisp)}</td>
                <td style="text-align:center">${escapeHtml(levelDisp)}</td>
                <td style="text-align:center">${student.current_sem}</td>
                <td style="text-align:center;padding:5px">${photoBlock}</td>
              </tr>
            </tbody>
          </table>

          <p style="font-weight:700;margin:10px 0 4px;font-size:10.5px">Courses Offered &amp; Registered</p>
          <table>
            <thead>
              <tr>
                <th style="width:115px;text-align:center">Course Code</th>
                <th>Course Title</th>
                <th style="width:55px;text-align:center">Credits</th>
                <th style="width:55px;text-align:center">Select</th>
              </tr>
            </thead>
            <tbody>
              ${courseRows}
              <tr style="background:#f8fafc;font-weight:700">
                <td></td>
                <td style="text-align:right">Total Credits</td>
                <td style="text-align:center">${Number.isInteger(totalCredits) ? totalCredits : totalCredits.toFixed(1)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div style="margin-top:12px;font-size:9.8px;line-height:1.55">
            <p style="font-weight:700;margin:0 0 5px">STUDENT UNDERTAKING:</p>
            <div style="margin-left:2px">
              <div>&#9744; I will strictly follow the AMCEC / VTU autonomy guidelines.</div>
              <div>&#9744; I have paid the full tuition fees and examination fees for the current semester.</div>
              <div>&#9744; I am aware that I must maintain a minimum of 85% attendance to appear for SEE.</div>
              <div>&#9744; I have verified that my selected credits align with the academic regulations.</div>
            </div>
          </div>

          <div style="margin-top:10px;font-size:9.5px;color:#1e293b">
            <p style="font-weight:700;margin:0 0 3px">DECLARATION:</p>
            <p style="margin:0;line-height:1.45">
              I hereby declare that the information provided is true to the best of my knowledge. I have carefully
              selected the courses listed above and I request to be registered for the same in the current semester.
            </p>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:42px;font-size:10.5px;font-weight:700">
            <span>Date: ${escapeHtml(todayStr)}</span>
            <div style="text-align:center;min-width:170px">
              <div style="border-top:1px solid #1e293b;margin-bottom:4px"></div>
              <span>Signature of the Student</span>
            </div>
          </div>
        </div>
      </section>`
    })
    .join('')

  openBrandedPrintWindow({
    title:
      documentTitle ||
      (items.length === 1
        ? `Course_Registration_${items[0].student.registration_number}_${academicYear}_${term}`
        : `Bulk_Course_Registrations_${academicYear}_${term}_${items.length}`),
    landscape: false,
    branding,
    watermarkMode: 'per-page',
    bodyHtml: pagesHtml,
  })
}
