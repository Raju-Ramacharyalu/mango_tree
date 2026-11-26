import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'

interface InstitutionRow {
  id: string
  status: string
  institution_categories: { name: string } | { name: string }[] | null
}

interface MigrationJobRow {
  id: string
  entity_type: string
  status: string
  file_name: string | null
  imported_rows: number
  error_rows: number
  created_at: string
}

interface AuditLogRow {
  id: string
  table_name: string
  action: string
  created_at: string
}

export function DashboardPage() {
  const { context, activeInstitutionId } = useAppStore()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-overview', context, activeInstitutionId],
    queryFn: async () => {
      let instQuery = supabase
        .from('institutions')
        .select('id, status, institution_categories(name)')
        .is('deleted_at', null)

      let jobsQuery = supabase
        .from('migration_jobs')
        .select('id, entity_type, status, file_name, imported_rows, error_rows, created_at')
        .order('created_at', { ascending: false })
        .limit(5)

      let auditQuery = supabase
        .from('audit_logs')
        .select('id, table_name, action, created_at')
        .order('created_at', { ascending: false })
        .limit(6)

      if (context === 'INSTITUTION' && activeInstitutionId) {
        instQuery = instQuery.eq('id', activeInstitutionId)
        jobsQuery = jobsQuery.eq('institution_id', activeInstitutionId)
        auditQuery = auditQuery.eq('institution_id', activeInstitutionId)
      }

      const [instRes, usersRes, jobsRes, auditRes] = await Promise.all([
        instQuery,
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
        jobsQuery,
        auditQuery,
      ])

      const institutions = (instRes.data ?? []) as unknown as InstitutionRow[]
      const categoryCounts: Record<string, number> = {}
      for (const inst of institutions) {
        const cat = Array.isArray(inst.institution_categories)
          ? inst.institution_categories[0]?.name
          : inst.institution_categories?.name
        const label = cat ?? 'Uncategorized'
        categoryCounts[label] = (categoryCounts[label] ?? 0) + 1
      }

      return {
        totalInstitutions: institutions.length,
        activeInstitutions: institutions.filter((i) => i.status === 'ACTIVE').length,
        inactiveInstitutions: institutions.filter((i) => i.status !== 'ACTIVE').length,
        totalUsers: usersRes.count ?? 0,
        categoryDistribution: Object.entries(categoryCounts).map(([name, count]) => ({ name, count })),
        recentJobs: (jobsRes.data ?? []) as MigrationJobRow[],
        recentAudit: (auditRes.data ?? []) as AuditLogRow[],
      }
    },
  })

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading command center telemetry...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">
          {context === 'PLATFORM'
            ? 'Centralized overview across all registered institutions.'
            : 'Scoped operational overview for the selected institution.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Institutions', value: data?.totalInstitutions ?? 0 },
          { label: 'Active Institutions', value: data?.activeInstitutions ?? 0 },
          { label: 'Inactive / Suspended', value: data?.inactiveInstitutions ?? 0 },
          { label: 'Visible Users', value: data?.totalUsers ?? 0 },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{kpi.label}</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Institution Category Distribution</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.categoryDistribution ?? []}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent Administrative Activity</h2>
          {data?.recentAudit.length === 0 ? (
            <p className="text-xs text-slate-500">No administrative audit entries recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {data?.recentAudit.map((log) => (
                <li key={log.id} className="py-2 flex items-center justify-between">
                  <span className="font-medium text-slate-800">
                    {log.action} · <span className="font-mono text-slate-600">{log.table_name}</span>
                  </span>
                  <span className="text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="text-sm font-semibold text-slate-900 pt-2 border-t border-slate-100">
            Recent Imports &amp; Migration Jobs
          </h2>
          {data?.recentJobs.length === 0 ? (
            <p className="text-xs text-slate-500">No migration jobs executed yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs">
              {data?.recentJobs.map((job) => (
                <li key={job.id} className="py-2 flex items-center justify-between">
                  <span className="font-medium text-slate-800">
                    {job.entity_type} ({job.imported_rows} imported / {job.error_rows} errors)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">{job.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
