import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Building2, MapPin, Pencil, Plus, Power, Save, Search, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type {
  Institution,
  InstitutionCategory,
  InstitutionSetting,
  InstitutionStatus,
  InstitutionType,
  Organization,
} from '@/types/institutions'
import { InstitutionCategoriesTab } from './InstitutionCategoriesTab'
import { CampusesPanel } from './CampusesPanel'

const instSchema = z.object({
  code: z.string().min(2, 'Institution code is required').max(24),
  name: z.string().min(2, 'Institution name is required'),
  short_name: z.string().optional().or(z.literal('')),
  category_id: z.string().uuid('Select a category'),
  organization_id: z.string().optional().or(z.literal('')),
  university_affiliation: z.string().optional().or(z.literal('')),
  institution_type: z.enum(['AUTONOMOUS', 'AFFILIATED', 'DEEMED', 'UNIVERSITY', 'STANDALONE']),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']),
  official_email: z.string().email('Invalid email').optional().or(z.literal('')),
  official_phone: z.string().optional().or(z.literal('')),
  website_url: z.string().optional().or(z.literal('')),
  address_line1: z.string().optional().or(z.literal('')),
  city: z.string().optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  postal_code: z.string().optional().or(z.literal('')),
})

type InstFormValues = z.infer<typeof instSchema>

const INST_TYPES: InstitutionType[] = ['AUTONOMOUS', 'AFFILIATED', 'DEEMED', 'UNIVERSITY', 'STANDALONE']
const INST_STATUSES: InstitutionStatus[] = ['ACTIVE', 'SUSPENDED', 'INACTIVE']

const DEFAULT_INSTITUTION_ROLES = [
  { code: 'INSTITUTION_ADMIN', name: 'Institution Administrator', is_system: true },
  { code: 'PRINCIPAL_DIRECTOR', name: 'Principal / Director', is_system: true },
  { code: 'EXAM_CONTROLLER', name: 'Examination Controller', is_system: true },
  { code: 'EXAM_STAFF', name: 'Examination Section Staff', is_system: true },
  { code: 'ACADEMIC_ADMIN', name: 'Academic Administrator', is_system: true },
  { code: 'DEPT_ADMIN', name: 'Department Administrator', is_system: true },
  { code: 'FACULTY', name: 'Faculty', is_system: true },
]

function getSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

