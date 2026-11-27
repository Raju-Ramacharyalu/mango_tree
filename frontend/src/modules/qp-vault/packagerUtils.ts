import JSZip from 'jszip'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import Papa from 'papaparse'
import type { BoeNominationRow } from '@/types/qpVault'
import type { ExamCycle } from '@/types/exams'

export type PackagerRowContext = Record<string, string>

export interface SyllabusEntry {
  name: string
  bytes: Uint8Array
}

export interface SyllabusIndex {
  exactMap: Map<string, SyllabusEntry>
  normMap: Map<string, SyllabusEntry>
  prefixList: Array<{ normKey: string; entry: SyllabusEntry }>
  count: number
}

export interface DispatchManifestRow {
  Sl_No: number
  Setter_Name: string
  Email: string
  Course_Code: string
  Course_Title: string
  Department: string
  College: string
  Ref_No: string
  Syllabus_Attached: string
  Zip_Filename: string
  Dispatch_Status: string
  Dispatch_Log: string
}

export function sanitizeFilename(value: string): string {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/[\s_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'Unnamed'
}

export function makeUniqueZipName(baseName: string, usedNamesLower: Set<string>): string {
  let candidate = `${baseName}.zip`
  let counter = 2
  while (usedNamesLower.has(candidate.toLowerCase())) {
    candidate = `${baseName}_${counter}.zip`
    counter += 1
  }
  usedNamesLower.add(candidate.toLowerCase())
  return candidate
}

export function normalizeCode(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function splitSubjectCodes(rawValue: string): string[] {
  return String(rawValue || '')
    .trim()
    .split(/[,;/\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function formatSyllabusFilename(originalName: string): string {
  return originalName.toLowerCase().startsWith('syllabus')
    ? originalName
    : `Syllabus_${originalName}`
}

export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function uint8ToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy], { type: mimeType })
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Decodes CSV with UTF-8 strict check falling back to Windows-1252,
 * matching ledger_utility.py's multi-encoding CSV loader.
 */
export async function parseMailMergeCsvFile(
  file: File
): Promise<{ headers: string[]; rows: PackagerRowContext[] }> {
  const buf = await file.arrayBuffer()
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    text = new TextDecoder('windows-1252').decode(buf)
  }
  if (text.startsWith('data:text/csv') && text.includes(',')) {
    text = text.slice(text.indexOf(',') + 1)
  }
  text = text.replace(/^\uFEFF/, '')

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  const rawHeaders = (parsed.meta.fields ?? []).map((h) => h.trim().replace(/^\uFEFF/, ''))
  const normalizedHeaders = rawHeaders.map((h) => h.replace(/\s+/g, '_'))
  const rows = parsed.data.map((row, idx) => buildNormalizedContext(row, idx))
  return { headers: normalizedHeaders, rows }
}

/**
 * Normalizes a raw CSV record with smart case-insensitive field bridging
 * for Appointment Orders, QP Formats, and Envelope Address Labels.
 */
export function buildNormalizedContext(
  rawRow: Record<string, string>,
  index: number
): PackagerRowContext {
  const ctx: PackagerRowContext = {}
  for (const [k, v] of Object.entries(rawRow)) {
    const cleanKey = String(k).trim().replace(/^\uFEFF/, '').replace(/\s+/g, '_')
    ctx[cleanKey] = String(v ?? '').trim()
  }

  const lowerMap = new Map<string, string>()
  for (const [k, v] of Object.entries(ctx)) {
    if (v) lowerMap.set(k.toLowerCase(), v)
  }

  const pickFirst = (keys: string[], fallback = ''): string => {
    for (const k of keys) {
      if (ctx[k]) return ctx[k]
      const hit = lowerMap.get(k.toLowerCase())
      if (hit) return hit
    }
    return fallback
  }

  ctx.Setter_Name = pickFirst(
    ['Setter_Name', 'Name', 'Faculty_Name', 'Examiner_Name'],
    `Setter_${index + 1}`
  )
  ctx.Name = ctx.Setter_Name
  ctx.Email = pickFirst(['Email', 'Email_ID', 'Mail', 'Setter_Email'])
  ctx.Course_Code = pickFirst(['Course_Code', 'Course', 'Sub_Code', 'Subject_Code'])
  ctx.Course_Title = pickFirst(['Course_Title', 'Course_Name', 'Subject_Name', 'Subject'])
  ctx.Course_Name = ctx.Course_Title
  ctx.Academic_Year = pickFirst(['Academic_Year', 'AY'])
  ctx.AY = ctx.Academic_Year
  if (ctx.ODD_EVEN) {
    ctx.Odd_Even = ctx.ODD_EVEN
    ctx.Semester_Type = ctx.ODD_EVEN
  }
  ctx.Designation = pickFirst(['Designation', 'Role', 'Post'])
  ctx.Department = pickFirst(['Department', 'Dept', 'Branch', 'Offering_Department'])
  ctx.College = pickFirst([
    'College',
    'College_Name',
    'Institute',
    'Institution',
    'Organization',
    'University',
  ])
  ctx.Address = pickFirst([
    'Address',
    'Postal_Address',
    'College_Address',
    'Communication_Address',
    'Residential_Address',
    'Street',
  ])
  ctx.City = pickFirst(['City', 'Place', 'Location', 'District'])
  ctx.Pincode = pickFirst(['Pincode', 'Pin', 'Pin_Code', 'Zip'])
  ctx.Phone = pickFirst(['Phone', 'Mobile', 'Mobile_No', 'Contact', 'Contact_No', 'Phone_No'])
  ctx.Ref_No = pickFirst(['Ref_No', 'Reference_No', 'Order_No'])

  return ctx
}

/**
 * Converts live approved BOE nominations from Supabase into PackagerRowContext records.
 */
export function buildContextsFromBoeNominations(
  nominations: BoeNominationRow[],
  courses: Array<{ id: string; course_code: string; title: string }>,
  cycle: ExamCycle | null
): PackagerRowContext[] {
  const courseTitleMap = new Map<string, string>()
  for (const c of courses) {
    courseTitleMap.set(c.course_code.trim().toUpperCase(), c.title)
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const approved = nominations.filter((n) => n.is_selected)

  return approved.map((n, idx) => {
    const courseTitle = courseTitleMap.get(n.course_code.trim().toUpperCase()) ?? n.course_code
    const portalLink = n.access_token ? `${origin}/setter-drafter?token=${n.access_token}` : ''
    const refNo = cycle?.code ? `${cycle.code}/BOE/${String(idx + 1).padStart(3, '0')}` : ''

    return buildNormalizedContext(
      {
        Setter_Name: n.setter_name,
        Email: n.email,
        Course_Code: n.course_code,
        Course_Title: courseTitle,
        Designation: n.designation,
        Department: n.department_name,
        College: n.college_name,
        Address: n.college_address,
        Phone: n.mobile,
        Faculty_Type: n.faculty_type,
        Academic_Year: cycle?.academic_year ?? '',
        Exam_Cycle: cycle?.name ?? '',
        ODD_EVEN: cycle?.cycle_type ?? '',
        Ref_No: refNo,
        Portal_Link: portalLink,
      },
      idx
    )
  })
}

/**
 * Indexes syllabus PDFs from individual PDF files, folder selection (webkitdirectory),
 * or uploaded .zip archives (ignoring macOS __MACOSX / ._* metadata files).
 */
export async function buildSyllabusIndexFromFiles(files: File[]): Promise<SyllabusIndex> {
  const exactMap = new Map<string, SyllabusEntry>()
  const normMap = new Map<string, SyllabusEntry>()
  const prefixList: Array<{ normKey: string; entry: SyllabusEntry }> = []

  const register = (filename: string, bytes: Uint8Array) => {
    const baseName = filename.split('/').pop() ?? filename
    if (!baseName || baseName.startsWith('._') || !baseName.toLowerCase().endsWith('.pdf')) return
    const stem = baseName.replace(/\.pdf$/i, '').trim()
    const entry: SyllabusEntry = { name: baseName, bytes }
    exactMap.set(stem.toLowerCase(), entry)
    const normKey = normalizeCode(stem)
    if (normKey) {
      normMap.set(normKey, entry)
      prefixList.push({ normKey, entry })
    }
  }

  for (const file of files) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.pdf')) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      register(file.name, bytes)
    } else if (lower.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer())
      const entries = Object.values(zip.files)
      for (const zf of entries) {
        if (zf.dir || zf.name.includes('__MACOSX')) continue
        const inner = zf.name.split('/').pop() ?? ''
        if (!inner || inner.startsWith('._') || !inner.toLowerCase().endsWith('.pdf')) continue
        const bytes = await zf.async('uint8array')
        register(inner, bytes)
      }
    }
  }

  return { exactMap, normMap, prefixList, count: exactMap.size }
}

