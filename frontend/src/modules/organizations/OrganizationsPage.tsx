import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Pencil, Power, Search, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { Organization, OrganizationType } from '@/types/institutions'

const orgSchema = z.object({
  code: z.string().min(2, 'Code is required').max(24),
  name: z.string().min(2, 'Organization name is required'),
  organization_type: z.enum(['TRUST', 'SOCIETY', 'UNIVERSITY', 'GROUP', 'GOVERNMENT', 'OTHER']),
  contact_email: z.string().email('Invalid email').optional().or(z.literal('')),
  contact_phone: z.string().optional().or(z.literal('')),
  website_url: z.string().optional().or(z.literal('')),
  address_line1: z.string().optional().or(z.literal('')),
  city: z.string().optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  postal_code: z.string().optional().or(z.literal('')),
})

type OrgFormValues = z.infer<typeof orgSchema>

const ORG_TYPES: OrganizationType[] = ['TRUST', 'SOCIETY', 'UNIVERSITY', 'GROUP', 'GOVERNMENT', 'OTHER']

export function OrganizationsPage() {
  const queryClient = useQueryClient()
  const { platformRoles } = useAppStore()
  const canManage = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Organization | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: organizations = [], isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .is('deleted_at', null)
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
  } = useForm<OrgFormValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: { organization_type: 'TRUST' },
  })

  const openCreate = () => {
    setEditing(null)
    setFormError(null)
    reset({
      code: '',
      name: '',
      organization_type: 'TRUST',
      contact_email: '',
      contact_phone: '',
      website_url: '',
      address_line1: '',
      city: '',
      state: '',
      postal_code: '',
    })
    setModalOpen(true)
  }

  const openEdit = (org: Organization) => {
    setEditing(org)
    setFormError(null)
    reset({
      code: org.code,
      name: org.name,
      organization_type: org.organization_type,
      contact_email: org.contact_email ?? '',
      contact_phone: org.contact_phone ?? '',
      website_url: org.website_url ?? '',
      address_line1: org.address_line1 ?? '',
      city: org.city ?? '',
      state: org.state ?? '',
      postal_code: org.postal_code ?? '',
    })
    setModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async (values: OrgFormValues) => {
      const payload = {
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        organization_type: values.organization_type,
        contact_email: values.contact_email?.trim() || null,
        contact_phone: values.contact_phone?.trim() || null,
        website_url: values.website_url?.trim() || null,
        address_line1: values.address_line1?.trim() || null,
        city: values.city?.trim() || null,
        state: values.state?.trim() || null,
        postal_code: values.postal_code?.trim() || null,
      }
      if (editing) {
        const { error } = await supabase.from('organizations').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('organizations').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      setModalOpen(false)
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Failed to save organization'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async (org: Organization) => {
      const { error } = await supabase
        .from('organizations')
        .update({ is_active: !org.is_active })
        .eq('id', org.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations'] }),
  })

  const filtered = organizations.filter((o) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      o.name.toLowerCase().includes(q) ||
      o.code.toLowerCase().includes(q) ||
      (o.city ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Organizations</h1>
          <p className="text-sm text-slate-500">
            Manage parent trusts, societies, educational groups, and universities.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            New Organization
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
        <div className="p-4 border-b border-slate-200">
          <div className="relative max-w-sm">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, code, or city..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading organizations...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No organizations registered yet. Create one to group multiple institutions under a trust or university.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{org.code}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{org.name}</p>
                      {org.contact_email && <p className="text-xs text-slate-500">{org.contact_email}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{org.organization_type}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {[org.city, org.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          org.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {org.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => openEdit(org)}
                          className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActiveMutation.mutate(org)}
                          className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                          title={org.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Edit Organization' : 'New Organization'}
              </h2>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit((v) => saveMutation.mutate(v))} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Code *</label>
                  <input
                    {...register('code')}
                    placeholder="e.g., PARAMAHAMSA"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
                  />
                  {errors.code && <p className="text-xs text-red-600 mt-1">{errors.code.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Type *</label>
                  <select
                    {...register('organization_type')}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    {ORG_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Organization Name *</label>
                <input
                  {...register('name')}
                  placeholder="e.g., Paramahamsa Foundation Trust"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Contact Email</label>
                  <input {...register('contact_email')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                  {errors.contact_email && <p className="text-xs text-red-600 mt-1">{errors.contact_email.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Contact Phone</label>
                  <input {...register('contact_phone')} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
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
                  {saveMutation.isPending ? 'Saving...' : 'Save Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
