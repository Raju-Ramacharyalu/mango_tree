import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield, Users, Activity, BookOpen, KeyRound, Package, Lock } from 'lucide-react'
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
import { SecurityVaultTab } from './SecurityVaultTab'
import { DispatchPackagerTab } from './DispatchPackagerTab'
import { cn } from '@/utils/cn'

type CoeVaultTab = 'security' | 'boe' | 'packager' | 'see-progress' | 'ia-vault'

function unwrap<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function QpVaultPage() {
  const {
    context,
    activeInstitutionId,
    activeExamCycleId,
    setActiveExamCycle,
    platformRoles,
    memberships,
    previewTier,
  } = useAppStore()

  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  const canCoeVault =
    access.effectiveTier === 'ALL' || (access.effectiveTier === 'LEAD_TEAM' && access.isCoeOrExecutiveLead)

  const [activeTab, setActiveTab] = useState<CoeVaultTab>('security')
  const [coePrivateKeyPem, setCoePrivateKeyPem] = useState(
    () => sessionStorage.getItem(`mt_coe_pem_${activeInstitutionId ?? ''}`) ?? ''
  )

  useEffect(() => {
    setCoePrivateKeyPem(sessionStorage.getItem(`mt_coe_pem_${activeInstitutionId ?? ''}`) ?? '')
  }, [activeInstitutionId])

  const { data: cycles = [] } = useQuery<ExamCycle[]>({
    queryKey: ['exam_cycles', activeInstitutionId],
    enabled: Boolean(activeInstitutionId && canCoeVault),
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
    enabled: Boolean(activeInstitutionId && canCoeVault),
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
    enabled: Boolean(activeInstitutionId && canCoeVault),
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
    enabled: Boolean(activeInstitutionId && canCoeVault),
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
    enabled: Boolean(activeInstitutionId && canCoeVault),
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
    enabled: Boolean(activeInstitutionId && activeCycle?.id && canCoeVault),
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
    enabled: Boolean(activeInstitutionId && activeCycle?.id && canCoeVault),
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
          Switch to <strong>Institution</strong> mode to open the COE QP Security Vault.
        </p>
      </div>
    )
  }

  if (!canCoeVault) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center space-y-2">
        <Lock className="h-8 w-8 text-amber-600 mx-auto" />
        <h1 className="text-lg font-semibold text-amber-950">COE Office Restricted Area</h1>
        <p className="text-sm text-amber-900 max-w-lg mx-auto">
          The Zero-Trust QP Security Vault (RSA-2048 <code>.pem</code> keys, SEE/IA decryption, and COE appointment
          selection) is strictly restricted to the <strong>Controller of Examinations (COE)</strong>,{' '}
          <strong>Principal</strong>, and <strong>Institution Admins</strong>. Department HODs &amp; BOE Chairs should
          use <strong>BOS, BOE &amp; CIE</strong> for IA Setter Allocations and BOE Setter Nominations.
        </p>
      </div>
    )
  }

  const instName = activeMembership?.institution.name ?? 'Institution'
  const instCode = activeMembership?.institution.code ?? 'INST'

  const tabs: Array<{ id: CoeVaultTab; label: string; icon: typeof KeyRound }> = [
    { id: 'security', label: 'Security Vault (.pem)', icon: KeyRound },
    { id: 'boe', label: 'COE BOE Selection & Orders', icon: Users },
    { id: 'packager', label: 'Dispatch & Packager', icon: Package },
    { id: 'see-progress', label: 'SEE Progress & Decrypt', icon: Activity },
    { id: 'ia-vault', label: 'IA Vault Decrypt & OMR Keys', icon: BookOpen },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">COE · Zero-Trust QP Security Vault</h1>
          <p className="text-sm text-slate-500">
            Strictly COE Office: RSA-2048 key management, confidential BOE setter selection &amp; mail-merge dispatch,
            SEE decryption, and submitted IA paper / OMR key extraction.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {cycles.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Exam Cycle:</label>
              <select
                value={activeCycle?.id ?? ''}
                onChange={(e) => setActiveExamCycle(e.target.value || null)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 max-w-xs"
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.status === 'ARCHIVED' || c.status === 'COMPLETED' ? '[Archived] ' : c.is_default_active ? '★ ' : ''}
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold',
              coePrivateKeyPem
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            )}
          >
            {coePrivateKeyPem
              ? '🔓 Vault Unlocked'
              : vaultKey
                ? `🔒 Locked (${vaultKey.key_fingerprint})`
                : 'Vault Key Not Generated'}
          </span>
        </div>
      </div>

      <div className="border-b border-slate-200 flex gap-6 text-sm overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
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
      {activeTab === 'boe' && (
        <BoeAppointmentsTab
          institutionId={activeInstitutionId}
          institutionName={instName}
          cycle={activeCycle}
          courses={courses}
          staff={staff}
          nominations={nominations}
          canNominate={canCoeVault}
          canCoeApprove={canCoeVault}
        />
      )}
      {activeTab === 'packager' && (
        <DispatchPackagerTab
          institutionName={instName}
          cycle={activeCycle}
          courses={courses}
          nominations={nominations}
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
          mode="COE_VAULT"
        />
      )}
    </div>
  )
}
