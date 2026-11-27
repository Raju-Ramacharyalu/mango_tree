import { useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  Package,
  UploadCloud,
  FileText,
  FolderOpen,
  Printer,
  Download,
  CheckCircle2,
  AlertTriangle,
  Scissors,
  Database,
  FileSpreadsheet,
  Paperclip,
} from 'lucide-react'
import type { ExamCycle } from '@/types/exams'
import type { BoeNominationRow } from '@/types/qpVault'
import {
  buildAddressLabelsHtml,
  buildContextsFromBoeNominations,
  buildDispatchManifestCsv,
  buildSyllabusIndexFromFiles,
  findMatchingSyllabus,
  formatSyllabusFilename,
  generateAddressLabelsDocx,
  makeUniqueZipName,
  parseMailMergeCsvFile,
  renderAddressTemplate,
  renderDocxTemplate,
  sanitizeFilename,
  splitSubjectCodes,
  triggerFileDownload,
  uint8ToBlob,
  type DispatchManifestRow,
  type PackagerRowContext,
  type SyllabusIndex,
} from './packagerUtils'
import { cn } from '@/utils/cn'

interface Props {
  institutionName: string
  cycle: ExamCycle | null
  courses: Array<{ id: string; course_code: string; title: string }>
  nominations: BoeNominationRow[]
}

const DEFAULT_TO_TEMPLATE = `{{ Setter_Name }}
{% if Designation %}{{ Designation }}{% if Department %}, Dept. of {{ Department }}{% endif %}
{% endif %}{% if College %}{{ College }}
{% endif %}{% if Address %}{{ Address }}
{% endif %}{% if City %}{{ City }}{% if Pincode %} - {{ Pincode }}{% endif %}
{% endif %}{% if Phone %}Ph: {{ Phone }}{% endif %}`

const EMPTY_SYLLABUS_INDEX: SyllabusIndex = {
  exactMap: new Map(),
  normMap: new Map(),
  prefixList: [],
  count: 0,
}

