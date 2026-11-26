import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, RefreshCw, Search, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { AuditLogRecord } from '@/types/users'

function getSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function AuditLogsPage() {
  const { context, activeInstitutionId } = useAppStore()
  const [actionFilter, setActionFilter] = useState<string>('ALL')
  const [tableFilter, setTableFilter] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [inspectLog, setInspectLog] = useState<AuditLogRecord | null>(null)

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit-logs', context, activeInstitutionId, actionFilter],
    queryFn: async () => {
      let query = supabase
        .from('audit_logs')
        .select('id, institution_id, actor_user_id, table_name, record_id, action, old_data, new_data, created_at, institutions(id, code, name)')
        .order('created_at', { ascending: false })
        .limit(150)

      if (context === 'INSTITUTION' && activeInstitutionId) {
        query = query.eq('institution_id', activeInstitutionId)
      }
      if (actionFilter !== 'ALL') {
        query = query.eq('action', actionFilter)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as unknown as AuditLogRecord[]
    },
  })

  const { data: actorMap = new Map<string, { email: string; full_name: string }>() } = useQuery({
    queryKey: ['audit-actor-profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('id, email, full_name')
      const map = new Map<string, { email: string; full_name: string }>()
      for (const row of data ?? []) {
        map.set(row.id, { email: row.email, full_name: row.full_name })
      }
      return map
    },
  })

  const uniqueTables = Array.from(new Set(logs.map((l) => l.table_name))).sort()

  const filtered = logs.filter((l) => {
    if (tableFilter !== 'ALL' && l.table_name !== tableFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    const actor = l.actor_user_id ? actorMap.get(l.actor_user_id) : null
    const inst = getSingle(l.institutions)
    return (
      l.table_name.toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q) ||
      (actor?.email ?? '').toLowerCase().includes(q) ||
      (inst?.code ?? '').toLowerCase().includes(q) ||
      (l.record_id ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
          <p className="text-sm text-slate-500">
            Immutable, database-triggered activity history across administrative and master tables.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm text-slate-700"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by table, actor email, record ID..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="ALL">All Tables</option>
            {uniqueTables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="ALL">All Actions</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading audit logs...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No audit entries match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Table</th>
                  <th className="px-4 py-3">Institution</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((log) => {
                  const inst = getSingle(log.institutions)
                  const actor = log.actor_user_id ? actorMap.get(log.actor_user_id) : null
                  return (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                            log.action === 'INSERT'
                              ? 'bg-emerald-50 text-emerald-700'
                              : log.action === 'UPDATE'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-800">{log.table_name}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">{inst?.code ?? 'Platform'}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {actor ? actor.email : log.actor_user_id ? 'Auth User' : 'System / SQL'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setInspectLog(log)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 text-xs text-slate-700 hover:bg-slate-100"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Inspect
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {inspectLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-4xl max-h-[88vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {inspectLog.action} on <span className="font-mono">{inspectLog.table_name}</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Record ID: {inspectLog.record_id ?? 'N/A'} · {new Date(inspectLog.created_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectLog(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-semibold text-slate-700 mb-2">Previous State (old_data)</p>
                <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-96">
                  {inspectLog.old_data ? JSON.stringify(inspectLog.old_data, null, 2) : 'null (New Record)'}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-2">New State (new_data)</p>
                <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-96">
                  {inspectLog.new_data ? JSON.stringify(inspectLog.new_data, null, 2) : 'null (Deleted Record)'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