export function findMatchingSyllabus(
  subjectCode: string,
  index: SyllabusIndex
): SyllabusEntry | null {
  const clean = String(subjectCode || '').trim()
  if (!clean) return null
  const exact = index.exactMap.get(clean.toLowerCase())
  if (exact) return exact
  const norm = normalizeCode(clean)
  if (!norm) return null
  const normHit = index.normMap.get(norm)
  if (normHit) return normHit
  for (const item of index.prefixList) {
    if (item.normKey.startsWith(norm)) return item.entry
  }
  return null
}

/**
 * Lightweight Jinja-compatible renderer supporting nested
 * {% if Field %}...{% endif %} blocks and {{ Field }} placeholders.
 */
export function renderAddressTemplate(templateStr: string, ctx: PackagerRowContext): string {
  let out = templateStr
  const innerIfRegex = /\{%\s*if\s+([A-Za-z0-9_]+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g
  const nonNestedIfRegex = /\{%\s*if\s+([A-Za-z0-9_]+)\s*%\}((?:(?!\{%\s*if\b)[\s\S])*?)\{%\s*endif\s*%\}/g

  for (let guard = 0; guard < 12; guard++) {
    if (!innerIfRegex.test(out)) break
    innerIfRegex.lastIndex = 0
    out = out.replace(nonNestedIfRegex, (_match, key: string, body: string) => {
      const val = ctx[key]?.trim()
      return val ? body : ''
    })
  }

  out = out.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => ctx[key] ?? '')
  return out
}

/**
 * Renders a .docx template in-browser using docxtemplater with {{ }} delimiters
 * so existing docxtpl Appointment Order and QP Format templates work directly.
 */
export function renderDocxTemplate(
  templateBytes: Uint8Array,
  context: PackagerRowContext
): Uint8Array {
  const zip = new PizZip(templateBytes)
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  })
  doc.render(context)
  return doc.getZip().generate({ type: 'uint8array' }) as Uint8Array
}

