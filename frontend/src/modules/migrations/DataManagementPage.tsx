import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Papa from 'papaparse'
import { AlertCircle, CheckCircle2, Download, Play, Upload } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { InstitutionSummary } from '@/types/auth'
import type { ImportMode, MigrationEntityType, StagedPreviewRow } from '@/types/migrations'
import { CSV_TEMPLATES, downloadCsvTemplate } from './csvTemplates'
import { commitMigrationJob, validateCsvRows } from './migrationEngine'
import { JobsErrorsTab } from './JobsErrorsTab'
import { ReconciliationTab } from './ReconciliationTab'

const ENTITY_ORDER: MigrationEntityType[] = [
  'PROGRAMS',
  'COURSE_CATALOG',
  'STAFF',
  'STUDENTS',
  'STUDENT_USN_MIGRATION',
  'STUDENT_STATUS',
  'STUDENT_SPECIALIZATIONS',
]

export function DataManagementPage() {
  const queryClient = useQueryClient()
  const { context, activeInstitutionId, platformRoles, memberships, profile } = useAppStore()
  const isPlatformAdmin = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')

  const [selectedPlatformInstId, setSelectedPlatformInstId] = useState('')
  const [activeTab, setActiveTab] = useState<'IMPORT' | 'JOBS' | 'RECONCILIATION'>('IMPORT')

  const [entityType, setEntityType] = useState<MigrationEntityType>('PROGRAMS')
  const [importMode, setImportMode] = useState<ImportMode>('SAFE')
  const [fileName, setFileName] = useState('')
  const [stagedRows, setStagedRows] = useState<StagedPreviewRow[]>([])
  const [previewFilter, setPreviewFilter] = useState<'ALL' | 'VALID' | 'DUPLICATE' | 'ERROR'>('ALL')
  const [isValidating, setIsValidating] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [commitResult, setCommitResult] = useState<{
    status: string
    importedRows: number
    skippedRows: number
    errorRows: number
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: allInstitutions = [] } = useQuery({
    queryKey: ['institutions-min'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institutions')
        .select('id, code, name, short_name, status')
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as InstitutionSummary[]
    },
  })

  const targetInstitutionId =
    context === 'INSTITUTION'
      ? activeInstitutionId
      : selectedPlatformInstId || allInstitutions[0]?.id || activeInstitutionId

  const activeMembership = memberships.find((m) => m.institution_id === targetInstitutionId)
  const canManage =
    isPlatformAdmin ||
    (activeMembership?.roles ?? []).some((r) =>
      ['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER'].includes(r)
    )

  if (!targetInstitutionId) {
    return <div className="text-sm text-slate-500">Select an institution to run imports or migrations.</div>
  }

  const template = CSV_TEMPLATES[entityType]

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setErrorMsg(null)
    setCommitResult(null)
    setFileName(file.name)
    setIsValidating(true)

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: async (results) => {
        try {
          if (results.data.length === 0) {
            setErrorMsg('The uploaded CSV file contains no data rows.')
            setStagedRows([])
            return
          }
          const validated = await validateCsvRows(targetInstitutionId, entityType, results.data)
          setStagedRows(validated)
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Validation failed')
          setStagedRows([])
        } finally {
          setIsValidating(false)
        }
      },
      error: (err) => {
        setErrorMsg(err.message || 'CSV parse error')
        setIsValidating(false)
      },
    })
  }

  const handleCommit = async () => {
    if (stagedRows.length === 0) return
    setErrorMsg(null)
    setCommitResult(null)
    setIsCommitting(true)
    setProgress({ done: 0, total: stagedRows.length })
    try {
      const res = await commitMigrationJob({
        institutionId: targetInstitutionId,
        entityType,
        importMode,
        fileName: fileName || `${entityType.toLowerCase()}.csv`,
        stagedRows,
        actorUserId: profile?.id ?? null,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setCommitResult(res)
      queryClient.invalidateQueries({ queryKey: ['migration-jobs', targetInstitutionId] })
      queryClient.invalidateQueries({ queryKey: ['reconciliation-stats', targetInstitutionId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : 'Commit failed'))
    } finally {
      setIsCommitting(false)
    }
  }

  const validCount = stagedRows.filter((r) => r.status === 'VALID').length
  const dupCount = stagedRows.filter((r) => r.status === 'DUPLICATE').length
  const errCount = stagedRows.filter((r) => r.status === 'ERROR').length
  const filteredPreview = stagedRows.filter((r) => previewFilter === 'ALL' || r.status === previewFilter)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Data &amp; Migration Management</h1>
          <p className="text-sm text-slate-500">
            Download templates, stage and validate CSV files, detect duplicates, and run idempotent migrations.
          </p>
        </div>

        {context === 'PLATFORM' && allInstitutions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Institution Scope:</span>
            <select
              value={targetInstitutionId}
              onChange={(e) => {
                setSelectedPlatformInstId(e.target.value)
                setStagedRows([])
                setCommitResult(null)
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            >
              {allInstitutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.code} — {inst.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {[
          { id: 'IMPORT', label: 'CSV Import & Staging' },
          { id: 'JOBS', label: 'Migration Jobs & Errors' },
          { id: 'RECONCILIATION', label: 'Reconciliation & Audit' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as typeof activeTab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === t.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'JOBS' && <JobsErrorsTab institutionId={targetInstitutionId} canManage={canManage} />}
      {activeTab === 'RECONCILIATION' && <ReconciliationTab institutionId={targetInstitutionId} />}

      {activeTab === 'IMPORT' && (
        <div className="space-y-5">
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  1. Select Import Dataset (Recommended Order: Programs → Courses → Staff → Students)
                </label>
                <select
                  value={entityType}
                  onChange={(e) => {
                    setEntityType(e.target.value as MigrationEntityType)
                    setStagedRows([])
                    setCommitResult(null)
                    setErrorMsg(null)
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {ENTITY_ORDER.map((type) => (
                    <option key={type} value={type}>
                      {CSV_TEMPLATES[type].label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1.5">{template.description}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">2. Conflict Behavior</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setImportMode('SAFE')}
                    className={`px-3 py-2 rounded-md border text-xs font-medium transition ${
                      importMode === 'SAFE'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Safe Mode (New Only)
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('OVERWRITE')}
                    className={`px-3 py-2 rounded-md border text-xs font-medium transition ${
                      importMode === 'OVERWRITE'
                        ? 'border-amber-600 bg-amber-50 text-amber-800'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Overwrite Mode
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {importMode === 'SAFE'
                    ? 'Skips records already in the database so re-running imports is strictly idempotent.'
                    : 'Updates existing matching records in place by UUID while inserting new rows.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => downloadCsvTemplate(entityType)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
              >
                <Download className="h-4 w-4" />
                Download {entityType} CSV Template
              </button>

              {canManage && (
                <label className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium cursor-pointer">
                  <Upload className="h-4 w-4" />
                  {isValidating ? 'Validating CSV...' : 'Upload & Validate CSV'}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChange}
                    disabled={isValidating || isCommitting}
                    className="hidden"
                  />
                </label>
              )}

              {fileName && <span className="text-xs font-mono text-slate-600">Loaded: {fileName}</span>}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMsg}
            </div>
          )}

          {commitResult && (
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                <span>
                  Migration finished with status <strong>{commitResult.status}</strong> —{' '}
                  <strong>{commitResult.importedRows}</strong> imported, <strong>{commitResult.skippedRows}</strong>{' '}
                  skipped, <strong>{commitResult.errorRows}</strong> errors.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('JOBS')}
                className="underline font-semibold text-emerald-800"
              >
                View Job &amp; Errors →
              </button>
            </div>
          )}

          {stagedRows.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 shadow-xs space-y-4 p-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('ALL')}
                    className={`px-3 py-1.5 rounded-full font-medium ${
                      previewFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    All ({stagedRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('VALID')}
                    className={`px-3 py-1.5 rounded-full font-medium ${
                      previewFilter === 'VALID' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    Valid New ({validCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('DUPLICATE')}
                    className={`px-3 py-1.5 rounded-full font-medium ${
                      previewFilter === 'DUPLICATE' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    Duplicates ({dupCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('ERROR')}
                    className={`px-3 py-1.5 rounded-full font-medium ${
                      previewFilter === 'ERROR' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700'
                    }`}
                  >
                    Errors ({errCount})
                  </button>
                </div>

                {canManage && (
                  <button
                    type="button"
                    onClick={handleCommit}
                    disabled={isCommitting}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                  >
                    <Play className="h-4 w-4" />
                    {isCommitting && progress
                      ? `Importing ${progress.done} / ${progress.total}...`
                      : `Commit Import (${importMode})`}
                  </button>
                )}
              </div>

              <div className="overflow-x-auto max-h-[460px] border border-slate-200 rounded-md">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 uppercase text-slate-500 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Key</th>
                      <th className="px-3 py-2">Normalized Preview</th>
                      <th className="px-3 py-2">Validation Messages</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPreview.slice(0, 200).map((row) => (
                      <tr key={row.rowNumber} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-slate-500">#{row.rowNumber}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              row.status === 'VALID'
                                ? 'bg-emerald-50 text-emerald-700'
                                : row.status === 'DUPLICATE'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-800">{row.sourceKey}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-600 max-w-md truncate">
                          {JSON.stringify(row.normalizedPayload)}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.messages.length === 0 ? 'Ready to import' : row.messages.join(' ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredPreview.length > 200 && (
                <p className="text-[11px] text-slate-500">
                  Showing first 200 of {filteredPreview.length} staged rows in preview. All {stagedRows.length} rows will be processed on commit.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
