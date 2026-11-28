import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { InstitutionSummary } from '@/types/auth'
import { UnitsProgramsTab } from './UnitsProgramsTab'
import { PeriodsBatchesTab } from './PeriodsBatchesTab'
import { CatalogCurriculaTab } from './CatalogCurriculaTab'

export function AcademicsPage() {
  const { context, activeInstitutionId, platformRoles, memberships } = useAppStore()
  const isPlatformAdmin = platformRoles.some((r) => r === 'SUPER_ADMIN' || r === 'PLATFORM_ADMIN')

  const [selectedPlatformInstId, setSelectedPlatformInstId] = useState('')
  const [activeTab, setActiveTab] = useState<'UNITS_PROGRAMS' | 'PERIODS_BATCHES' | 'CATALOG_CURRICULA'>('UNITS_PROGRAMS')

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

  const activeMembership = memberships.find((m) => m.institution_id === targetInstitutionId)
  const canManageAcademics =
    isPlatformAdmin ||
    (activeMembership?.roles ?? []).some((r) =>
      ['INSTITUTION_ADMIN', 'PRINCIPAL_DIRECTOR', 'EXAM_CONTROLLER', 'ACADEMIC_ADMIN', 'DEPT_ADMIN'].includes(r)
    )

  if (!targetInstitutionId) {
    return <div className="text-sm text-slate-500">Select an institution to configure academic master data.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Academic Master Configuration</h1>
          <p className="text-sm text-slate-500">
            Configure academic units, programs, flexible academic periods, batches, sections, course catalog, and curricula.
          </p>
        </div>

        {context === 'PLATFORM' && allInstitutions.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Institution Scope:</span>
            <select
              value={targetInstitutionId}
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
          { id: 'UNITS_PROGRAMS', label: 'Units & Programs' },
          { id: 'PERIODS_BATCHES', label: 'Periods, Batches & Sections' },
          { id: 'CATALOG_CURRICULA', label: 'Course Catalog & Curricula' },
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

      {activeTab === 'UNITS_PROGRAMS' && (
        <UnitsProgramsTab institutionId={targetInstitutionId} canManage={canManageAcademics} />
      )}
      {activeTab === 'PERIODS_BATCHES' && (
        <PeriodsBatchesTab institutionId={targetInstitutionId} canManage={canManageAcademics} />
      )}
      {activeTab === 'CATALOG_CURRICULA' && (
        <CatalogCurriculaTab institutionId={targetInstitutionId} canManage={canManageAcademics} />
      )}
    </div>
  )
}