/**
 * Generates UTF-8-BOM CSV bytes formatted directly for Google Sheets +
 * COE Confidential Email Dispatch Google Apps Script.
 */
export function buildDispatchManifestCsv(rows: DispatchManifestRow[]): Uint8Array {
  const headers: Array<keyof DispatchManifestRow> = [
    'Sl_No',
    'Setter_Name',
    'Email',
    'Course_Code',
    'Course_Title',
    'Department',
    'College',
    'Ref_No',
    'Syllabus_Attached',
    'Zip_Filename',
    'Dispatch_Status',
    'Dispatch_Log',
  ]
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
  ]
  return new TextEncoder().encode('\uFEFF' + lines.join('\r\n'))
}

/**
 * Builds standalone printable A4 HTML for the 2-column dashed envelope cut-out grid.
 */
export function buildAddressLabelsHtml(
  contexts: PackagerRowContext[],
  toTemplateStr: string,
  fromText: string,
  headerBadge: string,
  boxesPerPage: 6 | 8 | 10
): string {
  const rowsPerPage = boxesPerPage / 2
  const boxHeightMm = Math.floor(273 / rowsPerPage)
  const fromLines = fromText
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const pagesHtml: string[] = []
  for (let start = 0; start < contexts.length; start += boxesPerPage) {
    const slice = contexts.slice(start, start + boxesPerPage)
    const cellsHtml = slice
      .map((ctx) => {
        const tagRight = ctx.Course_Code || ctx.Ref_No || ''
        const badgeLine =
          headerBadge.trim() && tagRight
            ? `${headerBadge.trim()} | [${tagRight}]`
            : headerBadge.trim() || (tagRight ? `[${tagRight}]` : '')

        const renderedTo = renderAddressTemplate(toTemplateStr, ctx)
        const toLines = renderedTo
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)

        const toBlock = toLines
          .map((line, i) =>
            i === 0 ? `<strong>${escapeHtml(line)}</strong>` : escapeHtml(line)
          )
          .join('<br/>')

        const fromBlock =
          fromLines.length > 0
            ? `<div class="from-box">${fromLines
                .map((l, i) => (i === 0 ? `<strong>${escapeHtml(l)}</strong>` : escapeHtml(l)))
                .join('<br/>')}</div>`
            : ''

        return `<div class="label-box">
          ${badgeLine ? `<div class="badge">&#9986; ${escapeHtml(badgeLine)}</div>` : ''}
          <div class="to-box"><strong>TO:</strong><br/>${toBlock}</div>
          ${fromBlock}
        </div>`
      })
      .join('')

    pagesHtml.push(`<section class="sheet">${cellsHtml}</section>`)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Envelope_Address_Labels</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; }
  .sheet {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3mm;
    page-break-after: always;
  }
  .sheet:last-child { page-break-after: auto; }
  .label-box {
    height: ${boxHeightMm}mm;
    border: 1.3px dashed #1e293b;
    padding: 4mm 5mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .badge { font-size: 8pt; font-weight: 700; color: #1e3a8a; margin-bottom: 2mm; }
  .to-box { font-size: 9.5pt; line-height: 1.35; flex: 1; }
  .from-box {
    border-top: 0.7px solid #94a3b8;
    padding-top: 1.5mm;
    margin-top: 2mm;
    font-size: 7.5pt;
    line-height: 1.25;
    color: #334155;
  }
</style>
</head>
<body>${pagesHtml.join('')}</body>
</html>`
}

/**
 * Generates a native A4 2-column Word (.docx) document with dashed scissor-cut
 * borders for envelope address boxes directly in the browser via JSZip.
 */
export async function generateAddressLabelsDocx(
  contexts: PackagerRowContext[],
  toTemplateStr: string,
  fromText: string,
  headerBadge: string,
  boxesPerPage: 6 | 8 | 10
): Promise<Uint8Array> {
  const rowsPerPage = boxesPerPage / 2
  const rowHeightTwips = Math.floor((10.5 * 1440) / rowsPerPage)
  const fromLines = fromText
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const makeParagraph = (
    runs: Array<{ text: string; bold?: boolean; sizeHalfPt: number; color?: string }>,
    spaceAfter = 40
  ) => {
    const runsXml = runs
      .map((r) => {
        const boldXml = r.bold ? '<w:b/>' : ''
        const colorXml = r.color ? `<w:color w:val="${r.color}"/>` : ''
        return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${boldXml}${colorXml}<w:sz w:val="${r.sizeHalfPt}"/></w:rPr><w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`
      })
      .join('')
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="${spaceAfter}" w:line="260" w:lineRule="auto"/></w:pPr>${runsXml}</w:p>`
  }

  const tablesXml: string[] = []
  for (let pageStart = 0; pageStart < contexts.length; pageStart += boxesPerPage) {
    const pageItems = contexts.slice(pageStart, pageStart + boxesPerPage)
    const numRows = Math.ceil(pageItems.length / 2)
    const rowsXml: string[] = []

    for (let r = 0; r < numRows; r++) {
      const cellsXml: string[] = []
      for (let c = 0; c < 2; c++) {
        const idx = r * 2 + c
        if (idx >= pageItems.length) {
          cellsXml.push(
            `<w:tc><w:tcPr><w:tcW w:w="5377" w:type="dxa"/></w:tcPr><w:p/></w:tc>`
          )
          continue
        }

        const ctx = pageItems[idx]
        const tagRight = ctx.Course_Code || ctx.Ref_No || ''
        const badgeLine =
          headerBadge.trim() && tagRight
            ? `${headerBadge.trim()}   |   [${tagRight}]`
            : headerBadge.trim() || (tagRight ? `[${tagRight}]` : '')

        const paragraphs: string[] = []
        if (badgeLine) {
          paragraphs.push(
            makeParagraph([{ text: badgeLine, bold: true, sizeHalfPt: 16, color: '1E3A8A' }], 60)
          )
        }

        paragraphs.push(makeParagraph([{ text: 'TO:', bold: true, sizeHalfPt: 19 }], 20))

        const renderedTo = renderAddressTemplate(toTemplateStr, ctx)
        const toLines = renderedTo
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)

        toLines.forEach((line, i) => {
          paragraphs.push(
            makeParagraph(
              [{ text: line, bold: i === 0, sizeHalfPt: i === 0 ? 21 : 19 }],
              i === toLines.length - 1 ? 80 : 20
            )
          )
        })

        if (fromLines.length > 0) {
          paragraphs.push(
            makeParagraph(
              [{ text: '________________________________________', sizeHalfPt: 15, color: '94A3B8' }],
              30
            )
          )
          fromLines.forEach((line, i) => {
            paragraphs.push(
              makeParagraph(
                [{ text: line, bold: i === 0, sizeHalfPt: 15, color: '475569' }],
                10
              )
            )
          })
        }

        cellsXml.push(`<w:tc>
          <w:tcPr>
            <w:tcW w:w="5377" w:type="dxa"/>
            <w:tcBorders>
              <w:top w:val="dashed" w:sz="8" w:space="0" w:color="1E293B"/>
              <w:left w:val="dashed" w:sz="8" w:space="0" w:color="1E293B"/>
              <w:bottom w:val="dashed" w:sz="8" w:space="0" w:color="1E293B"/>
              <w:right w:val="dashed" w:sz="8" w:space="0" w:color="1E293B"/>
            </w:tcBorders>
            <w:tcMar>
              <w:top w:w="120" w:type="dxa"/>
              <w:left w:w="160" w:type="dxa"/>
              <w:bottom w:w="120" w:type="dxa"/>
              <w:right w:w="160" w:type="dxa"/>
            </w:tcMar>
            <w:vAlign w:val="top"/>
          </w:tcPr>
          ${paragraphs.join('')}
        </w:tc>`)
      }

      rowsXml.push(
        `<w:tr><w:trPr><w:trHeight w:val="${rowHeightTwips}" w:hRule="atLeast"/></w:trPr>${cellsXml.join('')}</w:tr>`
      )
    }

    tablesXml.push(
      `<w:tbl><w:tblPr><w:tblW w:w="10754" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5377"/><w:gridCol w:w="5377"/></w:tblGrid>${rowsXml.join('')}</w:tbl>`
    )
    if (pageStart + boxesPerPage < contexts.length) {
      tablesXml.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${tablesXml.join('')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="576" w:right="576" w:bottom="576" w:left="576" w:header="360" w:footer="360" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`

  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
  )
  zip.file('word/document.xml', documentXml)

  return (await zip.generateAsync({ type: 'uint8array' })) as Uint8Array
}
