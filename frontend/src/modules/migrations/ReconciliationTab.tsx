import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Search } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { MigrationAuditRecord } from '@/types/migrations'

interface StudentPreviewRow {
  id: string
  registration_number: string
  admission_number: string | null
  full_name: string
  email: string | null
  is_temporary_registration: boolean
  student_enrollments: Array<{
    enrollment_status: string
    student_category: string
    programs: { code: string } | { code: string }[] | null
    academic_periods: { code: string } | { code: string }[] | null
    program_specializations: { code: string } | { code: string }[] | null
  }> | null
}

function getSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function ReconciliationTab({ institutionId }: { institutionId: string }) {
  const [studentSearch, setStudentSearch] = useState('')

  const { data: counts, refetch, isFetching } = useQuery({
    queryKey: ['reconciliation-stats', institutionId],
    queryFn: async () => {
      const [units, programs, catalog, curricula, staff, students, enrollments, mappings] = await Promise.all([
        supabase.from('academic_units').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).is('deleted_at', null),
        supabase.from('programs').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).is('deleted_at', null),
        supabase.from('course_catalog').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).is('deleted_at', null),
        supabase.from('curriculum_courses').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
        supabase.from('staff_profiles').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).is('deleted_at', null),
        supabase.from('students').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).is('deleted_at', null),
        supabase.from('student_enrollments').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId).eq('is_current', true),
        supabase.from('migration_mappings').select('id', { count: 'exact', head: true }).eq('institution_id', institutionId),
      ])
      return [
        { label: 'Academic Units', value: units.count ?? 0 },
        { label: 'Programs', value: programs.count ?? 0 },
        { label: 'Course Catalog', value: catalog.count ?? 0 },
        { label: 'Curriculum Mappings', value: curricula.count ?? 0 },
        { label: 'Staff Profiles', value: staff.count ?? 0 },
        { label: 'Students', value: students.count ?? 0 },
        { label: 'Active Enrollments', value: enrollments.count ?? 0 },
        { label: 'Idempotency Mappings', value: mappings.count ?? 0 },
      ]
    },
  })

  const { data: recentStudents = [] } = useQuery({
    queryKey: ['reconciliation-students', institutionId, studentSearch],
    queryFn: async () => {
      let q = supabase
        .from('students')
        .select(`
          id,
          registration_number,
          admission_number,
          full_name,
          email,
          is_temporary_registration,
          student_enrollments (
            enrollment_status,
            student_category,
            programs (code),
            academic_periods (code),
            program_specializations (code)
          )
        `)
        .eq('institution_id', institutionId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50)

      if (studentSearch.trim()) {
        const term = studentSearch.trim()
        q = q.or(`registration_number.ilike.%${term}%,full_name.ilike.%${term}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as StudentPreviewRow[]
    },
  })

  const { data: migrationAudit = [] } = useQuery({
    queryKey: ['migration-audit-history', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('migration_audit_log')
        .select('*')
        .eq('institution_id', institutionId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as MigrationAuditRecord[]
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">
          Compare live PostgreSQL target counts against your legacy AMC CSV source totals to verify zero record loss.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh Counts
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {(counts ?? []).map((item) => (
          <div key={item.label} className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{item.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Imported Students Reconciliation Preview (Latest 50)</h2>
          <div className="relative max-w-xs w-full">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search USN or name..."
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5">Reg No / USN</th>
                <th className="px-4 py-2.5">Student Name</th>
                <th className="px-4 py-2.5">Program / Period</th>
                <th className="px-4 py-2.5">Track / Category</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {recentStudents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No students imported for this institution yet.
                  </td>
                </tr>
              ) : (
                recentStudents.map((st) => {
                  const enr = st.student_enrollments?.[0]
                  return (
                    <tr key={st.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-slate-800">{st.registration_number}</span>
                        {st.admission_number && (
                          <p className="text-[10px] text-slate-400 font-mono">Prev: {st.admission_number}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{st.full_name}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-600">
                        {getSingle(enr?.programs)?.code ?? '—'} · {getSingle(enr?.academic_periods)?.code ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {getSingle(enr?.program_specializations)?.code ?? 'GENERAL'} · {enr?.student_category ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            enr?.enrollment_status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {enr?.enrollment_status ?? 'NO ENROLLMENT'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Migration Audit History</h2>
        {migrationAudit.length === 0 ? (
          <p className="text-xs text-slate-500">No migration audit events logged yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-xs">
            {migrationAudit.map((item) => (
              <li key={item.id} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div>
                  <span className="font-mono font-semibold text-indigo-700">{item.action}</span>
                  <span className="text-slate-600 ml-2">{JSON.stringify(item.details)}</span>
                </div>
                <span className="text-slate-400 whitespace-nowrap">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
