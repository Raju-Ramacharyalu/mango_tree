import { useMemo, useState } from 'react'
import { Trophy, FileSpreadsheet, Printer, Award, FolderArchive } from 'lucide-react'
import type { ExamCycle, ExamSemesterResultItem } from '@/types/exams'
import {
  buildRankedStudentRows,
  exportA3MasterLedgerWorkbook,
  exportSplitA3LedgersZip,
  exportRankListWorkbook,
  type ClassAward,
  type ExtendedCourseRow,
} from './masterLedgerExcel'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
} from './printBranding'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle
  courseResults: ExtendedCourseRow[]
  semesterResults: ExamSemesterResultItem[]
}

const AWARD_BADGES: Record<ClassAward, string> = {
  FCD: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  FC: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  SC: 'bg-sky-100 text-sky-800 border border-sky-200',
  PASS: 'bg-slate-100 text-slate-700',
  FAIL: 'bg-red-50 text-red-700 border border-red-200',
  WITHHELD: 'bg-amber-100 text-amber-900 border border-amber-300',
  PENDING: 'bg-slate-100 text-slate-500',
}

export function RankAndLedgerPanel({
  institutionId,
  institutionName,
  cycle,
  courseResults,
  semesterResults,
}: Props) {
  const [branchFilter, setBranchFilter] = useState('ALL')
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'UG' | 'PG'>('ALL')
  const [excludeGraced, setExcludeGraced] = useState(true)
  const [topLimit, setTopLimit] = useState('25')
  const [exporting, setExporting] = useState<'NONE' | 'XLSX' | 'ZIP' | 'RANK'>('NONE')

  const branches = useMemo(
    () => Array.from(new Set(semesterResults.map((s) => s.program_code))).sort(),
    [semesterResults]
  )

  const scopedSemester = useMemo(() => {
    return semesterResults.filter((sr) => {
      if (branchFilter !== 'ALL' && sr.program_code !== branchFilter) return false
      if (levelFilter !== 'ALL' && sr.program_level !== levelFilter) return false
      return true
    })
  }, [semesterResults, branchFilter, levelFilter])

  const rankedRows = useMemo(
    () => buildRankedStudentRows(scopedSemester, courseResults, excludeGraced),
    [scopedSemester, courseResults, excludeGraced]
  )

  const summary = useMemo(() => {
    const appeared = rankedRows.length
    const withheld = rankedRows.filter((r) => r.class_award === 'WITHHELD').length
    const failed = rankedRows.filter((r) => r.class_award === 'FAIL' || r.class_award === 'PENDING').length
    const fcd = rankedRows.filter((r) => r.class_award === 'FCD').length
    const fc = rankedRows.filter((r) => r.class_award === 'FC').length
    const sc = rankedRows.filter((r) => r.class_award === 'SC').length
    const passClass = rankedRows.filter((r) => r.class_award === 'PASS').length
    const passed = fcd + fc + sc + passClass
    const passPct = appeared - withheld > 0 ? Number(((passed / (appeared - withheld)) * 100).toFixed(1)) : 0
    return { appeared, passed, failed, withheld, passPct, fcd, fc, sc, passClass }
  }, [rankedRows])

  const meritOnly = useMemo(() => {
    const list = rankedRows.filter((r) => r.rank !== null)
    const lim = Number(topLimit)
    return lim > 0 ? list.slice(0, lim) : list
  }, [rankedRows, topLimit])

  const printMeritList = async () => {
    if (meritOnly.length === 0) return
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigs = await signPrivateAssets([branding.coe_signature_path, branding.principal_signature_path])
    const coeSig = branding.coe_signature_path ? sigs.get(branding.coe_signature_path) : null
    const prinSig = branding.principal_signature_path ? sigs.get(branding.principal_signature_path) : null
    const scopeText = `${branchFilter === 'ALL' ? 'All Branches' : branchFilter} · ${levelFilter}`

    openBrandedPrintWindow({
      title: `${cycle.code}_Merit_Rank_List_${branchFilter}`,
      landscape: false,
      branding,
      watermarkMode: 'fixed',
      bodyHtml: `
        ${renderWatermarkHtml(branding, 'per-page')}
        ${renderBrandedHeaderHtml(
          branding,
          `MERIT RANK & CLASS DISTINCTION LIST — ${cycle.name} (${cycle.code})`,
          `Scope: ${scopeText} · Appeared: ${summary.appeared} · Passed: ${summary.passed} (${summary.passPct}%) · FCD: ${summary.fcd} · FC: ${summary.fc}`
        )}
        <table>
          <thead>
            <tr>
              <th style="width:42px;text-align:center">Rank</th>
              <th style="width:105px">USN</th>
              <th>Candidate Name</th>
              <th style="width:55px;text-align:center">Branch</th>
              <th style="width:65px;text-align:center">Total</th>
              <th style="width:52px;text-align:center">%</th>
              <th style="width:52px;text-align:center">SGPA</th>
              <th style="width:62px;text-align:center">Class</th>
            </tr>
          </thead>
          <tbody>
            ${meritOnly
              .map(
                (r) => `<tr>
                  <td style="text-align:center;font-weight:700">${r.rank}</td>
                  <td style="font-family:monospace;font-weight:700">${escapeHtml(r.usn)}</td>
                  <td>${escapeHtml(r.student_name)}</td>
                  <td style="text-align:center">${escapeHtml(r.program_code)}</td>
                  <td style="text-align:center">${r.total_obtained}/${r.total_max}</td>
                  <td style="text-align:center">${r.percentage.toFixed(1)}%</td>
                  <td style="text-align:center;font-weight:700">${r.sgpa.toFixed(2)}</td>
                  <td style="text-align:center;font-weight:700">${r.class_award}</td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
        <div class="signatures" style="margin-top:32px">
          ${renderSignatureBlockHtml('Controller of Examinations (COE)', coeSig)}
          ${renderSignatureBlockHtml('Principal / Head of Institution', prinSig)}
        </div>
      `,
    })
  }

  return (
    <div className="space-y-4">
      {/* KPI Distribution Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase text-slate-500">Pass Rate</p>
          <p className="text-xl font-extrabold text-indigo-700 mt-0.5">{summary.passPct}%</p>
          <p className="text-[11px] text-slate-500">{summary.passed} / {summary.appeared - summary.withheld}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="text-[10px] font-semibold uppercase text-emerald-700">FCD (≥70%)</p>
          <p className="text-xl font-extrabold text-emerald-900 mt-0.5">{summary.fcd}</p>
          <p className="text-[11px] text-emerald-700">Distinction</p>
        </div>
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <p className="text-[10px] font-semibold uppercase text-indigo-700">First Class</p>
          <p className="text-xl font-extrabold text-indigo-900 mt-0.5">{summary.fc}</p>
          <p className="text-[11px] text-indigo-700">60% – 69.9%</p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3">
          <p className="text-[10px] font-semibold uppercase text-sky-700">Second Class</p>
          <p className="text-xl font-extrabold text-sky-900 mt-0.5">{summary.sc}</p>
          <p className="text-[11px] text-sky-700">50% – 59.9%</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
          <p className="text-[10px] font-semibold uppercase text-red-700">Failed / Pending</p>
          <p className="text-xl font-extrabold text-red-800 mt-0.5">{summary.failed}</p>
          <p className="text-[11px] text-red-700">Needs backlog clearance</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-[10px] font-semibold uppercase text-amber-800">Withheld</p>
          <p className="text-xl font-extrabold text-amber-900 mt-0.5">{summary.withheld}</p>
          <p className="text-[11px] text-amber-800">Held by COE</p>
        </div>
      </div>

      {/* Filters & A3 Ledger / Rank Exports */}
      <div className="rounded-lg border border-slate-200 bg-white p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as 'ALL' | 'UG' | 'PG')}
            className="rounded border border-slate-300 px-2.5 py-1.5"
          >
            <option value="ALL">All Levels (UG &amp; PG)</option>
            <option value="UG">UG Only</option>
            <option value="PG">PG Only</option>
          </select>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded border border-slate-300 px-2.5 py-1.5"
          >
            <option value="ALL">All Branches ({branches.length})</option>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            value={topLimit}
            onChange={(e) => setTopLimit(e.target.value)}
            className="rounded border border-slate-300 px-2.5 py-1.5"
          >
            <option value="10">Top 10 Rankers</option>
            <option value="25">Top 25 Rankers</option>
            <option value="50">Top 50 Rankers</option>
            <option value="0">All Ranked Pass Candidates</option>
          </select>
          <label className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <input
              type="checkbox"
              checked={excludeGraced}
              onChange={(e) => setExcludeGraced(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            Exclude Graced from Merit Ranks (VTU Rule)
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={scopedSemester.length === 0 || exporting !== 'NONE'}
            onClick={async () => {
              setExporting('ZIP')
              try {
                await exportSplitA3LedgersZip({
                  institutionName,
                  cycle,
                  semesterResults: scopedSemester,
                  courseResults,
                  programFilter: branchFilter,
                })
              } finally {
                setExporting('NONE')
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
          >
            <FolderArchive className="h-3.5 w-3.5" />
            {exporting === 'ZIP' ? 'Packaging ZIP...' : 'Export Split A3 Ledgers (.zip)'}
          </button>
          <button
            type="button"
            disabled={scopedSemester.length === 0 || exporting !== 'NONE'}
            onClick={async () => {
              setExporting('XLSX')
              try {
                await exportA3MasterLedgerWorkbook({
                  institutionName,
                  cycle,
                  semesterResults: scopedSemester,
                  courseResults,
                  programFilter: branchFilter,
                })
              } finally {
                setExporting('NONE')
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {exporting === 'XLSX' ? 'Building A3...' : 'Export Combined A3 (.xlsx)'}
          </button>
          <button
            type="button"
            disabled={meritOnly.length === 0 || exporting !== 'NONE'}
            onClick={async () => {
              setExporting('RANK')
              try {
                await exportRankListWorkbook({
                  institutionName,
                  cycle,
                  rows: meritOnly,
                  branchLabel: branchFilter,
                })
              } finally {
                setExporting('NONE')
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-40"
          >
            <Award className="h-3.5 w-3.5" />
            Export Rank List (.xlsx)
          </button>
          <button
            type="button"
            disabled={meritOnly.length === 0}
            onClick={printMeritList}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Merit List (A4)
          </button>
        </div>
      </div>

      {/* Merit Rank Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 text-xs font-semibold text-slate-800">
          <Trophy className="h-4 w-4 text-amber-500" />
          Merit Rank List ({meritOnly.length} shown · Ranked by SGPA &amp; Total Marks)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 text-center w-16">Rank</th>
                <th className="px-4 py-2.5">USN &amp; Candidate</th>
                <th className="px-4 py-2.5">Branch / Sem</th>
                <th className="px-4 py-2.5 text-center">Credits</th>
                <th className="px-4 py-2.5 text-center">Total Marks</th>
                <th className="px-4 py-2.5 text-center">%</th>
                <th className="px-4 py-2.5 text-center">SGPA</th>
                <th className="px-4 py-2.5 text-center">Class</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {meritOnly.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No eligible PASS candidates found to rank for this filter. Compute Grades &amp; SGPA first.
                  </td>
                </tr>
              ) : (
                meritOnly.map((r) => (
                  <tr key={r.student_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-center font-extrabold">
                      <span
                        className={cn(
                          'inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px]',
                          r.rank === 1
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : r.rank === 2
                              ? 'bg-slate-200 text-slate-800'
                              : r.rank === 3
                                ? 'bg-orange-100 text-orange-900'
                                : 'text-slate-700'
                        )}
                      >
                        #{r.rank}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono font-bold text-slate-900">{r.usn}</span>
                      <p className="text-slate-600">{r.student_name}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-slate-800">{r.program_code}</span>{' '}
                      <span className="text-slate-500">({r.program_level})</span>
                      <p className="text-[11px] text-slate-500">{r.period_name}</p>
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono">{r.credits_earned}</td>
                    <td className="px-4 py-2.5 text-center font-mono">
                      {r.total_obtained} / {r.total_max}
                    </td>
                    <td className="px-4 py-2.5 text-center font-semibold text-slate-800">
                      {r.percentage.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono font-extrabold text-indigo-700">
                      {r.sgpa.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', AWARD_BADGES[r.class_award])}>
                        {r.class_award}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
