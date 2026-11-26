import { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import JsBarcode from 'jsbarcode'
import { CreditCard, Printer, Upload, Search } from 'lucide-react'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  signPrivateAssets,
  signStudentPhotosWithFallback,
} from '@/modules/exams/printBranding'
import type { StudentFrontOfficeRecord } from '@/types/frontOffice'

interface Props {
  institutionId: string
  students: StudentFrontOfficeRecord[]
  programs: Array<{ id: string; code: string; name: string }>
}

interface IdCardPayload {
  key: string
  usn: string
  admission_number: string | null
  full_name: string
  sem: number
  program_code: string
  photo_url: string | null
}

function buildCode128SvgMarkup(value: string): string {
  const clean = value.trim().toUpperCase() || '0000'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try {
    JsBarcode(svg, clean, {
      format: 'CODE128',
      width: 1.4,
      height: 36,
      displayValue: false,
      margin: 2,
      background: '#ffffff',
      lineColor: '#000000',
    })
  } catch {
    return ''
  }
  return svg.outerHTML
}

export function TempIdEngineTab({ institutionId, students, programs }: Props) {
  const csvRef = useRef<HTMLInputElement | null>(null)
  const [branchFilter, setBranchFilter] = useState('ALL')
  const [semFilter, setSemFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [footerDomain, setFooterDomain] = useState('www.amcgroup.edu.in')
  const [csvBatch, setCsvBatch] = useState<IdCardPayload[] | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)

  const studentByUsn = useMemo(() => {
    const map = new Map<string, StudentFrontOfficeRecord>()
    for (const s of students) {
      map.set(s.registration_number.trim().toUpperCase(), s)
    }
    return map
  }, [students])

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return students.filter((s) => {
      if (branchFilter !== 'ALL' && s.program_code !== branchFilter) return false
      if (semFilter !== 'ALL' && String(s.current_sem) !== semFilter) return false
      if (q) {
        const hay = `${s.registration_number} ${s.full_name} ${s.program_code}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [students, branchFilter, semFilter, searchQuery])

  const handleCsvUpload = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        const out: IdCardPayload[] = []
        for (const row of parsed.data) {
          const usn = (row.usn || row.USN || '').trim().toUpperCase()
          const name = (row.full_name || row.Full_Name || row.name || '').trim()
          const sem = Number(row.current_sem || row.sem || 1) || 1
          if (!usn || !name) continue
          const dbMatch = studentByUsn.get(usn)
          out.push({
            key: dbMatch?.id ?? usn,
            usn,
            admission_number: dbMatch?.admission_number ?? null,
            full_name: name,
            sem,
            program_code: dbMatch?.program_code ?? (row.branch || 'GEN').trim().toUpperCase(),
            photo_url: dbMatch?.photo_url ?? null,
          })
        }
        setCsvBatch(out)
      },
    })
  }

  const printCardsGrid = async (cards: IdCardPayload[]) => {
    if (cards.length === 0) return
    setIsPrinting(true)
    try {
      const branding = await fetchInstitutionBranding(institutionId)
      const [sigMap, photoMap] = await Promise.all([
        signPrivateAssets([branding.principal_signature_path]),
        signStudentPhotosWithFallback(
          institutionId,
          cards.map((c) => ({
            key: c.key,
            photo_url: c.photo_url,
            registration_number: c.usn,
            admission_number: c.admission_number,
          }))
        ),
      ])
      const principalSigUrl = branding.principal_signature_path
        ? (sigMap.get(branding.principal_signature_path) ?? null)
        : null

      const pages: string[] = []
      for (let i = 0; i < cards.length; i += 12) {
        const chunk = cards.slice(i, i + 12)
        const cardsHtml = chunk
          .map((c) => {
            const photoUrl = photoMap.get(c.key)
            const barcodeSvg = buildCode128SvgMarkup(c.usn)
            const displayName = c.full_name.toUpperCase().slice(0, 22)
            return `<div class="id-card">
              <div class="id-top">
                ${branding.left_logo_url ? `<img src="${escapeHtml(branding.left_logo_url)}" class="id-logo" alt="" />` : ''}
                <div class="id-inst">
                  <div class="id-inst-name">${escapeHtml(branding.short_name || branding.name)}</div>
                  <div class="id-inst-sub">${escapeHtml(branding.university_affiliation || 'Autonomous Institution')}</div>
                </div>
              </div>
              <div class="id-mid">
                <div class="id-photo-box">
                  ${
                    photoUrl
                      ? `<img src="${escapeHtml(photoUrl)}" class="id-photo" alt="" />`
                      : `<div class="id-photo-empty">PHOTO</div>`
                  }
                </div>
                <div class="id-barcode-strip">
                  <div class="id-barcode-rot">${barcodeSvg}</div>
                </div>
              </div>
              <div class="id-banner">
                <div class="id-name">${escapeHtml(displayName)}</div>
                <div class="id-meta">ID: ${escapeHtml(c.usn)} &nbsp;|&nbsp; SEM: ${c.sem}</div>
              </div>
              <div class="id-sig-box">
                ${principalSigUrl ? `<img src="${escapeHtml(principalSigUrl)}" class="id-sig-img" alt="" />` : '<div class="id-sig-spacer"></div>'}
                <div class="id-sig-lbl">Principal</div>
              </div>
              <div class="id-footer">${escapeHtml(footerDomain.trim() || branding.name)}</div>
            </div>`
          })
          .join('')
        pages.push(`<section class="page"><div class="id-grid">${cardsHtml}</div></section>`)
      }

      openBrandedPrintWindow({
        title: `Temp_ID_Cards_${cards.length}`,
        landscape: false,
        branding,
        watermarkMode: 'per-page',
        extraCss: `
          @page { size: A4 portrait; margin: 6mm; }
          .id-grid { display: grid; grid-template-columns: repeat(3, 62mm); grid-auto-rows: 68mm; gap: 4mm; justify-content: center; }
          .id-card { width: 62mm; height: 68mm; background: #19233A; color: #fff; border-radius: 3px; padding: 2.2mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; border: 0.3mm solid #0f172a; }
          .id-top { display: flex; align-items: center; gap: 2mm; border-bottom: 0.4mm solid rgba(255,255,255,0.65); padding-bottom: 1.5mm; }
          .id-logo { width: 8.5mm; height: 8.5mm; object-fit: contain; background: #fff; border-radius: 2px; padding: 0.4mm; }
          .id-inst { flex: 1; min-width: 0; }
          .id-inst-name { font-size: 6.5pt; font-weight: 800; text-transform: uppercase; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .id-inst-sub { font-size: 5pt; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .id-mid { display: flex; gap: 1.5mm; height: 32mm; margin-top: 1.2mm; }
          .id-photo-box { flex: 1; background: #cbd5e1; overflow: hidden; display: flex; align-items: center; justify-content: center; }
          .id-photo { width: 100%; height: 100%; object-fit: cover; }
          .id-photo-empty { font-size: 7pt; font-weight: 700; color: #475569; }
          .id-barcode-strip { width: 12mm; background: #D9534F; display: flex; align-items: center; justify-content: center; overflow: hidden; }
          .id-barcode-rot { transform: rotate(90deg); width: 30mm; display: flex; align-items: center; justify-content: center; }
          .id-barcode-rot svg { width: 30mm; height: 9mm; }
          .id-banner { background: #17A2B8; padding: 1.4mm 2mm; margin-top: 1mm; }
          .id-name { font-size: 7pt; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .id-meta { font-size: 5.8pt; font-weight: 600; margin-top: 0.4mm; }
          .id-sig-box { background: #fff; color: #111; margin: 1.2mm auto 0; width: 34mm; height: 9.5mm; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding: 0.5mm; }
          .id-sig-img { max-height: 6mm; max-width: 30mm; object-fit: contain; }
          .id-sig-spacer { height: 5mm; }
          .id-sig-lbl { font-size: 5.5pt; font-weight: 700; line-height: 1; }
          .id-footer { text-align: center; font-size: 5pt; opacity: 0.9; margin-top: 0.6mm; }
        `,
        bodyHtml: pages.join(''),
      })
    } finally {
      setIsPrinting(false)
    }
  }

  const activeDeck: IdCardPayload[] = csvBatch
    ? csvBatch
    : filteredStudents.map((s) => ({
        key: s.id,
        usn: s.registration_number,
        admission_number: s.admission_number,
        full_name: s.full_name,
        sem: s.current_sem,
        program_code: s.program_code,
        photo_url: s.photo_url,
      }))

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-indigo-600" />
              Branded A4 3×4 Barcode Temp ID Card Engine (12 Cards / Page)
            </h2>
            <p className="text-xs text-slate-500">
              Uses tenant Top-Left Logo, private Principal signature, Code128 vertical barcode, and automatic USN →
              Admission No. photo fallback.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={csvRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleCsvUpload(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => csvRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload CSV (usn, full_name, current_sem)
            </button>
            {csvBatch && (
              <button
                type="button"
                onClick={() => setCsvBatch(null)}
                className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800"
              >
                Clear CSV ({csvBatch.length})
              </button>
            )}
            <button
              type="button"
              disabled={isPrinting || activeDeck.length === 0}
              onClick={() => printCardsGrid(activeDeck)}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Printer className="h-3.5 w-3.5" />
              {isPrinting ? 'Signing Photos...' : `Print ${activeDeck.length} Cards (${Math.ceil(activeDeck.length / 12)} A4 Pages)`}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search USN or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-slate-300 pl-8 pr-2.5 py-1.5 text-xs"
            />
          </div>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="ALL">All Branches</option>
            {programs.map((p) => (
              <option key={p.id} value={p.code}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          <select
            value={semFilter}
            onChange={(e) => setSemFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          >
            <option value="ALL">All Semesters</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={String(n)}>
                Semester {n}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Card Footer Website"
            value={footerDomain}
            onChange={(e) => setFooterDomain(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">USN</th>
                <th className="px-4 py-2.5 font-semibold">Student Name</th>
                <th className="px-4 py-2.5 font-semibold">Branch / Sem</th>
                <th className="px-4 py-2.5 font-semibold">Photo</th>
                <th className="px-4 py-2.5 font-semibold text-right">Single Card</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeDeck.slice(0, 100).map((c) => (
                <tr key={c.key} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono font-semibold text-slate-900">{c.usn}</td>
                  <td className="px-4 py-2 text-slate-700">{c.full_name}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.program_code} · Sem {c.sem}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        c.photo_url
                          ? 'rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold'
                          : 'rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-[10px] font-semibold'
                      }
                    >
                      {c.photo_url ? 'Linked' : 'Fallback / Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      disabled={isPrinting}
                      onClick={() => printCardsGrid([c])}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Printer className="h-3 w-3" />
                      Print ID
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