export function DispatchPackagerTab({
  institutionName,
  cycle,
  courses,
  nominations,
}: Props) {
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const [sourceMode, setSourceMode] = useState<'BOE_LIVE' | 'CSV_UPLOAD'>('BOE_LIVE')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<PackagerRowContext[]>([])
  const [csvFileName, setCsvFileName] = useState('')

  // Template & Attachment Files
  const [apptTplName, setApptTplName] = useState('')
  const [apptTplBytes, setApptTplBytes] = useState<Uint8Array | null>(null)
  const [qpTplName, setQpTplName] = useState('')
  const [qpTplBytes, setQpTplBytes] = useState<Uint8Array | null>(null)
  const [staticFiles, setStaticFiles] = useState<Array<{ name: string; bytes: Uint8Array }>>([])

  // Syllabus PDFs Index
  const [syllabusIndex, setSyllabusIndex] = useState<SyllabusIndex>(EMPTY_SYLLABUS_INDEX)
  const [includeSyllabus, setIncludeSyllabus] = useState(false)

  // Envelope Address Label Settings
  const [toTemplate, setToTemplate] = useState(DEFAULT_TO_TEMPLATE)
  const [fromAddress, setFromAddress] = useState(
    `FROM: The Controller of Examinations\n${institutionName || 'AMC Engineering College (Autonomous)'}\n18th KM, Bannerghatta Main Road, Bengaluru - 560083`
  )
  const [headerBadge, setHeaderBadge] = useState('CONFIDENTIAL — EXAMINATION WORK')
  const [boxesPerPage, setBoxesPerPage] = useState<6 | 8 | 10>(8)
  const [onlyValidEmailsLabels, setOnlyValidEmailsLabels] = useState(false)
  const [onlyValidEmailsZip, setOnlyValidEmailsZip] = useState(true)

  // Generation Outputs & Progress
  const [busy, setBusy] = useState(false)
  const [progressPct, setProgressPct] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [masterZipBytes, setMasterZipBytes] = useState<Uint8Array | null>(null)
  const [manifestCsvBytes, setManifestCsvBytes] = useState<Uint8Array | null>(null)
  const [summaryInfo, setSummaryInfo] = useState<{
    processed: number
    matchedSyllabi: number
    missingCodes: string[]
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const liveBoeContexts = useMemo(
    () => buildContextsFromBoeNominations(nominations, courses, cycle),
    [nominations, courses, cycle]
  )

  const activeContexts = sourceMode === 'BOE_LIVE' ? liveBoeContexts : csvRows
  const detectedVariables = useMemo(() => {
    if (sourceMode === 'CSV_UPLOAD' && csvHeaders.length > 0) return csvHeaders
    const first = activeContexts[0]
    return first ? Object.keys(first) : ['Setter_Name', 'Email', 'Course_Code', 'Course_Title', 'Department', 'College', 'Address', 'Phone', 'Ref_No', 'Portal_Link']
  }, [sourceMode, csvHeaders, activeContexts])

  const filteredLabelContexts = useMemo(
    () =>
      activeContexts.filter(
        (c) => !onlyValidEmailsLabels || String(c.Email || '').includes('@')
      ),
    [activeContexts, onlyValidEmailsLabels]
  )

  // Syllabus pre-flight match stats
  const syllabusPreflight = useMemo(() => {
    if (!includeSyllabus || syllabusIndex.count === 0) {
      return { matchedRows: 0, missingCodes: [] as string[] }
    }
    let matchedRows = 0
    const missing = new Set<string>()
    for (const ctx of activeContexts) {
      const codes = splitSubjectCodes(ctx.Course_Code)
      if (codes.length === 0) continue
      let allOk = true
      for (const code of codes) {
        if (!findMatchingSyllabus(code, syllabusIndex)) {
          missing.add(code)
          allOk = false
        }
      }
      if (allOk) matchedRows += 1
    }
    return { matchedRows, missingCodes: Array.from(missing).sort() }
  }, [activeContexts, includeSyllabus, syllabusIndex])

  const previewLines = useMemo(() => {
    const first = filteredLabelContexts[0]
    if (!first) return []
    return renderAddressTemplate(toTemplate, first)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  }, [filteredLabelContexts, toTemplate])

  const handleCsvUpload = async (file: File) => {
    setErrorMsg(null)
    try {
      const res = await parseMailMergeCsvFile(file)
      setCsvHeaders(res.headers)
      setCsvRows(res.rows)
      setCsvFileName(file.name)
      setSourceMode('CSV_UPLOAD')
      setMasterZipBytes(null)
      setManifestCsvBytes(null)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse CSV')
    }
  }

  const handleSyllabusUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setErrorMsg(null)
    try {
      const idx = await buildSyllabusIndexFromFiles(Array.from(files))
      setSyllabusIndex(idx)
      setIncludeSyllabus(idx.count > 0)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to index syllabus PDFs')
    }
  }

  const handlePrintAddressLabels = () => {
    if (filteredLabelContexts.length === 0) return
    const html = buildAddressLabelsHtml(
      filteredLabelContexts,
      toTemplate,
      fromAddress,
      headerBadge,
      boxesPerPage
    )
    const win = window.open('', '_blank', 'width=960,height=1100')
    if (!win) {
      setErrorMsg('Popup blocked. Allow popups for this site to print A4 address labels.')
      return
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 250)
  }

  const handleDownloadAddressLabelsDocx = async () => {
    if (filteredLabelContexts.length === 0) return
    setErrorMsg(null)
    try {
      const bytes = await generateAddressLabelsDocx(
        filteredLabelContexts,
        toTemplate,
        fromAddress,
        headerBadge,
        boxesPerPage
      )
      triggerFileDownload(
        uint8ToBlob(
          bytes,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ),
        'Envelope_Address_Labels.docx'
      )
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to build .docx address labels')
    }
  }

  const handleGenerateMasterPackage = async () => {
    if (!apptTplBytes || !qpTplBytes) {
      setErrorMsg('Upload both the Appointment Order (.docx) and QP Format (.docx) templates first.')
      return
    }
    if (activeContexts.length === 0) {
      setErrorMsg('No setter rows available to package.')
      return
    }

    setBusy(true)
    setErrorMsg(null)
    setProgressPct(0)
    setProgressText('Initializing master archive...')

    try {
      const masterZip = new JSZip()
      const usedZipNames = new Set<string>()
      const packagedContexts: PackagerRowContext[] = []
      const manifestRows: DispatchManifestRow[] = []
      const missingSyllabi = new Set<string>()
      let matchedSyllabusCount = 0
      const syllabusReady = includeSyllabus && syllabusIndex.count > 0

      for (let i = 0; i < activeContexts.length; i++) {
        const ctx = activeContexts[i]
        const name = ctx.Setter_Name || `Setter_${i + 1}`
        const email = ctx.Email || ''
        const course = ctx.Course_Code || `Course_${i + 1}`

        if (onlyValidEmailsZip && !email.includes('@')) continue

        setProgressText(`Packaging ${name} (${course})...`)
        packagedContexts.push(ctx)

        const apptBytes = renderDocxTemplate(apptTplBytes, ctx)
        const qpBytes = renderDocxTemplate(qpTplBytes, ctx)

        const safeCourse = sanitizeFilename(course)
        const safeName = sanitizeFilename(name)
        const setterZip = new JSZip()
        setterZip.file(`Appointment_Order_${safeCourse}_${safeName}.docx`, apptBytes)
        setterZip.file(`QP_Format_${safeCourse}_${safeName}.docx`, qpBytes)

        const attachedSyllabi: string[] = []
        if (syllabusReady) {
          const seenNames = new Set<string>()
          for (const code of splitSubjectCodes(ctx.Course_Code)) {
            const match = findMatchingSyllabus(code, syllabusIndex)
            if (match) {
              const sylFname = formatSyllabusFilename(match.name)
              if (!seenNames.has(sylFname)) {
                setterZip.file(sylFname, match.bytes)
                seenNames.add(sylFname)
                attachedSyllabi.push(sylFname)
                matchedSyllabusCount += 1
              }
            } else {
              missingSyllabi.add(code)
            }
          }
        }

        for (const sf of staticFiles) {
          setterZip.file(sf.name, sf.bytes)
        }

        const setterZipBytes = (await setterZip.generateAsync({
          type: 'uint8array',
          compression: 'DEFLATE',
        })) as Uint8Array
        const packageName = makeUniqueZipName(
          `Confidential_${safeCourse}_${safeName}`,
          usedZipNames
        )
        masterZip.file(packageName, setterZipBytes)

        manifestRows.push({
          Sl_No: packagedContexts.length,
          Setter_Name: name,
          Email: email,
          Course_Code: ctx.Course_Code || '',
          Course_Title: ctx.Course_Title || '',
          Department: ctx.Department || '',
          College: ctx.College || '',
          Ref_No: ctx.Ref_No || '',
          Syllabus_Attached: attachedSyllabi.length > 0 ? attachedSyllabi.join(', ') : 'None',
          Zip_Filename: packageName,
          Dispatch_Status: '',
          Dispatch_Log: '',
        })

        setProgressPct(Math.round(((i + 1) / activeContexts.length) * 90))
      }

      if (packagedContexts.length === 0) {
        throw new Error('Zero rows qualified (check if "Only valid Email" filtered out all rows).')
      }

      setProgressText('Bundling Google Sheets Dispatch Manifest & Envelope Address Sheets...')
      const manifestBytes = buildDispatchManifestCsv(manifestRows)
      masterZip.file('00_GoogleSheet_Dispatch_Manifest.csv', manifestBytes)

      const docxLabelsBytes = await generateAddressLabelsDocx(
        packagedContexts,
        toTemplate,
        fromAddress,
        headerBadge,
        boxesPerPage
      )
      masterZip.file('00_PRINT_Envelope_Address_Labels.docx', docxLabelsBytes)

      const htmlLabels = buildAddressLabelsHtml(
        packagedContexts,
        toTemplate,
        fromAddress,
        headerBadge,
        boxesPerPage
      )
      masterZip.file('00_PRINT_Envelope_Address_Labels.html', htmlLabels)

      const finalBytes = (await masterZip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
      })) as Uint8Array

      setMasterZipBytes(finalBytes)
      setManifestCsvBytes(manifestBytes)
      setSummaryInfo({
        processed: packagedContexts.length,
        matchedSyllabi: matchedSyllabusCount,
        missingCodes: Array.from(missingSyllabi).sort(),
      })
      setProgressPct(100)
      setProgressText('')
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Document packaging failed. Check template {{ Placeholder }} syntax.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          {errorMsg}
        </div>
      )}

      {/* STEP 1: DATA SOURCE + TEMPLATES + SYLLABUS MATCHER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Database className="h-4 w-4 text-indigo-600" />
              1. Setter Data Source
            </h2>
            <span className="rounded-full bg-indigo-50 text-indigo-800 px-2.5 py-0.5 font-bold">
              {activeContexts.length} Row(s)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSourceMode('BOE_LIVE')}
              className={cn(
                'rounded-md py-1.5 font-semibold transition',
                sourceMode === 'BOE_LIVE'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Live BOE Approved ({liveBoeContexts.length})
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('CSV_UPLOAD')}
              className={cn(
                'rounded-md py-1.5 font-semibold transition',
                sourceMode === 'CSV_UPLOAD'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Mail Merge CSV ({csvRows.length})
            </button>
          </div>

          {sourceMode === 'BOE_LIVE' ? (
            <p className="text-slate-500">
              Automatically pulls all <strong>Approved</strong> setters from{' '}
              <strong>BOE Appointments</strong> for cycle{' '}
              <span className="font-mono font-semibold text-slate-800">
                {cycle?.code ?? 'active cycle'}
              </span>
              , including course titles and 15-day portal links.
            </p>
          ) : (
            <div className="space-y-2">
              <label className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/40 px-3 py-3 font-semibold text-indigo-800 hover:bg-indigo-50 cursor-pointer">
                <UploadCloud className="h-4 w-4" />
                {csvFileName ? `Loaded: ${csvFileName}` : 'Upload Mail Merge Data (.csv)'}
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleCsvUpload(f)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          )}

          <div className="pt-1 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-600 mb-1">
              Available Template Placeholders:
            </p>
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
              {detectedVariables.map((v) => (
                <code
                  key={v}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700"
                >
                  {`{{ ${v} }}`}
                </code>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-indigo-600" />
            2. Templates, Static Attachments &amp; Syllabus PDFs
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-400">
              <span className="truncate font-medium text-slate-700">
                {apptTplName || 'Appointment Order (.docx) *'}
              </span>
              <span className="rounded bg-white border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-indigo-700 shrink-0">
                Browse
              </span>
              <input
                type="file"
                accept=".docx"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  setApptTplName(f.name)
                  setApptTplBytes(new Uint8Array(await f.arrayBuffer()))
                  e.target.value = ''
                }}
              />
            </label>

            <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-400">
              <span className="truncate font-medium text-slate-700">
                {qpTplName || 'QP Format Template (.docx) *'}
              </span>
              <span className="rounded bg-white border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-indigo-700 shrink-0">
                Browse
              </span>
              <input
                type="file"
                accept=".docx"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  setQpTplName(f.name)
                  setQpTplBytes(new Uint8Array(await f.arrayBuffer()))
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:border-indigo-400">
              <span className="truncate font-medium text-slate-700 inline-flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                {staticFiles.length > 0
                  ? `${staticFiles.length} Static File(s) Loaded`
                  : 'Static Files (Remuneration Bill, etc.)'}
              </span>
              <span className="rounded bg-white border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-slate-700 shrink-0">
                Select
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const list = Array.from(e.target.files ?? [])
                  const loaded = await Promise.all(
                    list.map(async (f) => ({
                      name: f.name,
                      bytes: new Uint8Array(await f.arrayBuffer()),
                    }))
                  )
                  setStaticFiles(loaded)
                  e.target.value = ''
                }}
              />
            </label>

            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-2 font-semibold text-emerald-800 hover:bg-emerald-100 inline-flex items-center justify-center gap-1"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Syllabus Folder
              </button>
              <input
                ref={(el) => {
                  folderInputRef.current = el
                  if (el) el.setAttribute('webkitdirectory', '')
                }}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleSyllabusUpload(e.target.files)
                  e.target.value = ''
                }}
              />
              <label className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-2 font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center gap-1 cursor-pointer">
                <UploadCloud className="h-3.5 w-3.5" />
                PDFs / ZIP
                <input
                  type="file"
                  accept=".pdf,.zip"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleSyllabusUpload(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
              <input
                type="checkbox"
                disabled={syllabusIndex.count === 0}
                checked={includeSyllabus}
                onChange={(e) => setIncludeSyllabus(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              Attach subject-matched Syllabus PDF ({syllabusIndex.count} indexed)
            </label>
            {includeSyllabus && syllabusIndex.count > 0 && (
              <span className="text-[11px] font-bold text-emerald-700">
                Matched: {syllabusPreflight.matchedRows} / {activeContexts.length} rows
              </span>
            )}
          </div>

          {includeSyllabus && syllabusPreflight.missingCodes.length > 0 && (
            <div className="rounded bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900">
              Missing syllabus PDF for {syllabusPreflight.missingCodes.length} code(s):{' '}
              <span className="font-mono font-semibold">
                {syllabusPreflight.missingCodes.join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* STEP 2: ENVELOPE ADDRESS CUT-OUT LABELS */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Scissors className="h-4 w-4 text-indigo-600" />
              3. Printable Envelope Address Cut-Out Boxes (A4 2-Column Grid)
            </h2>
            <p className="text-slate-500">
              Print directly to A4 PDF or download editable Word (.docx) sheets to cut along dashed lines.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={filteredLabelContexts.length === 0}
              onClick={handleDownloadAddressLabelsDocx}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Labels (.docx) — {filteredLabelContexts.length}
            </button>
            <button
              type="button"
              disabled={filteredLabelContexts.length === 0}
              onClick={handlePrintAddressLabels}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <Printer className="h-3.5 w-3.5" />
              Print / PDF Labels ({filteredLabelContexts.length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 space-y-1">
            <label className="block font-semibold text-slate-700">TO Address Box Template</label>
            <textarea
              rows={6}
              value={toTemplate}
              onChange={(e) => setToTemplate(e.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 font-mono text-[11px]"
            />
          </div>

          <div className="lg:col-span-4 space-y-2">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">FROM Return Address</label>
              <textarea
                rows={3}
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                className="w-full rounded-md border border-slate-300 p-2 text-[11px]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Top Stamp</label>
                <input
                  value={headerBadge}
                  onChange={(e) => setHeaderBadge(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Boxes / A4 Sheet</label>
                <select
                  value={boxesPerPage}
                  onChange={(e) => setBoxesPerPage(Number(e.target.value) as 6 | 8 | 10)}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                >
                  <option value={8}>8 Boxes (2 × 4)</option>
                  <option value={10}>10 Boxes (2 × 5)</option>
                  <option value={6}>6 Boxes (2 × 3)</option>
                </select>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-slate-600">
              <input
                type="checkbox"
                checked={onlyValidEmailsLabels}
                onChange={(e) => setOnlyValidEmailsLabels(e.target.checked)}
                className="rounded border-slate-300"
              />
              Only include rows with valid Email
            </label>
          </div>

          <div className="lg:col-span-4">
            <label className="block font-semibold text-slate-700 mb-1">
              Live Preview (Box #1)
            </label>
            <div className="rounded border-2 border-dashed border-slate-700 bg-white p-3 space-y-2 min-h-[150px] flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold text-indigo-900">
                  &#9986; {headerBadge}{' '}
                  {filteredLabelContexts[0]?.Course_Code
                    ? `| [${filteredLabelContexts[0].Course_Code}]`
                    : ''}
                </p>
                <div className="mt-1.5 text-[11px] leading-relaxed text-slate-900">
                  <p className="font-bold">TO:</p>
                  {previewLines.length === 0 ? (
                    <p className="italic text-slate-400">No setter data loaded yet.</p>
                  ) : (
                    previewLines.map((line, i) => (
                      <p key={i} className={i === 0 ? 'font-bold' : ''}>
                        {line}
                      </p>
                    ))
                  )}
                </div>
              </div>
              {fromAddress.trim() && (
                <div className="border-t border-slate-300 pt-1.5 text-[10px] text-slate-600 whitespace-pre-line">
                  {fromAddress.trim()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* STEP 3: GENERATE MASTER ZIP + GOOGLE SHEETS DISPATCH MANIFEST */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Package className="h-4 w-4 text-indigo-600" />
              4. Generate Individual Setter ZIPs &amp; Google Sheets Dispatch Manifest
            </h2>
            <p className="text-slate-500">
              Outputs personalized <code>Confidential_&lt;Course&gt;_&lt;Setter&gt;.zip</code> files,{' '}
              <code>00_GoogleSheet_Dispatch_Manifest.csv</code> (for Apps Script), and master label sheets.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-slate-700 font-medium">
            <input
              type="checkbox"
              checked={onlyValidEmailsZip}
              onChange={(e) => setOnlyValidEmailsZip(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            Only package rows with valid Email
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busy || !apptTplBytes || !qpTplBytes || activeContexts.length === 0}
            onClick={handleGenerateMasterPackage}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            <Package className="h-4 w-4" />
            {busy ? `Packaging (${progressPct}%)...` : 'Build Master ZIP + Dispatch Manifest'}
          </button>

          {masterZipBytes && (
            <button
              type="button"
              onClick={() =>
                triggerFileDownload(
                  uint8ToBlob(masterZipBytes, 'application/zip'),
                  `All_Setter_Packages_${cycle?.code ?? 'COE'}.zip`
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700"
            >
              <Download className="h-4 w-4" />
              Download Master ZIP ({summaryInfo?.processed ?? 0} Setters)
            </button>
          )}

          {manifestCsvBytes && (
            <button
              type="button"
              onClick={() =>
                triggerFileDownload(
                  uint8ToBlob(manifestCsvBytes, 'text/csv;charset=utf-8;'),
                  '00_GoogleSheet_Dispatch_Manifest.csv'
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              Download Dispatch Manifest Only (.csv)
            </button>
          )}
        </div>

        {busy && (
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500">{progressText}</p>
          </div>
        )}

        {summaryInfo && !busy && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-emerald-900 space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Packaged {summaryInfo.processed} setter ZIP archive(s)
              {includeSyllabus ? ` + ${summaryInfo.matchedSyllabi} matched syllabus PDF(s)` : ''} +
              00_GoogleSheet_Dispatch_Manifest.csv + Envelope Address Sheets.
            </p>
            {summaryInfo.missingCodes.length > 0 && (
              <p className="text-[11px] text-amber-800">
                Missing syllabus PDF for: {summaryInfo.missingCodes.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
