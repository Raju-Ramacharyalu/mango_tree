import { useQuery } from '@tanstack/react-query'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { ExamCycle } from '@/types/exams'
import type { CycleAnalyticsData } from '@/types/analytics'

export function CycleAnalyticsTab({
  institutionId,
  cycle,
}: {
  institutionId: string
  cycle: ExamCycle | null
}) {
  const { data, isLoading, error } = useQuery<CycleAnalyticsData>({
    queryKey: ['cycle_analytics', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data: res, error: err } = await supabase.rpc('get_cycle_analytics', {
        p_institution_id: institutionId,
        p_exam_cycle_id: cycle!.id,
      })
      if (err) throw err
      return res as CycleAnalyticsData
    },
  })

  if (!cycle) return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">Select an Exam Cycle in the sidebar.</div>
  if (isLoading) return <div className="py-10 text-center text-xs text-slate-500">Loading cycle analytics for {cycle.code}...</div>
  if (error) return <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-700">{(error as Error).message}</div>
  if (!data) return null

  return (
    <div className="space-y-5">
      {data.ghost_count > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-300 p-3 text-xs font-semibold text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          WARNING: Found {data.ghost_count} Ghost Student record(s) with exam marks missing from active master students.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total Evaluations</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{data.total_evals.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Pending / Missing Marks</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{data.pending_evals.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Overall Pass Rate</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{Number(data.pass_pct).toFixed(1)}%</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total Fails</p>
          <p className="text-2xl font-bold text-rose-700 mt-1">{data.failed_evals.toLocaleString('en-IN')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Grade Distribution ({cycle.code})</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.grade_distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="grade" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#9333ea" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Branch-wise Pass Rates (%)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.branch_pass_rates}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="branch" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="pass_pct" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
