import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Store, Receipt, BookOpen, Camera, CreditCard } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess } from '@/app/rbac'
import type { ExamCycle } from '@/types/exams'
import type { StudentFrontOfficeRecord } from '@/types/frontOffice'
import { CashBookTab } from './CashBookTab'
import { CourseRegistrationTab } from './CourseRegistrationTab'
import { PhotoBoothTab } from './PhotoBoothTab'
import { TempIdEngineTab } from './TempIdEngineTab'
import { cn } from '@/utils/cn'

type FrontOfficeTab = 'cash-book' | 'registrations' | 'photo-booth' | 'temp-ids'

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function FrontOfficePage() {
  const [activeTab, setActiveTab] = useState<FrontOfficeTab>('cash-book')
  const {
    context,
    activeInstitutionId,
    activeExamCycleId,
    platformRoles,
    memberships,
    previewTier,
  } = useAppStore()

  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  const { data: programs = [] } = useQuery<Array<{ id: string; code: string; name: string }>>({
    queryKey: ['front_office_programs', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('programs')
        .select('id, code, name')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .order('code')
      if (error) throw error
      return (data ?? []) as Array<{ id: string; code: string; name: string }>
    },
  })

  const { data: cycles = [] } = useQuery<ExamCycle[]>({
    queryKey: ['exam_cycles', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_cycles')
        .select('*')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .order('is_default_active', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ExamCycle[]
    },
  })

  // Paginated student index so all 2,566+ AMCEC records load cleanly
  const { data: students = [], isLoading: loadingStudents } = useQuery<StudentFrontOfficeRecord[]>({
    queryKey: ['front_office_students', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    staleTime: 60_000,
    queryFn: async () => {
      const collected: StudentFrontOfficeRecord[] = []
      const pageSize = 1000
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('students')
          .select(`
            id, registration_number, admission_number, full_name,
            photo_url, photo_pin, photo_upload_count, last_photo_upload,
            student_enrollments (
              program_id, current_period_id, student_category, is_current,
              programs (code, name, program_level),
              academic_periods (sequence_number, legacy_semester_id),
              academic_sections (section_name),
              program_specializations (code),
              academic_batches (scheme_batch)
            )
          `)
          .eq('institution_id', activeInstitutionId!)
          .is('deleted_at', null)
          .order('registration_number', { ascending: true })
          .range(from, from + pageSize - 1)
        if (error) throw error
        const rows = data ?? []
        for (const r of rows) {
          const enrollments = (r.student_enrollments as Array<Record<string, unknown>>) ?? []
          const cur = enrollments.find((e) => e.is_current) ?? enrollments[0] ?? null
          const prog = cur
            ? unwrap(
                cur.programs as
                  | { code: string; name: string; program_level: string }
                  | { code: string; name: string; program_level: string }[]
                  | null
              )
            : null
          const per = cur
            ? unwrap(
                cur.academic_periods as
                  | { sequence_number: number; legacy_semester_id: number | null }
                  | { sequence_number: number; legacy_semester_id: number | null }[]
                  | null
              )
            : null
          const sec = cur
            ? unwrap(cur.academic_sections as { section_name: string } | { section_name: string }[] | null)
            : null
          const spec = cur
            ? unwrap(cur.program_specializations as { code: string } | { code: string }[] | null)
            : null
          const batch = cur
            ? unwrap(cur.academic_batches as { scheme_batch: number } | { scheme_batch: number }[] | null)
            : null

          collected.push({
            id: r.id as string,
            registration_number: r.registration_number as string,
            admission_number: (r.admission_number as string | null) ?? null,
            full_name: r.full_name as string,
            photo_url: (r.photo_url as string | null) ?? null,
            photo_pin: (r.photo_pin as string | null) ?? null,
            photo_upload_count: Number(r.photo_upload_count ?? 0),
            last_photo_upload: (r.last_photo_upload as string | null) ?? null,
            program_id: (cur?.program_id as string | null) ?? null,
            program_code: prog?.code ?? 'GEN',
            program_name: prog?.name ?? 'General',
            program_level: prog?.program_level ?? 'UG',
            current_period_id: (cur?.current_period_id as string | null) ?? null,
            current_sem: Number(per?.legacy_semester_id ?? per?.sequence_number ?? 1),
            section_name: sec?.section_name ?? null,
            student_category: String(cur?.student_category ?? 'REGULAR'),
            specialization_code: spec?.code ?? 'GENERAL',
            scheme_batch: batch?.scheme_batch ?? null,
          })
        }
        if (rows.length < pageSize) break
        from += pageSize
      }
      return collected
    },
  })

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <Store className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to access the Cash Book, Course Registrations, Photo Booth, and
          Temp ID Card Engine.
        </p>
      </div>
    )
  }

  const activeCycle = cycles.find((c) => c.id === activeExamCycleId) ?? cycles[0] ?? null
  const isReadOnlyManagement = access.effectiveTier === 'MANAGEMENT'
  const canApproveCreditOverride = access.effectiveTier === 'ALL' || access.effectiveTier === 'LEAD_TEAM'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Front Office &amp; Student Desk</h1>
          <p className="text-sm text-slate-500">
            Unified Cash Book (UTR Desk), Phase 1 &amp; Special Cycle Registrations (Summer / ODE), Student Photo
            Booth, and A4 3×4 Barcode Temp ID Cards.
          </p>
        </div>
        <span className="text-xs text-slate-500">
          {loadingStudents ? 'Indexing student roster...' : `${students.length.toLocaleString('en-IN')} active students indexed`}
        </span>
      </div>

      <div className="border-b border-slate-200 flex gap-6 text-sm overflow-x-auto">
        {(
          [
            { id: 'cash-book', label: 'Cash Book & UTR', icon: Receipt },
            { id: 'registrations', label: 'Course / Summer / ODE', icon: BookOpen },
            { id: 'photo-booth', label: 'Student Photo Booth', icon: Camera },
            { id: 'temp-ids', label: 'Temp ID Engine (A4 3×4)', icon: CreditCard },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'pb-2.5 font-medium border-b-2 transition whitespace-nowrap inline-flex items-center gap-1.5',
              activeTab === id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'cash-book' && (
        <CashBookTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          students={students}
          programs={programs}
          canRecordReceipts={!isReadOnlyManagement}
        />
      )}
      {activeTab === 'registrations' && (
        <CourseRegistrationTab
          institutionId={activeInstitutionId}
          cycle={activeCycle}
          students={students}
          canManage={!isReadOnlyManagement}
          canApproveCreditOverride={canApproveCreditOverride}
        />
      )}
      {activeTab === 'photo-booth' && (
        <PhotoBoothTab
          institutionId={activeInstitutionId}
          students={students}
          canManagePhotos={!isReadOnlyManagement}
        />
      )}
      {activeTab === 'temp-ids' && (
        <TempIdEngineTab
          institutionId={activeInstitutionId}
          students={students}
          programs={programs}
        />
      )}
    </div>
  )
}