function InstitutionSettingsView({ institutionId }: { institutionId: string }) {
  const queryClient = useQueryClient()
  const { platformRoles, memberships } = useAppStore()
  const activeMembership = memberships.find((m) => m.institution_id === institutionId)
  const canEdit =
    platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN') ||
    (activeMembership?.roles ?? []).some((r) =>
      ['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER'].includes(r)
    )

  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [defaultsNotice, setDefaultsNotice] = useState<string | null>(null)
  const [currentScheme, setCurrentScheme] = useState('2022 Scheme (NEP)')
  const [activeAy, setActiveAy] = useState('2026-27')
  const [activeTerm, setActiveTerm] = useState('ODD')

  const { data: institution, isLoading } = useQuery({
    queryKey: ['institution-detail', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase.from('institutions').select('*').eq('id', institutionId).single()
      if (error) throw error
      return data as Institution
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['institution-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as InstitutionCategory[]
    },
  })

  const { data: settings = [] } = useQuery({
    queryKey: ['institution-settings', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_settings')
        .select('*')
        .eq('institution_id', institutionId)
      if (error) throw error
      return (data ?? []) as InstitutionSetting[]
    },
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InstFormValues>({ resolver: zodResolver(instSchema) })

  useEffect(() => {
    if (institution) {
      reset({
        code: institution.code,
        name: institution.name,
        short_name: institution.short_name ?? '',
        category_id: institution.category_id,
        organization_id: institution.organization_id ?? '',
        university_affiliation: institution.university_affiliation ?? '',
        institution_type: institution.institution_type,
        status: institution.status,
        official_email: institution.official_email ?? '',
        official_phone: institution.official_phone ?? '',
        website_url: institution.website_url ?? '',
        address_line1: institution.address_line1 ?? '',
        city: institution.city ?? '',
        state: institution.state ?? '',
        postal_code: institution.postal_code ?? '',
      })
    }
  }, [institution, reset])

  useEffect(() => {
    const map = new Map(settings.map((s) => [s.setting_key, s.setting_value]))
    if (typeof map.get('current_scheme') === 'string') setCurrentScheme(map.get('current_scheme') as string)
    if (typeof map.get('active_academic_year') === 'string') setActiveAy(map.get('active_academic_year') as string)
    if (typeof map.get('active_term') === 'string') setActiveTerm(map.get('active_term') as string)
  }, [settings])

  const updateProfileMutation = useMutation({
    mutationFn: async (values: InstFormValues) => {
      setSaveNotice(null)
      const { error } = await supabase
        .from('institutions')
        .update({
          name: values.name.trim(),
          short_name: values.short_name?.trim() || null,
          category_id: values.category_id,
          university_affiliation: values.university_affiliation?.trim() || null,
          institution_type: values.institution_type,
          official_email: values.official_email?.trim() || null,
          official_phone: values.official_phone?.trim() || null,
          website_url: values.website_url?.trim() || null,
          address_line1: values.address_line1?.trim() || null,
          city: values.city?.trim() || null,
          state: values.state?.trim() || null,
          postal_code: values.postal_code?.trim() || null,
        })
        .eq('id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      setSaveNotice('Institutional profile saved.')
      queryClient.invalidateQueries({ queryKey: ['institution-detail', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['institutions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] })
    },
  })

  const saveDefaultsMutation = useMutation({
    mutationFn: async () => {
      setDefaultsNotice(null)
      const rows = [
        { institution_id: institutionId, setting_group: 'ACADEMIC', setting_key: 'current_scheme', setting_value: currentScheme.trim() },
        { institution_id: institutionId, setting_group: 'ACADEMIC', setting_key: 'active_academic_year', setting_value: activeAy.trim() },
        { institution_id: institutionId, setting_group: 'ACADEMIC', setting_key: 'active_term', setting_value: activeTerm.trim() },
      ]
      const { error } = await supabase
        .from('institution_settings')
        .upsert(rows, { onConflict: 'institution_id,setting_key' })
      if (error) throw error
    },
    onSuccess: () => {
      setDefaultsNotice('Academic defaults updated.')
      queryClient.invalidateQueries({ queryKey: ['institution-settings', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] })
    },
  })

  if (isLoading || !institution) {
    return <div className="text-sm text-slate-500">Loading institutional configuration...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Institutional Configuration</h1>
        <p className="text-sm text-slate-500">
          Manage profile, affiliation, academic defaults, and campuses for {institution.name}.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleSubmit((v) => updateProfileMutation.mutate(v))}
          className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">Institution Profile &amp; Contact</h2>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {institution.code}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Institution Name *</label>
              <input
                disabled={!canEdit}
                {...register('name')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Short Name</label>
              <input
                disabled={!canEdit}
                {...register('short_name')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
              <select
                disabled={!canEdit}
                {...register('category_id')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white disabled:bg-slate-50"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">University Affiliation</label>
              <input
                disabled={!canEdit}
                {...register('university_affiliation')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Institution Type</label>
              <select
                disabled={!canEdit}
                {...register('institution_type')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white disabled:bg-slate-50"
              >
                {INST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Official Email</label>
              <input
                disabled={!canEdit}
                {...register('official_email')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Official Phone</label>
              <input
                disabled={!canEdit}
                {...register('official_phone')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
              <input
                disabled={!canEdit}
                {...register('address_line1')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
              <input
                disabled={!canEdit}
                {...register('city')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">State</label>
              <input
                disabled={!canEdit}
                {...register('state')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>
          </div>

          {saveNotice && <p className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded">{saveNotice}</p>}
          {updateProfileMutation.isError && (
            <p className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded">
              {updateProfileMutation.error instanceof Error ? updateProfileMutation.error.message : 'Save failed'}
            </p>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={updateProfileMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {updateProfileMutation.isPending ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          )}
        </form>

        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4 h-fit">
          <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
            Academic Defaults
          </h2>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Current Syllabus Scheme</label>
            <input
              disabled={!canEdit}
              value={currentScheme}
              onChange={(e) => setCurrentScheme(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Active Academic Year</label>
            <input
              disabled={!canEdit}
              value={activeAy}
              onChange={(e) => setActiveAy(e.target.value)}
              placeholder="e.g., 2026-27"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Active Term / Cycle Group</label>
            <input
              disabled={!canEdit}
              value={activeTerm}
              onChange={(e) => setActiveTerm(e.target.value)}
              placeholder="e.g., ODD, EVEN, ANNUAL"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </div>
          {defaultsNotice && (
            <p className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded">{defaultsNotice}</p>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => saveDefaultsMutation.mutate()}
              disabled={saveDefaultsMutation.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saveDefaultsMutation.isPending ? 'Saving...' : 'Save Academic Defaults'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Campus Configuration</h2>
        <CampusesPanel institutionId={institutionId} canManage={canEdit} />
      </div>
    </div>
  )
}

export function InstitutionsPage() {
  const queryClient = useQueryClient()
  const { context, activeInstitutionId, platformRoles } = useAppStore()
  const canManagePlatform = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')

  const [tab, setTab] = useState<'LIST' | 'CATEGORIES'>('LIST')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Institution | null>(null)
  const [campusInstitution, setCampusInstitution] = useState<Institution | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: institutions = [], isLoading } = useQuery({
    queryKey: ['institutions'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institutions')
        .select('*, institution_categories(id, code, name), organizations(id, code, name)')
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as Institution[]
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['institution-categories'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as InstitutionCategory[]
    },
  })

  const { data: organizations = [] } = useQuery({
    queryKey: ['organizations'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as Organization[]
    },
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InstFormValues>({ resolver: zodResolver(instSchema) })

  const openCreate = () => {
    setEditing(null)
    setFormError(null)
    reset({
      code: '',
      name: '',
      short_name: '',
      category_id: categories[0]?.id ?? '',
      organization_id: '',
      university_affiliation: '',
      institution_type: 'AUTONOMOUS',
      status: 'ACTIVE',
      official_email: '',
      official_phone: '',
      website_url: '',
      address_line1: '',
      city: '',
      state: '',
      postal_code: '',
    })
    setModalOpen(true)
  }

  const openEdit = (inst: Institution) => {
    setEditing(inst)
    setFormError(null)
    reset({
      code: inst.code,
      name: inst.name,
      short_name: inst.short_name ?? '',
      category_id: inst.category_id,
      organization_id: inst.organization_id ?? '',
      university_affiliation: inst.university_affiliation ?? '',
      institution_type: inst.institution_type,
      status: inst.status,
      official_email: inst.official_email ?? '',
      official_phone: inst.official_phone ?? '',
      website_url: inst.website_url ?? '',
      address_line1: inst.address_line1 ?? '',
      city: inst.city ?? '',
      state: inst.state ?? '',
      postal_code: inst.postal_code ?? '',
    })
    setModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async (values: InstFormValues) => {
      const payload = {
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        short_name: values.short_name?.trim() || null,
        category_id: values.category_id,
        organization_id: values.organization_id || null,
        university_affiliation: values.university_affiliation?.trim() || null,
        institution_type: values.institution_type,
        status: values.status,
        official_email: values.official_email?.trim() || null,
        official_phone: values.official_phone?.trim() || null,
        website_url: values.website_url?.trim() || null,
        address_line1: values.address_line1?.trim() || null,
        city: values.city?.trim() || null,
        state: values.state?.trim() || null,
        postal_code: values.postal_code?.trim() || null,
      }

      if (editing) {
        const { error } = await supabase.from('institutions').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { data: created, error } = await supabase
          .from('institutions')
          .insert(payload)
          .select('id')
          .single()
        if (error) throw error

        const roleRows = DEFAULT_INSTITUTION_ROLES.map((r) => ({
          institution_id: created.id,
          code: r.code,
          name: r.name,
          is_system: r.is_system,
        }))
        const { error: rolesErr } = await supabase
          .from('institution_roles')
          .upsert(roleRows, { onConflict: 'institution_id,code' })
        if (rolesErr) throw rolesErr
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['institutions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] })
      setModalOpen(false)
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Failed to save institution'),
  })

  const toggleStatusMutation = useMutation({
    mutationFn: async (inst: Institution) => {
      const nextStatus: InstitutionStatus = inst.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
      const { error } = await supabase.from('institutions').update({ status: nextStatus }).eq('id', inst.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['institutions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] })
    },
  })

  if (context === 'INSTITUTION') {
    if (!activeInstitutionId) {
      return <div className="text-sm text-slate-500">Select an institution in the sidebar to configure it.</div>
    }
    return <InstitutionSettingsView institutionId={activeInstitutionId} />
  }

  const filtered = institutions.filter((inst) => {
    if (statusFilter !== 'ALL' && inst.status !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      inst.name.toLowerCase().includes(q) ||
      inst.code.toLowerCase().includes(q) ||
      (inst.city ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Institutions</h1>
          <p className="text-sm text-slate-500">
            Provision educational institutions, campuses, status controls, and configurable categories.
          </p>
        </div>
        {canManagePlatform && tab === 'LIST' && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            New Institution
          </button>
        )}
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab('LIST')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            tab === 'LIST'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Institutions ({institutions.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('CATEGORIES')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
            tab === 'CATEGORIES'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Institution Categories
        </button>
      </div>

      {tab === 'CATEGORIES' ? (
        <InstitutionCategoriesTab canManage={canManagePlatform} />
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by code, name, or city..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="ALL">All Statuses</option>
              {INST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <div className="p-6 text-sm text-slate-500">Loading institutions...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No matching institutions found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Institution</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Organization</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((inst) => {
                    const cat = getSingle(inst.institution_categories)
                    const org = getSingle(inst.organizations)
                    return (
                      <tr key={inst.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{inst.code}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                            <div>
                              <p className="font-medium text-slate-900">{inst.name}</p>
                              <p className="text-xs text-slate-500">
                                {[inst.institution_type, inst.city, inst.state].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{cat?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{org?.name ?? 'Standalone'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              inst.status === 'ACTIVE'
                                ? 'bg-emerald-50 text-emerald-700'
                                : inst.status === 'SUSPENDED'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {inst.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-1">
                          <button
                            type="button"
                            onClick={() => setCampusInstitution(inst)}
                            className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                            title="Manage Campuses"
                          >
                            <MapPin className="h-4 w-4" />
                          </button>
                          {canManagePlatform && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEdit(inst)}
                                className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                                title="Edit Institution"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleStatusMutation.mutate(inst)}
                                className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                                title={inst.status === 'ACTIVE' ? 'Suspend Institution' : 'Activate Institution'}
                              >
                                <Power className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Edit Institution' : 'Create New Institution'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit((v) => saveMutation.mutate(v))} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Code *</label>
                  <input
                    {...register('code')}
                    placeholder="e.g., AMCEC"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                  />
                  {errors.code && <p className="text-xs text-red-600 mt-1">{errors.code.message}</p>}
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Institution Name *</label>
                  <input
                    {...register('name')}
                    placeholder="Full legal institution name"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category *</label>
                  <select
                    {...register('category_id')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {errors.category_id && <p className="text-xs text-red-600 mt-1">{errors.category_id.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Parent Organization</label>
                  <select
                    {...register('organization_id')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Standalone (No Parent)</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} — {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Short Name</label>
                  <input {...register('short_name')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                  <select
                    {...register('institution_type')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    {INST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                  <select
                    {...register('status')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    {INST_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">University Affiliation</label>
                <input
                  {...register('university_affiliation')}
                  placeholder="e.g., Visvesvaraya Technological University (VTU)"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Official Email</label>
                  <input {...register('official_email')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  {errors.official_email && <p className="text-xs text-red-600 mt-1">{errors.official_email.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Official Phone</label>
                  <input {...register('official_phone')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
                <input {...register('address_line1')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
                  <input {...register('city')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">State</label>
                  <input {...register('state')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Postal Code</label>
                  <input {...register('postal_code')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </div>
              </div>

              {formError && <div className="p-3 rounded bg-red-50 text-xs text-red-700">{formError}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || saveMutation.isPending}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Institution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {campusInstitution && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Campuses — {campusInstitution.name}</h2>
                <p className="text-xs text-slate-500">Code: {campusInstitution.code}</p>
              </div>
              <button
                type="button"
                onClick={() => setCampusInstitution(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">
              <CampusesPanel institutionId={campusInstitution.id} canManage={canManagePlatform} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
