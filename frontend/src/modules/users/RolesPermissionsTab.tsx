import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Power, Shield } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { InstitutionRoleRecord } from '@/types/users'

const PERMISSION_CATALOG = [
  { code: 'institution.configure', label: 'Institution Settings & Campuses' },
  { code: 'users.manage', label: 'Users & Memberships' },
  { code: 'roles.manage', label: 'Roles & Permissions' },
  { code: 'staff.manage', label: 'Staff Directory' },
  { code: 'academics.manage', label: 'Academic Master (Units, Programs, Courses)' },
  { code: 'students.manage', label: 'Student Identity & Enrollments' },
  { code: 'config.manage', label: 'System Config (IDs, Categories, Grading)' },
  { code: 'migrations.execute', label: 'CSV Imports & Data Migration' },
  { code: 'audit.view', label: 'Audit Logs Viewer' },
]

interface RolesPermissionsTabProps {
  institutionId: string
  canManage: boolean
}

export function RolesPermissionsTab({ institutionId, canManage }: RolesPermissionsTabProps) {
  const queryClient = useQueryClient()
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['institution-roles-perms', institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('institution_roles')
        .select('*, role_permissions(id, permission_code)')
        .eq('institution_id', institutionId)
        .order('is_system', { ascending: false })
        .order('name')
      if (error) throw error
      return (data ?? []) as unknown as InstitutionRoleRecord[]
    },
  })

  const activeRole = roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null
  const activePermMap = new Map(
    (activeRole?.role_permissions ?? []).map((p) => [p.permission_code, p.id])
  )

  const createRoleMutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null)
      const code = newCode.trim().toUpperCase().replace(/\s+/g, '_')
      const name = newName.trim()
      if (!code || !name) throw new Error('Role code and display name are required.')
      const { error } = await supabase.from('institution_roles').insert({
        institution_id: institutionId,
        code,
        name,
        description: newDesc.trim() || null,
        is_system: false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setNewCode('')
      setNewName('')
      setNewDesc('')
      queryClient.invalidateQueries({ queryKey: ['institution-roles-perms', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create role'),
  })

  const toggleRoleActiveMutation = useMutation({
    mutationFn: async (role: InstitutionRoleRecord) => {
      const { error } = await supabase
        .from('institution_roles')
        .update({ is_active: !role.is_active })
        .eq('id', role.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['institution-roles-perms', institutionId] }),
  })

  const togglePermissionMutation = useMutation({
    mutationFn: async ({ roleId, permCode, existingId }: { roleId: string; permCode: string; existingId?: string }) => {
      if (existingId) {
        const { error } = await supabase.from('role_permissions').delete().eq('id', existingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('role_permissions').insert({
          institution_role_id: roleId,
          permission_code: permCode,
        })
        if (error) throw error
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['institution-roles-perms', institutionId] }),
  })

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Create Custom Institution Role</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="Code (e.g., DATA_ENTRY)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Role Name (e.g., Data Entry Operator)"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
            />
            <button
              type="button"
              onClick={() => createRoleMutation.mutate()}
              disabled={createRoleMutation.isPending}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Add Role
            </button>
          </div>
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Optional description of role responsibilities"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
            Institution Roles ({roles.length})
          </div>
          {isLoading ? (
            <div className="p-4 text-xs text-slate-500">Loading roles...</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {roles.map((role) => (
                <li
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`px-4 py-3 cursor-pointer flex items-center justify-between gap-2 transition ${
                    activeRole?.id === role.id ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                      <p className="text-sm font-medium text-slate-900 truncate">{role.name}</p>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500">
                      {role.code} · {(role.role_permissions ?? []).length} permissions
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        role.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {role.is_active ? 'Active' : 'Off'}
                    </span>
                    {canManage && !role.is_system && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleRoleActiveMutation.mutate(role)
                        }}
                        className="p-1 rounded text-slate-500 hover:bg-slate-200"
                        title={role.is_active ? 'Deactivate role' : 'Activate role'}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-xs p-5">
          {!activeRole ? (
            <p className="text-sm text-slate-500">Select a role to configure permissions.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{activeRole.name}</h3>
                  <p className="text-xs text-slate-500 font-mono">{activeRole.code}</p>
                </div>
                {activeRole.is_system && (
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-medium">
                    System Role
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PERMISSION_CATALOG.map((perm) => {
                  const existingId = activePermMap.get(perm.code)
                  const enabled = Boolean(existingId)
                  return (
                    <button
                      key={perm.code}
                      type="button"
                      disabled={!canManage || togglePermissionMutation.isPending}
                      onClick={() =>
                        togglePermissionMutation.mutate({
                          roleId: activeRole.id,
                          permCode: perm.code,
                          existingId,
                        })
                      }
                      className={`text-left p-3 rounded-lg border transition flex items-start gap-3 ${
                        enabled
                          ? 'border-indigo-300 bg-indigo-50/50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      } disabled:opacity-60`}
                    >
                      <span
                        className={`mt-0.5 h-4 w-4 rounded flex items-center justify-center shrink-0 border ${
                          enabled
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {enabled && <Check className="h-3 w-3" />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900">{perm.label}</p>
                        <p className="text-[11px] font-mono text-slate-500">{perm.code}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
