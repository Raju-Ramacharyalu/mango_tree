import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, Users, Activity, BookOpen, PenTool, KeyRound } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess } from '@/app/rbac'
import type { ExamCycle } from '@/types/exams'
import type {
  BoeNominationRow,
  IaQpAllocationRow,
  InstitutionVaultKey,
  SeeSubmittedPaperRow,
} from '@/types/qpVault'
import { BoeAppointmentsTab } from './BoeAppointmentsTab'
import { SeeProgressTab } from './SeeProgressTab'
import { IaVaultAllocationsTab } from './IaVaultAllocationsTab'
import { FacultyIaDrafterTab } from './FacultyIaDrafterTab'
import { SecurityVaultTab } from './SecurityVaultTab'
import { cn } from '@/utils/cn'

type QpVaultTab = 'boe' | 'see-progress' | 'ia-vault' | 'faculty-ia' | 'security'

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function QpVaultPage() {
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

  const canCoeVault = access.effectiveTier === 'ALL' || (access.effectiveTier === 'LEAD_TEAM' && access.isCoeOrExecutiveLead)
  const canLeadNominate = access.effectiveTier === 'ALL' || access.effectiveTier === 'LEAD_TEAM'

  const visibleTabs = useMemo(() => {
    const tabs: Array<{ id: QpVaultTab; label: string; icon: typeof Users }> = []
    if (canLeadNominate) tabs.push({ id: 'boe', label: 'BOE Appointments', icon: Users })
    if (canCoeVault) {
      tabs.push({ id: 'see-progress', label: 'SEE Progress & Decrypt', icon: Activity })
      tabs.push({ id: 'ia-vault', label: 'IA Allocations & OMR Keys', icon: BookOpen })
    }
    tabs.push({ id: 'faculty-ia', label: 'Faculty IA Drafter', icon: PenTool })
    if (canCoeVault) tabs.push({ id: 'security', label: 'Security Vault (.pem)', icon: KeyRound })
    return tabs
  }, [canLeadNominate, canCoeVault])

  const [activeTab, setActiveTab] = useState<QpVaultTab>('boe')
  const [coePrivateKeyPem, setCoePrivateKeyPem] = useState(
    () => sessionStorage.getItem(`mt_coe_pem_${activeInstitutionId ?? ''}`) ?? ''
  )

  useEffect(() => {
    setCoePrivateKeyPem(sessionStorage.getItem(`mt_coe_pem_${activeInstitutionId ?? ''}`) ?? '')
  }, [activeInstitutionId])

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id)
    }
  }, [visibleTabs, activeTab])

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

  const activeCycle = cycles.find((c) => c.id === activeExamCycleId) ?? cycles[0] ?? null

  const { data: vaultKey = null } = useQuery<InstitutionVaultKey | null>({
    queryKey: ['institution_vault_key', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_vault_keys')
        .select('*')
        .eq('institution_id', activeInstitutionId!)
        .maybeSingle()
      if (error) throw error
      return (data as InstitutionVaultKey | null) ?? null
    },
  })

  const { data: courses = [] } = useQuery<
    Array<{ id: string; course_code: string; title: string; course_type: string }>
  >({
    queryKey: ['qp_vault_courses', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_catalog')
        .select('id, course_code, title, course_categories(code)')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('course_code')
      if (error) throw error
      return (data ?? []).map((c) => {
        const cat = unwrap(c.course_categories as { code: string } | { code: string }[] | null)
        return {
          id: c.id as string,
          course_code: c.course_code as string,
          title: c.title as string,
          course_type: cat?.code ?? 'THEORY',
        }
      })
    },
  })

  const { data: staff = [] } = useQuery<
    Array<{
      id: string
      employee_code: string
      full_name: string
      email: string | null
      designation: string
      department_label: string | null
      branch_label: string | null
    }>
  >({
    queryKey: ['qp_vault_staff', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, employee_code, full_name, email, designation, department_label, branch_label')
        .eq('institution_id', activeInstitutionId!)
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as Array<{
        id: string
        employee_code: string
        full_name: string
        email: string | null
        designation: string
        department_label: string | null
        branch_label: string | null
      }>
    },
  })

  const { data: sectionTeachers = [] } = useQuery<Array<{ course_code: string; staff_profile_id: string }>>({
    queryKey: ['qp_vault_section_teachers', activeInstitutionId],
    enabled: Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_section_allocations')
        .select('course_code, staff_profile_id')
        .eq('institution_id', activeInstitutionId!)
        .eq('is_active', true)
      if (error) throw error
      return (data ?? []) as Array<{ course_code: string; staff_profile_id: string }>
    },
  })

  const sectionTeacherMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const row of sectionTeachers) {
      const list = map.get(row.course_code) ?? []
      if (!list.includes(row.staff_profile_id)) list.push(row.staff_profile_id)
      map.set(row.course_code, list)
    }
    return map
  }, [sectionTeachers])

  const { data: nominations = [] } = useQuery<BoeNominationRow[]>({
    queryKey: ['boe_nominations', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id && canLeadNominate),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('boe_nominations')
        .select('*')
        .eq('institution_id', activeInstitutionId!)
        .eq('exam_cycle_id', activeCycle!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BoeNominationRow[]
    },
  })

  const { data: submittedPapers = [] } = useQuery<SeeSubmittedPaperRow[]>({
    queryKey: ['see_submitted_papers', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id && canCoeVault),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('see_submitted_papers')
        .select('*')
        .eq('institution_id', activeInstitutionId!)
        .eq('exam_cycle_id', activeCycle!.id)
        .order('submitted_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SeeSubmittedPaperRow[]
    },
  })

  const { data: iaAllocations = [] } = useQuery<IaQpAllocationRow[]>({
    queryKey: ['ia_qp_allocations', activeInstitutionId, activeCycle?.id],
    enabled: Boolean(activeInstitutionId && activeCycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ia_qp_allocations')
        .select(`
          id, institution_id, exam_cycle_id, course_id, course_code, staff_profile_id, faculty_code,
          ia_number, num_sets, qp_pattern, max_marks, duration_minutes, qp_content, status, updated_at,
          course_catalog (title, course_categories(code)),
          staff_profiles (full_name)
        `)
        .eq('institution_id', activeInstitutionId!)
        .eq('exam_cycle_id', activeCycle!.id)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((row) => {
        const cc = unwrap(
          row.course_catalog as
            | { title: string; course_categories: { code: string } | { code: string }[] | null }
            | { title: string; course_categories: { code: string } | { code: string }[] | null }[]
            | null
        )
        const cat = cc ? unwrap(cc.course_categories) : null
        const st = unwrap(row.staff_profiles as { full_name: string } | { full_name: string }[] | null)
        return {
          id: row.id as string,
          institution_id: row.institution_id as string,
          exam_cycle_id: row.exam_cycle_id as string,
          course_id: row.course_id as string,
          course_code: row.course_code as string,
          course_title: cc?.title ?? (row.course_code as string),
          course_type: cat?.code ?? 'THEORY',
          staff_profile_id: row.staff_profile_id as string,
          faculty_code: row.faculty_code as string,
          faculty_name: st?.full_name ?? (row.faculty_code as string),
          ia_number: Number(row.ia_number) as 1 | 2 | 3,
          num_sets: Number(row.num_sets ?? 1),
          qp_pattern: row.qp_pattern as 'DESCRIPTIVE' | 'OMR_50' | 'OMR_25',
          max_marks: Number(row.max_marks ?? 50),
          duration_minutes: Number(row.duration_minutes ?? 90),
          qp_content: (row.qp_content as string | null) ?? null,
          status: row.status as 'DRAFT' | 'SUBMITTED',
          updated_at: row.updated_at as string,
        }
      })
    },
  })

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <Shield className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to manage BOE Appointments and Zero-Trust Question Paper Vaults.
        </p>
      </div>
    )
  }

  const instName = activeMembership?.institution.name ?? 'Institution'
  const instCode = activeMembership?.institution.code ?? 'INST'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">BOE Appointments &amp; Zero-Trust QP Vault</h1>
          <p className="text-sm text-slate-500">
            Per-tenant RSA-2048 encrypted SEE &amp; IA question paper lifecycle ({activeCycle?.code ?? 'No cycle selected'}).
          </p>
        </div>
        <span className="text-xs font-medium text-slate-500">
          {vaultKey ? `Vault Key: ${vaultKey.key_fingerprint}` : 'Vault Key Not Generated'}
        </span>
      </div>

      <div className="border-b border-slate-200 flex gap-6 text-sm overflow-x-auto">
        {visibleTabs.map(({ id, label, icon: Icon }) => (
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

      {activeTab === 'boe' && (
        <BoeAppointmentsTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          cycle={activeCycle}
          courses={courses}
          staff={staff}
          nominations={nominations}
          canNominate={canLeadNominate}
          canCoeApprove={canCoeVault}
        />
      )}
      {activeTab === 'see-progress' && (
        <SeeProgressTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          nominations={nominations}
          submittedPapers={submittedPapers}
          coePrivateKeyPem={coePrivateKeyPem}
        />
      )}
      {activeTab === 'ia-vault' && (
        <IaVaultAllocationsTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          cycle={activeCycle}
          courses={courses}
          staff={staff}
          sectionTeacherMap={sectionTeacherMap}
          allocations={iaAllocations}
          coePrivateKeyPem={coePrivateKeyPem}
          canManage={canCoeVault}
        />
      )}
      {activeTab === 'faculty-ia' && (
        <FacultyIaDrafterTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          publicKeyPem={vaultKey?.public_key_pem ?? null}
          allocations={iaAllocations}
        />
      )}
      {activeTab === 'security' && (
        <SecurityVaultTab
          institutionId={activeInstitutionId}
          institutionCode={instCode}
          vaultKey={vaultKey}
          coePrivateKeyPem={coePrivateKeyPem}
          onLoadPrivateKey={(pem) => {
            setCoePrivateKeyPem(pem)
            sessionStorage.setItem(`mt_coe_pem_${activeInstitutionId}`, pem)
          }}
          onClearPrivateKey={() => {
            setCoePrivateKeyPem('')
            sessionStorage.removeItem(`mt_coe_pem_${activeInstitutionId}`)
          }}
          canManageVault={canCoeVault}
        />
      )}
    </div>
  )
}
