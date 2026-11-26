import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, Power, Search, Shield, Trash2, UserPlus, X } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { InstitutionSummary } from '@/types/auth'
import type {
  DirectoryUser,
  InstitutionRoleRecord,
  MembershipDetail,
  MembershipStatus,
  PlatformRoleRecord,
  UserPlatformRoleRecord,
} from '@/types/users'
import { RolesPermissionsTab } from './RolesPermissionsTab'
import { StaffDirectoryTab } from './StaffDirectoryTab'

function getSingle<T>(val: T | T[] | null | undefined): T | null {
  if (!val) return null
  return Array.isArray(val) ? (val[0] ?? null) : val
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const { context, activeInstitutionId, platformRoles, memberships, profile } = useAppStore()

  const isSuperAdmin = platformRoles.includes('SUPER_ADMIN')
  const isPlatformAdmin = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')

  const [activeTab, setActiveTab] = useState<'MEMBERSHIPS' | 'ROLES' | 'STAFF' | 'PLATFORM_ROLES'>('MEMBERSHIPS')
  const [selectedPlatformInstId, setSelectedPlatformInstId] = useState<string>('')
  const [search, setSearch] = useState('')

  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [assignError, setAssignError] = useState<string | null>(null)

  const [editingMembership, setEditingMembership] = useState<MembershipDetail | null>(null)
  const [editRoleIds, setEditRoleIds] = useState<string[]>([])

  const [platUserId, setPlatUserId] = useState('')
  const [platRoleId, setPlatRoleId] = useState('')
  const [platError, setPlatError] = useState<string | null>(null)

  const { data: allInstitutions = [] } = useQuery({
    queryKey: ['institutions-min'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institutions')
        .select('id, code, name, short_name, status')
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return (data ?? []) as InstitutionSummary[]
    },
  })

  const targetInstitutionId =
    context === 'INSTITUTION'
      ? activeInstitutionId
      : selectedPlatformInstId || allInstitutions[0]?.id || activeInstitutionId

  const activeInstMembership = memberships.find((m) => m.institution_id === targetInstitutionId)
  const canManageInstitution =
    isPlatformAdmin ||
    (activeInstMembership?.roles ?? []).some((r) =>
      ['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER'].includes(r)
    )

  const { data: directoryUsers = [] } = useQuery({
    queryKey: ['user-profiles-directory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, full_name, phone, is_active, created_at')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as DirectoryUser[]
    },
  })

  const { data: instRoles = [] } = useQuery({
    queryKey: ['institution-roles-basic', targetInstitutionId],
    enabled: Boolean(targetInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_roles')
        .select('*')
        .eq('institution_id', targetInstitutionId!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as InstitutionRoleRecord[]
    },
  })

  const { data: membershipList = [], isLoading: loadingMemberships } = useQuery({
    queryKey: ['institution-memberships-admin', targetInstitutionId],
    enabled: Boolean(targetInstitutionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_memberships')
        .select(`
          id,
          institution_id,
          user_id,
          status,
          is_default,
          joined_at,
          created_at,
          user_profiles (id, email, full_name),
          institutions (id, code, name),
          membership_roles (id, institution_role_id, institution_roles (id, code, name))
        `)
        .eq('institution_id', targetInstitutionId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as MembershipDetail[]
    },
  })

  const { data: platformRoleDefs = [] } = useQuery({
    queryKey: ['platform-roles-list'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase.from('platform_roles').select('*').order('code')
      if (error) throw error
      return (data ?? []) as PlatformRoleRecord[]
    },
  })

  const { data: platformRoleAssignments = [], isLoading: loadingPlatRoles } = useQuery({
    queryKey: ['user-platform-roles-list'],
    enabled: context === 'PLATFORM',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_platform_roles')
        .select('id, user_id, platform_role_id, is_active, created_at, user_profiles(id, email, full_name), platform_roles(id, code, name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as UserPlatformRoleRecord[]
    },
  })

  const assignMembershipMutation = useMutation({
    mutationFn: async () => {
      setAssignError(null)
      if (!targetInstitutionId) throw new Error('Select an institution first.')
      if (!selectedUserId) throw new Error('Select a registered user.')
      if (selectedRoleIds.length === 0) throw new Error('Assign at least one institution role.')

      const { data: membershipRow, error: memErr } = await supabase
        .from('institution_memberships')
        .upsert(
          {
            institution_id: targetInstitutionId,
            user_id: selectedUserId,
            status: 'ACTIVE',
            joined_at: new Date().toISOString(),
          },
          { onConflict: 'institution_id,user_id' }
        )
        .select('id')
        .single()
      if (memErr) throw memErr

      const roleRows = selectedRoleIds.map((roleId) => ({
        membership_id: membershipRow.id,
        institution_role_id: roleId,
      }))
      const { error: rolesErr } = await supabase
        .from('membership_roles')
        .upsert(roleRows, { onConflict: 'membership_id,institution_role_id' })
      if (rolesErr) throw rolesErr
    },
    onSuccess: () => {
      setAssignModalOpen(false)
      setSelectedUserId('')
      setSelectedRoleIds([])
      queryClient.invalidateQueries({ queryKey: ['institution-memberships-admin', targetInstitutionId] })
    },
    onError: (err) => setAssignError(err instanceof Error ? err.message : 'Failed to assign membership'),
  })

  const updateMembershipRolesMutation = useMutation({
    mutationFn: async () => {
      if (!editingMembership) return
      const existingRoleIds = (editingMembership.membership_roles ?? []).map((mr) => mr.institution_role_id)
      const toAdd = editRoleIds.filter((id) => !existingRoleIds.includes(id))
      const toRemove = existingRoleIds.filter((id) => !editRoleIds.includes(id))

      if (toAdd.length > 0) {
        const { error } = await supabase.from('membership_roles').insert(
          toAdd.map((roleId) => ({
            membership_id: editingMembership.id,
            institution_role_id: roleId,
          }))
        )
        if (error) throw error
      }

      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('membership_roles')
          .delete()
          .eq('membership_id', editingMembership.id)
          .in('institution_role_id', toRemove)
        if (error) throw error
      }
    },
    onSuccess: () => {
      setEditingMembership(null)
      queryClient.invalidateQueries({ queryKey: ['institution-memberships-admin', targetInstitutionId] })
    },
  })

  const toggleMembershipStatusMutation = useMutation({
    mutationFn: async (m: MembershipDetail) => {
      const nextStatus: MembershipStatus = m.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
      const { error } = await supabase
        .from('institution_memberships')
        .update({ status: nextStatus })
        .eq('id', m.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['institution-memberships-admin', targetInstitutionId] })
    },
  })

  const assignPlatformRoleMutation = useMutation({
    mutationFn: async () => {
      setPlatError(null)
      if (!platUserId || !platRoleId) throw new Error('Select both a user and a platform role.')
      const { error } = await supabase
        .from('user_platform_roles')
        .upsert(
          { user_id: platUserId, platform_role_id: platRoleId, is_active: true },
          { onConflict: 'user_id,platform_role_id' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      setPlatUserId('')
      setPlatRoleId('')
      queryClient.invalidateQueries({ queryKey: ['user-platform-roles-list'] })
    },
    onError: (err) => setPlatError(err instanceof Error ? err.message : 'Failed to assign platform role'),
  })

  const revokePlatformRoleMutation = useMutation({
    mutationFn: async (row: UserPlatformRoleRecord) => {
      const role = getSingle(row.platform_roles)
      if (row.user_id === profile?.id && role?.code === 'SUPER_ADMIN') {
        throw new Error('You cannot revoke your own Super Administrator role.')
      }
      const { error } = await supabase.from('user_platform_roles').delete().eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-platform-roles-list'] }),
    onError: (err) => setPlatError(err instanceof Error ? err.message : 'Failed to revoke role'),
  })

  const filteredMemberships = membershipList.filter((m) => {
    const u = getSingle(m.user_profiles)
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      (u?.full_name ?? '').toLowerCase().includes(q) ||
      (u?.email ?? '').toLowerCase().includes(q)
    )
  })

  const toggleIdInList = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users and Access</h1>
          <p className="text-sm text-slate-500">
            Manage institution memberships, multi-role RBAC assignments, permissions, and staff profiles.
          </p>
        </div>

        {context === 'PLATFORM' && allInstitutions.length > 0 && activeTab !== 'PLATFORM_ROLES' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Institution Scope:</span>
            <select
              value={targetInstitutionId ?? ''}
              onChange={(e) => setSelectedPlatformInstId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            >
              {allInstitutions.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.code} — {inst.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {[
          { id: 'MEMBERSHIPS', label: 'Memberships & Users' },
          { id: 'ROLES', label: 'Roles & Permissions' },
          { id: 'STAFF', label: 'Staff Directory' },
          ...(context === 'PLATFORM' ? [{ id: 'PLATFORM_ROLES', label: 'Platform Roles' }] : []),
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as typeof activeTab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === t.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'PLATFORM_ROLES' && context === 'PLATFORM' && (
        <div className="space-y-5">
          {isSuperAdmin && (
            <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Assign Platform Role</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={platUserId}
                  onChange={(e) => setPlatUserId(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select user...</option>
                  {directoryUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.email})
                    </option>
                  ))}
                </select>
                <select
                  value={platRoleId}
                  onChange={(e) => setPlatRoleId(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select platform role...</option>
                  {platformRoleDefs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => assignPlatformRoleMutation.mutate()}
                  disabled={assignPlatformRoleMutation.isPending}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Grant Platform Role
                </button>
              </div>
              {platError && <p className="text-xs text-red-600">{platError}</p>}
            </div>
          )}

          <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-x-auto">
            {loadingPlatRoles ? (
              <div className="p-6 text-sm text-slate-500">Loading platform roles...</div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Platform Role</th>
                    <th className="px-4 py-3">Assigned</th>
                    {isSuperAdmin && <th className="px-4 py-3 text-right">Revoke</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {platformRoleAssignments.map((row) => {
                    const u = getSingle(row.user_profiles)
                    const r = getSingle(row.platform_roles)
                    return (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{u?.full_name ?? 'Unknown'}</p>
                          <p className="text-xs text-slate-500">{u?.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-medium">
                            <Shield className="h-3 w-3" /> {r?.name ?? r?.code}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(row.created_at).toLocaleDateString()}
                        </td>
                        {isSuperAdmin && (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => revokePlatformRoleMutation.mutate(row)}
                              className="p-1.5 rounded text-slate-500 hover:text-red-600 hover:bg-red-50"
                              title="Revoke platform role"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ROLES' && targetInstitutionId && (
        <RolesPermissionsTab institutionId={targetInstitutionId} canManage={canManageInstitution} />
      )}

      {activeTab === 'STAFF' && targetInstitutionId && (
        <StaffDirectoryTab institutionId={targetInstitutionId} canManage={canManageInstitution} />
      )}

      {activeTab === 'MEMBERSHIPS' && (
        <div className="space-y-4">
          <div className="bg-indigo-50/70 border border-indigo-200 rounded-lg px-4 py-3 text-xs text-indigo-900">
            <strong>Security Note:</strong> To onboard a brand-new person, create or invite them under{' '}
            <strong>Supabase Dashboard → Authentication → Users</strong> first (service-role keys are never stored in browser code). Once created, assign their institution membership and roles below.
          </div>

          <div className="bg-white rounded-lg border border-slate-200 shadow-xs">
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative max-w-sm flex-1">
                <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter members by name or email..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {canManageInstitution && targetInstitutionId && (
                <button
                  type="button"
                  onClick={() => {
                    setAssignError(null)
                    setSelectedUserId('')
                    setSelectedRoleIds([])
                    setAssignModalOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                >
                  <UserPlus className="h-4 w-4" />
                  Assign User to Institution
                </button>
              )}
            </div>

            {loadingMemberships ? (
              <div className="p-6 text-sm text-slate-500">Loading institution memberships...</div>
            ) : filteredMemberships.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No users assigned to this institution yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Assigned Roles</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Joined</th>
                      {canManageInstitution && <th className="px-4 py-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMemberships.map((m) => {
                      const u = getSingle(m.user_profiles)
                      const assignedRoles = (m.membership_roles ?? [])
                        .map((mr) => getSingle(mr.institution_roles))
                        .filter((r): r is { id: string; code: string; name: string } => Boolean(r))

                      return (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{u?.full_name ?? 'User'}</p>
                            <p className="text-xs text-slate-500">{u?.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              {assignedRoles.length === 0 ? (
                                <span className="text-xs text-slate-400">No roles assigned</span>
                              ) : (
                                assignedRoles.map((r) => (
                                  <span
                                    key={r.id}
                                    className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-medium"
                                  >
                                    {r.name}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                m.status === 'ACTIVE'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {m.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                          </td>
                          {canManageInstitution && (
                            <td className="px-4 py-3 text-right space-x-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMembership(m)
                                  setEditRoleIds((m.membership_roles ?? []).map((mr) => mr.institution_role_id))
                                }}
                                className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                                title="Edit Assigned Roles"
                              >
                                <KeyRound className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleMembershipStatusMutation.mutate(m)}
                                className="p-1.5 rounded text-slate-600 hover:bg-slate-100"
                                title={m.status === 'ACTIVE' ? 'Deactivate Membership' : 'Activate Membership'}
                              >
                                <Power className="h-4 w-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {assignModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-lg">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Assign User to Institution</h2>
              <button type="button" onClick={() => setAssignModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Registered User *</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select user...</option>
                  {directoryUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">Assign Roles *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                  {instRoles.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 p-2 rounded border border-slate-200 text-xs cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoleIds.includes(r.id)}
                        onChange={() => setSelectedRoleIds((prev) => toggleIdInList(prev, r.id))}
                        className="rounded border-slate-300"
                      />
                      <span className="font-medium text-slate-800">{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {assignError && <div className="p-3 rounded bg-red-50 text-xs text-red-700">{assignError}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="px-4 py-2 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => assignMembershipMutation.mutate()}
                  disabled={assignMembershipMutation.isPending}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {assignMembershipMutation.isPending ? 'Assigning...' : 'Save Membership'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingMembership && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-md">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Edit Assigned Roles</h2>
                <p className="text-xs text-slate-500">{getSingle(editingMembership.user_profiles)?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingMembership(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {instRoles.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-2 p-2 rounded border border-slate-200 text-xs cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={editRoleIds.includes(r.id)}
                      onChange={() => setEditRoleIds((prev) => toggleIdInList(prev, r.id))}
                      className="rounded border-slate-300"
                    />
                    <div>
                      <p className="font-medium text-slate-800">{r.name}</p>
                      <p className="font-mono text-[10px] text-slate-500">{r.code}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingMembership(null)}
                  className="px-4 py-2 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => updateMembershipRolesMutation.mutate()}
                  disabled={updateMembershipRolesMutation.isPending}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
                >
                  {updateMembershipRolesMutation.isPending ? 'Updating...' : 'Update Roles'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
