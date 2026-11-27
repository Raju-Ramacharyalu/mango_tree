import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  FileText,
  Home,
  Inbox,
  LayoutGrid,
  MapPin,
  ShieldAlert,
  Lock,
  ClipboardCheck,
  User,
  Monitor,
  Smartphone,
  Search,
  ChevronLeft,
  Bell,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { FacultyPortalSnapshot } from '@/types/facultyPortal'
import { FacultyCieMarksPanel } from './FacultyCieMarksPanel'
import { FacultyIaDrafterPanel } from './FacultyIaDrafterPanel'
import { cn } from '@/utils/cn'

type FacultyView = 'home' | 'ia_marks' | 'ia_drafter' | 'invigilation' | 'evaluation' | 'syllabus' | 'updates'

interface FeedItem {
  id: string
  month: string
  date: string
  title: string
  code: string
  time: string
  location: string
  status: string
  onClick?: () => void
}

export function FacultyPortalPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { context, activeInstitutionId, activeExamCycleId, memberships } = useAppStore()
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)

  const [view, setView] = useState<FacultyView>('home')
  const [selectedIaId, setSelectedIaId] = useState('')
  const [previewInput, setPreviewInput] = useState('')
  const [activePreviewCode, setActivePreviewCode] = useState('')
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => window.innerWidth >= 768)
  const [forceMobilePreview, setForceMobilePreview] = useState(false)

  useEffect(() => {
    const onResize = () => setIsDesktopViewport(window.innerWidth >= 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { data: snapshot, isLoading, error } = useQuery<FacultyPortalSnapshot>({
    queryKey: ['faculty_portal_snapshot', activeInstitutionId, activeExamCycleId, activePreviewCode],
    enabled: context === 'INSTITUTION' && Boolean(activeInstitutionId),
    queryFn: async () => {
      const { data, error: rpcErr } = await supabase.rpc('get_faculty_portal_snapshot', {
        p_institution_id: activeInstitutionId!,
        p_exam_cycle_id: activeExamCycleId ?? null,
        p_preview_faculty_code: activePreviewCode.trim() || null,
      })
      if (rpcErr) throw rpcErr
      return data as FacultyPortalSnapshot
    },
  })

  if (!activeInstitutionId || context === 'PLATFORM') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center space-y-2">
        <User className="h-8 w-8 text-indigo-500 mx-auto" />
        <h1 className="text-lg font-semibold text-slate-900">Select an Institution Workspace</h1>
        <p className="text-sm text-slate-500">
          Switch to <strong>Institution</strong> mode to open the Faculty Portal.
        </p>
      </div>
    )
  }

  const instName = activeMembership?.institution.name ?? 'Institution'
  const fac = snapshot?.faculty
  const allocations = snapshot?.allocations ?? []
  const seeDuties = snapshot?.see_duties ?? []
  const iaAllocations = snapshot?.ia_allocations ?? []
  const invigDuties = snapshot?.invigilation_duties ?? []
  const evalDuties = snapshot?.evaluation_duties ?? []
  const syllabi = snapshot?.syllabi ?? []

  const openSeeSetter = (token: string | null) => {
    if (token) {
      navigate(`/setter-drafter?token=${token}`)
    } else {
      window.alert('Your SEE appointment is approved, awaiting COE link generation (Mail Merge export).')
    }
  }

  const openIaSetter = (targetId?: string) => {
    if (iaAllocations.length === 0) {
      window.alert('No IA Question Paper assignments found for your Faculty ID in this cycle.')
      return
    }
    const chosen = targetId || (iaAllocations.find((i) => i.status !== 'SUBMITTED') ?? iaAllocations[0]).id
    setSelectedIaId(chosen)
    setView('ia_drafter')
  }

  const feedItems: FeedItem[] = []
  for (const d of seeDuties) {
    feedItems.push({
      id: `see-${d.id}`,
      month: 'NOW',
      date: '!!',
      title: 'SEE QP Setting',
      code: `${d.course_code} — ${d.course_title}`,
      time: d.access_token ? 'Secure Link Ready' : 'Awaiting Link Export',
      location: 'Zero-Trust Vault',
      status: 'Action Required',
      onClick: () => openSeeSetter(d.access_token),
    })
  }
  for (const ia of iaAllocations) {
    const isDone = ia.status === 'SUBMITTED'
    const isOmr = ia.qp_pattern.startsWith('OMR')
    feedItems.push({
      id: `ia-${ia.id}`,
      month: ia.ia_number === 3 ? 'IMP' : `IA-${ia.ia_number}`,
      date: isDone ? '🔒' : '!!',
      title: `${ia.ia_number === 3 ? 'Improvement IA' : `IA ${ia.ia_number}`} ${isOmr ? '(OMR)' : 'Setter'} (${ia.num_sets}S)`,
      code: `${ia.course_code} — ${ia.course_title}`,
      time: isDone ? 'Encrypted & Submitted (Tap to View)' : 'PIN-Encrypted Vault Draft',
      location: isOmr ? 'OMR + Answer Key Vault' : 'PAC & COE Vault',
      status: isDone ? 'Submitted' : 'Action Required',
      onClick: () => openIaSetter(ia.id),
    })
  }
  for (const inv of invigDuties) {
    const dt = new Date(`${inv.exam_date}T00:00:00`)
    feedItems.push({
      id: `inv-${inv.id}`,
      month: dt.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
      date: String(dt.getDate()).padStart(2, '0'),
      title: `Invigilation (${inv.duty_role})`,
      code: `Session: ${inv.session_code}`,
      time: inv.exam_date,
      location: inv.room_number ? `Room ${inv.room_number}` : 'Report to COE',
      status: 'Scheduled',
      onClick: () => setView('invigilation'),
    })
  }
  for (const ev of evalDuties) {
    feedItems.push({
      id: `ev-${ev.id}`,
      month: 'VAL',
      date: `#${ev.fifo_rank}`,
      title: 'Script Evaluation',
      code: `${ev.course_code} — ${ev.course_title}`,
      time: `${ev.assigned_bundles_count} bundles (${ev.assigned_scripts_count} scripts)`,
      location: 'Valuation Center',
      status: ev.status,
      onClick: () => setView('evaluation'),
    })
  }

  const pendingIaCount = iaAllocations.filter((i) => i.status !== 'SUBMITTED').length
  const totalBadgeCount = seeDuties.length + pendingIaCount + invigDuties.length + evalDuties.length
  const useMobileLayout = !isDesktopViewport || forceMobilePreview
  const firstInitial = fac?.full_name?.trim().charAt(0).toUpperCase() || 'F'

  const renderPreviewBar = () =>
    (snapshot?.can_preview || !snapshot?.found) && (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setActivePreviewCode(previewInput.trim().toUpperCase())
          setView('home')
        }}
        className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 min-w-[210px]">
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Admin/COE Preview: enter Faculty ID (e.g. EC2601) or email..."
            value={previewInput}
            onChange={(e) => setPreviewInput(e.target.value)}
            className="w-full rounded-md border border-indigo-300 bg-white pl-8 pr-3 py-1.5 text-xs"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
        >
          Load Faculty View
        </button>
        {activePreviewCode && (
          <button
            type="button"
            onClick={() => {
              setPreviewInput('')
              setActivePreviewCode('')
              setView('home')
            }}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          >
            Reset
          </button>
        )}
      </form>
    )

  // Sub-views shared across Desktop & Mobile layouts
  const renderSubView = () => {
    if (!fac) return null
    if (view === 'ia_marks') {
      return (
        <FacultyCieMarksPanel
          institutionId={activeInstitutionId}
          institutionName={instName}
          activeCycleId={snapshot?.cycle?.id ?? null}
          faculty={fac}
          allocations={allocations}
          onBack={() => setView('home')}
        />
      )
    }
    if (view === 'ia_drafter') {
      return (
        <FacultyIaDrafterPanel
          institutionId={activeInstitutionId}
          institutionName={instName}
          publicKeyPem={snapshot?.public_key_pem ?? null}
          faculty={fac}
          allocations={iaAllocations}
          initialAllocationId={selectedIaId}
          onBack={() => {
            setView('home')
            queryClient.invalidateQueries({ queryKey: ['faculty_portal_snapshot', activeInstitutionId] })
          }}
          onRefresh={() =>
            queryClient.invalidateQueries({ queryKey: ['faculty_portal_snapshot', activeInstitutionId] })
          }
        />
      )
    }
    if (view === 'invigilation') {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setView('home')}
            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
          >
            <ChevronLeft className="h-4 w-4" /> Back to Portal
          </button>
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-base font-bold text-slate-900">Invigilation Duties ({invigDuties.length})</h2>
            {invigDuties.length === 0 ? (
              <p className="text-xs text-slate-500">No active invigilation duties scheduled for this cycle.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {invigDuties.map((d) => (
                  <div key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">
                        {d.exam_date} · Session {d.session_code}
                      </p>
                      <p className="text-slate-600">
                        Role: <strong>{d.duty_role}</strong> · {d.room_number ? `Room ${d.room_number}` : 'Floor / Squad Duty'}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 font-semibold">
                      {d.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }
    if (view === 'evaluation') {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setView('home')}
            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
          >
            <ChevronLeft className="h-4 w-4" /> Back to Portal
          </button>
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-base font-bold text-slate-900">Script Evaluation Duties ({evalDuties.length})</h2>
            {evalDuties.length === 0 ? (
              <p className="text-xs text-slate-500">No FIFO script evaluation duties assigned for this cycle.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {evalDuties.map((d) => (
                  <div key={d.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono font-bold text-indigo-900">
                        {d.course_code} — {d.course_title}
                      </p>
                      <p className="text-slate-600">
                        FIFO Rank #{d.fifo_rank} · {d.assigned_bundles_count} bundle(s) / {d.assigned_scripts_count} scripts
                      </p>
                    </div>
                    <span className="rounded-full bg-indigo-100 text-indigo-800 px-2.5 py-0.5 font-semibold">
                      {d.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }
    if (view === 'syllabus') {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setView('home')}
            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
          >
            <ChevronLeft className="h-4 w-4" /> Back to Portal
          </button>
          {syllabi.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              No BOS syllabi published yet for your allocated courses.
            </div>
          ) : (
            syllabi.map((syl) => (
              <div key={`${syl.course_id}-${syl.academic_year}-${syl.term}`} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <div>
                    <p className="font-mono text-sm font-bold text-indigo-900">
                      {syl.course_code} — {syl.course_title}
                    </p>
                    <p className="text-slate-500">
                      {syl.academic_year} ({syl.term}) · {syl.syllabus_type}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 font-semibold">
                    {syl.approval_status}
                  </span>
                </div>
                {Array.isArray(syl.modules_json) && syl.modules_json.some((m) => m.title || m.content) && (
                  <div className="space-y-1.5">
                    {syl.modules_json.map((m) => (
                      <div key={m.module_number} className="rounded bg-slate-50 p-2.5">
                        <p className="font-bold text-slate-900">
                          Module {m.module_number}: {m.title}
                        </p>
                        <p className="text-slate-600 mt-0.5 whitespace-pre-line">{m.content}</p>
                      </div>
                    ))}
                  </div>
                )}
                {syl.outcomes.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <p className="font-bold text-slate-800">Course Outcomes:</p>
                    {syl.outcomes.map((o) => (
                      <p key={o.co_code} className="text-slate-600">
                        <strong>{o.co_code}:</strong> {o.description}{' '}
                        {o.target_bloom_level && <span className="text-indigo-700">({o.target_bloom_level})</span>}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Faculty Portal</h1>
          <p className="text-xs text-slate-500">
            Unified workspace for CIE marks, PIN-encrypted IA QPs, SEE appointments, invigilation, evaluation, and BOS syllabi.
          </p>
        </div>
        {isDesktopViewport && fac && (
          <button
            type="button"
            onClick={() => setForceMobilePreview((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {forceMobilePreview ? (
              <>
                <Monitor className="h-3.5 w-3.5" /> Switch to Desktop View
              </>
            ) : (
              <>
                <Smartphone className="h-3.5 w-3.5" /> Switch to Mobile View
              </>
            )}
          </button>
        )}
      </div>

      {renderPreviewBar()}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error instanceof Error ? error.message : 'Unable to load faculty portal'}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading faculty portal...</div>
      ) : !snapshot?.found || !fac ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center space-y-2">
          <User className="h-8 w-8 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold text-slate-800">No Faculty Profile Linked</p>
          <p className="text-xs text-slate-500">{snapshot?.reason}</p>
        </div>
      ) : view !== 'home' && view !== 'updates' ? (
        renderSubView()
      ) : useMobileLayout ? (
        /* MOBILE APP VIEW (< 768px or toggled preview) */
        <div className="mx-auto w-full max-w-[420px] rounded-[36px] bg-slate-600 p-4 pb-20 shadow-xl space-y-4 relative overflow-hidden">
          <div className="flex items-start justify-between px-1 pt-2 text-white">
            <div>
              <p className="text-[11px] text-slate-200">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <p className="text-lg font-extrabold">Greetings of the Day!</p>
            </div>
            <div className="relative h-9 w-9 rounded-xl border border-slate-400 flex items-center justify-center">
              <Bell className="h-4 w-4 text-orange-100" />
              {totalBadgeCount > 0 && (
                <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-orange-400" />
              )}
            </div>
          </div>

          {view === 'updates' ? (
            <div className="rounded-2xl bg-slate-200 p-4 space-y-3">
              <h3 className="text-sm font-extrabold text-slate-900">All Pending Updates ({feedItems.length})</h3>
              {feedItems.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-4">No pending updates.</p>
              ) : (
                feedItems.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={it.onClick}
                    className="w-full text-left rounded-xl bg-white p-3 flex items-center gap-3"
                  >
                    <div className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-center min-w-[48px]">
                      <p className="text-[10px] font-bold text-amber-800">{it.month}</p>
                      <p className="text-base font-extrabold text-amber-800">{it.date}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 truncate">{it.title}</p>
                      <p className="text-[11px] text-slate-600 truncate">{it.code}</p>
                      <p className="text-[10px] text-slate-400">{it.location}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-slate-200 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-orange-100 text-amber-800 flex items-center justify-center font-bold text-xl shrink-0">
                    {firstInitial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-slate-900 truncate">{fac.full_name}</p>
                    <p className="text-xs text-slate-600 truncate">
                      {fac.designation} · {fac.branch_label || fac.unit_code || fac.department_label || 'Staff'}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500">ID: {fac.employee_code}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 rounded-xl bg-orange-100 p-3 text-xs">
                  <div className="border-r border-orange-200 pr-2">
                    <p className="text-[11px] font-semibold text-orange-700">Active Cycle</p>
                    <p className="font-extrabold text-orange-950 truncate">
                      {snapshot.cycle?.code ?? (allocations[0] ? `Sem ${allocations[0].semester_number}` : 'Active')}
                    </p>
                  </div>
                  <div className="pl-3">
                    <p className="text-[11px] font-semibold text-sky-700">Teaching Load</p>
                    <p className="font-extrabold text-sky-600">
                      {String(allocations.length).padStart(2, '0')} subjects
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { label: 'IA Evaluation', icon: FileText, bg: 'bg-indigo-100', badge: false, onClick: () => setView('ia_marks') },
                  { label: 'IA QP Setter', icon: BookOpen, bg: 'bg-indigo-100', badge: pendingIaCount > 0, onClick: () => openIaSetter() },
                  { label: 'SEE Setting', icon: Lock, bg: 'bg-indigo-100', badge: seeDuties.length > 0, onClick: () => seeDuties[0] ? openSeeSetter(seeDuties[0].access_token) : window.alert('No pending SEE nominations.') },
                  { label: 'Invigilation', icon: ShieldAlert, bg: 'bg-orange-100', badge: invigDuties.length > 0, onClick: () => setView('invigilation') },
                  { label: 'Evaluation', icon: ClipboardCheck, bg: 'bg-orange-100', badge: evalDuties.length > 0, onClick: () => setView('evaluation') },
                  { label: 'Syllabus', icon: LayoutGrid, bg: 'bg-orange-100', badge: false, onClick: () => setView('syllabus') },
                ].map(({ label, icon: Icon, bg, badge, onClick }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={onClick}
                    className="relative rounded-2xl bg-slate-50 p-3 flex flex-col items-center gap-1.5 hover:bg-white transition"
                  >
                    {badge && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
                    <div className={cn('h-11 w-11 rounded-xl flex items-center justify-center text-amber-800', bg)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 text-center leading-tight">{label}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-2xl bg-slate-200 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-extrabold text-slate-900">Actions Required</p>
                  <span className="text-xs font-bold text-amber-800">{feedItems.length} Tasks</span>
                </div>
                {feedItems.length === 0 ? (
                  <p className="text-xs text-slate-600 text-center py-3">No pending actions required.</p>
                ) : (
                  feedItems.slice(0, 5).map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={it.onClick}
                      className="w-full text-left rounded-xl bg-white p-2.5 flex items-center gap-3"
                    >
                      <div className="rounded-lg bg-orange-50 px-2 py-1 text-center min-w-[44px]">
                        <p className="text-[9px] font-bold text-amber-800">{it.month}</p>
                        <p className="text-sm font-extrabold text-amber-800">{it.date}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 truncate">{it.title}</p>
                        <p className="text-[11px] text-slate-600 truncate">{it.code}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {/* Mobile Bottom Pill Nav */}
          <div className="absolute bottom-3 left-4 right-4 rounded-full bg-slate-800 px-6 py-2 flex justify-around text-xs shadow-lg">
            <button
              type="button"
              onClick={() => setView('home')}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 rounded-full',
                view === 'home' ? 'bg-orange-100 text-amber-900 font-bold' : 'text-slate-300'
              )}
            >
              <Home className="h-4 w-4" />
              <span className="text-[10px]">Home</span>
            </button>
            <button
              type="button"
              onClick={() => setView('updates')}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 rounded-full',
                view === 'updates' ? 'bg-orange-100 text-amber-900 font-bold' : 'text-slate-300'
              )}
            >
              <Inbox className="h-4 w-4" />
              <span className="text-[10px]">Updates</span>
            </button>
            <button
              type="button"
              onClick={() => setView('syllabus')}
              className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-full text-slate-300"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="text-[10px]">Syllabus</span>
            </button>
          </div>
        </div>
      ) : (
        /* DESKTOP WORKSPACE VIEW (>= 768px) */
        <div className="space-y-5">
          {/* Top Greeting Banner */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4 shadow-xs">
            <div className="flex items-center gap-3.5">
              <div className="h-12 w-12 rounded-full bg-orange-100 text-amber-800 flex items-center justify-center font-bold text-xl">
                {firstInitial}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
                <h2 className="text-xl font-extrabold text-slate-900">Welcome, {fac.full_name}</h2>
                <p className="text-xs text-slate-500">
                  {fac.designation} · ID: <span className="font-mono font-semibold">{fac.employee_code}</span> ·{' '}
                  {fac.branch_label || fac.unit_name || fac.department_label || 'Faculty'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-xl bg-orange-50 border border-orange-200 px-4 py-2 text-right">
                <p className="text-[10px] font-bold uppercase text-orange-700">Active Cycle</p>
                <p className="text-sm font-extrabold text-orange-950">
                  {snapshot.cycle?.code ?? 'Current Semester'}
                </p>
              </div>
              <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-2 text-right">
                <p className="text-[10px] font-bold uppercase text-sky-700">Allocated Subjects</p>
                <p className="text-sm font-extrabold text-sky-900">
                  {String(allocations.length).padStart(2, '0')} Sections
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Utilities + Assigned IA Papers */}
            <div className="lg:col-span-7 space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h3 className="text-sm font-extrabold text-slate-900">Teaching &amp; Examination Utilities</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'IA Evaluation (CIE)', icon: FileText, bg: 'bg-indigo-100', badge: false, onClick: () => setView('ia_marks') },
                    { label: 'IA QP Setter', icon: BookOpen, bg: 'bg-indigo-100', badge: pendingIaCount > 0, onClick: () => openIaSetter() },
                    { label: 'SEE QP Setting', icon: Lock, bg: 'bg-indigo-100', badge: seeDuties.length > 0, onClick: () => seeDuties[0] ? openSeeSetter(seeDuties[0].access_token) : window.alert('No pending SEE nominations.') },
                    { label: 'Invigilation', icon: ShieldAlert, bg: 'bg-orange-100', badge: invigDuties.length > 0, onClick: () => setView('invigilation') },
                    { label: 'Evaluation', icon: ClipboardCheck, bg: 'bg-orange-100', badge: evalDuties.length > 0, onClick: () => setView('evaluation') },
                    { label: 'BOS Syllabus', icon: LayoutGrid, bg: 'bg-orange-100', badge: false, onClick: () => setView('syllabus') },
                  ].map(({ label, icon: Icon, bg, badge, onClick }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={onClick}
                      className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col items-center gap-2 hover:border-indigo-300 hover:bg-white transition"
                    >
                      {badge && <span className="absolute top-2.5 right-2.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />}
                      <div className={cn('h-12 w-12 rounded-2xl flex items-center justify-center text-amber-800', bg)}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <span className="text-xs font-bold text-slate-800 text-center">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-extrabold text-slate-900">
                  Assigned IA Question Papers ({iaAllocations.length})
                </h3>
                {iaAllocations.length === 0 ? (
                  <p className="text-xs text-slate-500">No IA Question Paper assignments currently allocated.</p>
                ) : (
                  <div className="space-y-2.5">
                    {iaAllocations.map((ia) => {
                      const isDone = ia.status === 'SUBMITTED'
                      const isOmr = ia.qp_pattern.startsWith('OMR')
                      return (
                        <button
                          key={ia.id}
                          type="button"
                          onClick={() => openIaSetter(ia.id)}
                          className={cn(
                            'w-full text-left rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-2 transition',
                            isDone
                              ? 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50'
                              : 'border-slate-200 bg-slate-50 hover:border-indigo-300'
                          )}
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="font-mono text-sm text-slate-900">{ia.course_code}</strong>
                              <span className="rounded bg-blue-100 text-blue-900 px-2 py-0.5 text-[10px] font-bold">
                                {ia.ia_number === 3 ? 'Improvement IA' : `IA-${ia.ia_number}`} · {ia.num_sets} Set(s)
                              </span>
                              <span
                                className={cn(
                                  'rounded px-2 py-0.5 text-[10px] font-bold',
                                  isOmr ? 'bg-purple-100 text-purple-900' : 'bg-indigo-100 text-indigo-900'
                                )}
                              >
                                {isOmr ? ia.qp_pattern : 'Descriptive (50M)'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1">{ia.course_title}</p>
                          </div>
                          <span className={cn('text-xs font-bold', isDone ? 'text-emerald-700' : 'text-amber-700')}>
                            {isDone ? '🔒 Submitted' : 'Open Drafter →'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Actions Required Feed */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-slate-900">Actions Required</h3>
                <span className="text-xs font-bold text-amber-700">{feedItems.length} Items</span>
              </div>
              <div className="rounded-2xl bg-slate-200/80 p-3.5 space-y-2.5">
                {feedItems.length === 0 ? (
                  <p className="text-xs text-slate-600 text-center py-6">No pending actions required.</p>
                ) : (
                  feedItems.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={it.onClick}
                      className="w-full text-left rounded-xl bg-white p-3 flex items-center gap-3 hover:shadow-xs transition"
                    >
                      <div className="rounded-xl bg-orange-50 px-2.5 py-2 text-center min-w-[52px]">
                        <p className="text-[10px] font-bold text-amber-800">{it.month}</p>
                        <p className="text-base font-extrabold text-amber-800">{it.date}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 truncate">{it.title}</p>
                        <p className="text-[11px] text-slate-600 truncate">
                          {it.code} · {it.time}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                            <MapPin className="h-3 w-3" /> {it.location}
                          </span>
                          <span className="text-[10px] font-bold text-amber-800">{it.status}</span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
