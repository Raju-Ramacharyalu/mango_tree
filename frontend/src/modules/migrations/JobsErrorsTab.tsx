import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Eye, Play, RefreshCw, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  ImportMode,
  MigrationEntityType,
  MigrationErrorRecord,
  MigrationJobRecord,
} from '@/types/migrations'
import { reprocessMigrationErrorRow } from './migrationEngine'

export function JobsErrorsTab({ institutionId, canManage }: { institutionId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const { profile } = useAppStore()

  const [selectedJob, setSelectedJob] = useState<MigrationJobRecord | null>(null)
  const [editingError, setEditingError] = useState<MigrationErrorRecord | null>(null)
  const [jsonDraft, setJsonDraft] = useState('')
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: jobs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['migration-jobs', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('migration_jobs')
        .select('*')
        .eq('institution_id', institutionId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as MigrationJobRecord[]
    },
  })

  const { data: jobErrors = [], isLoading: loadingErrors } = useQuery({
    queryKey: ['migration-errors', selectedJob?.id],
    enabled: Boolean(selectedJob?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('migration_errors')
        .select('*')
        .eq('job_id', selectedJob!.id)
        .order('row_number')
      if (error) throw error
      return (data ?? []) as MigrationErrorRecord[]
    },
  })

  const ignoreErrorMutation = useMutation({
    mutationFn: async (errRow: MigrationErrorRecord) => {
      const { error } = await supabase
        .from('migration_errors')
        .update({
          resolution_status: 'IGNORED',
          resolved_by: profile?.id ?? null,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', errRow.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migration-errors', selectedJob?.id] })
    },
  })

  const reprocessMutation = useMutation({
    mutationFn: async () => {
      setActionError(null)
      setActionMessage(null)
      if (!selectedJob || !editingError) return
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(jsonDraft) as Record<string, unknown>
      } catch {
        throw new Error('Corrected payload must be valid JSON.')
      }
      await reprocessMigrationErrorRow({
        institutionId,
        errorId: editingError.id,
        jobId: selectedJob.id,
        entityType: selectedJob.entity_type as MigrationEntityType,
        importMode: selectedJob.import_mode as ImportMode,
        correctedPayload: parsed,
        actorUserId: profile?.id ?? null,
      })
    },
    onSuccess: () => {
      setEditingError(null)
      setActionMessage('Row reprocessed successfully and recorded in migration mappings.')
      queryClient.invalidateQueries({ queryKey: ['migration-errors', selectedJob?.id] })
      queryClient.invalidateQueries({ queryKey: ['migration-jobs', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['reconciliation-stats', institutionId] })
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : 'Reprocessing failed'),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">
          Every CSV upload creates an auditable job with source-vs-target counts and error resolution tracking.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh Jobs
        </button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-x-auto">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading migration jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No migration jobs executed yet. Upload a CSV in the Import &amp; Stage tab to begin.
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Entity / File</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Counts (Total / Imported / Skipped / Errors)</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-mono font-semibold text-slate-800">{job.entity_type}</p>
                    <p className="text-slate-500">{job.file_name ?? 'Untitled CSV'}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">{job.import_mode}</td>
                  <td className="px-4 py-3 font-mono">
                    <span className="text-slate-700">{job.total_rows}</span> /{' '}
                    <span className="text-emerald-700 font-semibold">{job.imported_rows}</span> /{' '}
                    <span className="text-amber-700">{job.skipped_rows}</span> /{' '}
                    <span className={job.error_rows > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}>
                      {job.error_rows}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        job.status === 'COMPLETED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : job.status === 'COMPLETED_WITH_ERRORS'
                            ? 'bg-amber-50 text-amber-700'
                            : job.status === 'FAILED'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null)
                        setActionMessage(null)
                        setSelectedJob(job)
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-100"
                    >
                      <Eye className="h-3.5 w-3.5" /> Errors ({job.error_rows})
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-4xl max-h-[88vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Job Errors — {selectedJob.entity_type} ({selectedJob.file_name})
                </h2>
                <p className="text-xs text-slate-500">
                  Total: {selectedJob.total_rows} · Imported: {selectedJob.imported_rows} · Skipped:{' '}
                  {selectedJob.skipped_rows} · Errors: {selectedJob.error_rows}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedJob(null)
                  setEditingError(null)
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {actionMessage && (
                <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> {actionMessage}
                </div>
              )}
              {actionError && (
                <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> {actionError}
                </div>
              )}

              {loadingErrors ? (
                <p className="text-xs text-slate-500">Loading error records...</p>
              ) : jobErrors.length === 0 ? (
                <p className="text-sm text-emerald-700 bg-emerald-50 p-4 rounded">
                  Zero errors recorded for this migration job.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
                  {jobErrors.map((errRow) => (
                    <div key={errRow.id} className="p-3.5 space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="font-mono font-semibold text-slate-800">Row #{errRow.row_number}</span>
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                            {errRow.resolution_status}
                          </span>
                          <p className="text-red-700 mt-1">{errRow.error_message}</p>
                        </div>
                        {canManage && errRow.resolution_status === 'OPEN' && (
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null)
                                setEditingError(errRow)
                                setJsonDraft(JSON.stringify(errRow.raw_payload ?? {}, null, 2))
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                              <Play className="h-3 w-3" /> Correct &amp; Reprocess
                            </button>
                            <button
                              type="button"
                              onClick={() => ignoreErrorMutation.mutate(errRow)}
                              className="px-2.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                            >
                              Ignore
                            </button>
                          </div>
                        )}
                      </div>

                      {editingError?.id === errRow.id ? (
                        <div className="space-y-2 bg-slate-50 p-3 rounded border border-slate-200">
                          <label className="block font-medium text-slate-700">
                            Edit Row Payload JSON and Reprocess:
                          </label>
                          <textarea
                            rows={6}
                            value={jsonDraft}
                            onChange={(e) => setJsonDraft(e.target.value)}
                            className="w-full font-mono text-xs rounded border border-slate-300 bg-white p-2"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingError(null)}
                              className="px-3 py-1 rounded border border-slate-300 text-slate-700"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => reprocessMutation.mutate()}
                              disabled={reprocessMutation.isPending}
                              className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50"
                            >
                              {reprocessMutation.isPending ? 'Reprocessing...' : 'Submit & Reprocess'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <pre className="bg-slate-900 text-slate-100 p-2 rounded overflow-x-auto text-[11px]">
                          {JSON.stringify(errRow.raw_payload ?? {}, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
