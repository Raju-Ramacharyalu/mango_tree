import { useQuery } from '@tanstack/react-query'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase } from '@/services/supabase'
import type { AnalyticsOverviewData } from '@/types/analytics'

export function InstitutionalOverviewTab({ institutionId }: { institutionId: string }) {
  const { data, isLoading, error } = useQuery<AnalyticsOverviewData>({
    queryKey: ['analytics_overview', institutionId],
    queryFn: async () => {
      const { data: res, error: err } = await supabase.rpc('get_analytics_overview', {
        p_institution_id: institutionId,
      })
      if (err) throw err
      return res as AnalyticsOverviewData
    },
  })

  if (isLoading) return <div className="py-10 text-center text-xs text-slate-500">Compiling institutional demographics...</div>
  if (error) return <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-700">{(error as Error).message}</div>
  if (!data) return null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Official Active Students</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{data.total_students.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">UG Students</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1">{data.ug_count.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">PG Students</p>
          <p className="text-2xl font-bold text-purple-700 mt-1">{data.pg_count.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Active / Closed Cycles</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">
            {data.active_cycles} <span className="text-sm font-normal text-slate-400">/ {data.closed_cycles}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Students by Branch</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.branch_counts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="branch" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Exam Cycles Lifecycle Status</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.cycle_statuses}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
