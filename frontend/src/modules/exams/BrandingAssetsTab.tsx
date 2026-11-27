import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Image as ImageIcon,
  Upload,
  Trash2,
  ShieldCheck,
  Users,
  CheckCircle2,
  AlertTriangle,
  Save,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import {
  BRANDING_BUCKET,
  PRIVATE_ASSETS_BUCKET,
  fetchInstitutionBranding,
  signPrivateAssets,
  type InstitutionBranding,
} from './printBranding'

interface Props {
  institutionId: string
  canManageBranding: boolean
  canManagePhotos: boolean
}

interface StudentPhotoRef {
  id: string
  registration_number: string
  admission_number?: string | null
  full_name: string
  photo_url: string | null
}

interface MatchedPhotoItem {
  file: File
  stemUsn: string
  student: StudentPhotoRef | null
}

function getFileExt(file: File): string {
  const parts = file.name.split('.')
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'png'
  if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext
  return 'png'
}

export function BrandingAssetsTab({ institutionId, canManageBranding, canManagePhotos }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const leftLogoRef = useRef<HTMLInputElement | null>(null)
  const rightLogoRef = useRef<HTMLInputElement | null>(null)
  const watermarkRef = useRef<HTMLInputElement | null>(null)
  const coeSigRef = useRef<HTMLInputElement | null>(null)
  const principalSigRef = useRef<HTMLInputElement | null>(null)
  const bulkPhotosRef = useRef<HTMLInputElement | null>(null)

  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [subtitleDraft, setSubtitleDraft] = useState<string | null>(null)
  const [opacityDraft, setOpacityDraft] = useState<number | null>(null)
  const [queuedPhotos, setQueuedPhotos] = useState<MatchedPhotoItem[]>([])
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)

  const { data: branding, isLoading } = useQuery<InstitutionBranding>({
    queryKey: ['institution_branding', institutionId],
    queryFn: () => fetchInstitutionBranding(institutionId),
  })

  const { data: signedSigs } = useQuery({
    queryKey: [
      'institution_signature_previews',
      institutionId,
      branding?.coe_signature_path,
      branding?.principal_signature_path,
    ],
    enabled: Boolean(branding && canManageBranding && (branding.coe_signature_path || branding.principal_signature_path)),
    queryFn: async () => {
      const map = await signPrivateAssets([
        branding?.coe_signature_path,
        branding?.principal_signature_path,
      ])
      return {
        coeUrl: branding?.coe_signature_path ? (map.get(branding.coe_signature_path) ?? null) : null,
        principalUrl: branding?.principal_signature_path
          ? (map.get(branding.principal_signature_path) ?? null)
          : null,
      }
    },
  })

  // Paginated fetch of all active students (handles 2,566+ AMCEC records beyond PostgREST's 1,000-row default)
  const { data: allStudents = [], isLoading: loadingStudents } = useQuery<StudentPhotoRef[]>({
    queryKey: ['institution_students_photo_index', institutionId],
    enabled: canManagePhotos,
    staleTime: 60_000,
    queryFn: async () => {
      const collected: StudentPhotoRef[] = []
      const pageSize = 1000
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('students')
          .select('id, registration_number, admission_number, full_name, photo_url')
          .eq('institution_id', institutionId)
          .is('deleted_at', null)
          .order('registration_number', { ascending: true })
          .range(from, from + pageSize - 1)
        if (error) throw error
        const rows = (data ?? []) as StudentPhotoRef[]
        collected.push(...rows)
        if (rows.length < pageSize) break
        from += pageSize
      }
      return collected
    },
  })

  const studentByUsn = useMemo(() => {
    const map = new Map<string, StudentPhotoRef>()
    for (const s of allStudents) {
      map.set(s.registration_number.trim().toUpperCase(), s)
      const adm = s.admission_number?.trim().toUpperCase()
      if (adm && !map.has(adm)) {
        map.set(adm, s)
      }
    }
    return map
  }, [allStudents])

  const exportUnmatchedCsv = () => {
    const lines = [
      'Filename,Parsed_ID',
      ...unmatchedQueued.map((u) => {
        const stem = u.file.name.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').trim().toUpperCase()
        return `"${u.file.name.replace(/"/g, '""')}","${stem}"`
      }),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Unmatched_Photo_Filenames.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportMissingPhotoStudentsCsv = () => {
    const missing = allStudents.filter((s) => !s.photo_url)
    const lines = [
      'USN,Admission_Number,Full_Name',
      ...missing.map(
        (s) =>
          `"${s.registration_number}","${s.admission_number ?? ''}","${s.full_name.replace(/"/g, '""')}"`
      ),
    ]
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Students_Missing_Photos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const studentsWithPhotoCount = useMemo(
    () => allStudents.filter((s) => Boolean(s.photo_url)).length,
    [allStudents]
  )

  const persistPrintSettings = async (patch: Record<string, unknown>, newPrimaryLogoUrl?: string | null) => {
    const current = branding ?? (await fetchInstitutionBranding(institutionId))
    const merged = {
      left_logo_url: current.left_logo_url,
      right_logo_url: current.right_logo_url,
      watermark_url: current.watermark_url,
      watermark_opacity: opacityDraft ?? current.watermark_opacity,
      header_subtitle: (subtitleDraft ?? current.header_subtitle) || null,
      ...patch,
    }

    const { error: setErr } = await supabase.from('institution_settings').upsert(
      {
        institution_id: institutionId,
        setting_group: 'EXAM_BRANDING',
        setting_key: 'print_branding',
        setting_value: merged,
        description: 'Top-left logo, top-right logo, watermark, and print header branding',
        updated_by: session?.user.id ?? null,
      },
      { onConflict: 'institution_id,setting_key' }
    )
    if (setErr) throw setErr

    if (newPrimaryLogoUrl !== undefined) {
      const { error: instErr } = await supabase
        .from('institutions')
        .update({ logo_url: newPrimaryLogoUrl, updated_by: session?.user.id ?? null })
        .eq('id', institutionId)
      if (instErr) throw instErr
    }
  }

  const uploadBrandingMutation = useMutation({
    mutationFn: async ({
      slot,
      file,
    }: {
      slot: 'left_logo' | 'right_logo' | 'watermark'
      file: File
    }) => {
      if (file.size > 5 * 1024 * 1024) throw new Error('File must be under 5 MB.')
      const ext = getFileExt(file)
      const path = `${institutionId}/branding/${slot}.${ext}`

      const { error: upErr } = await supabase.storage
        .from(BRANDING_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path)
      const bustedUrl = `${pub.publicUrl}?v=${Date.now()}`

      if (slot === 'left_logo') {
        await persistPrintSettings({ left_logo_url: bustedUrl }, bustedUrl)
      } else if (slot === 'right_logo') {
        await persistPrintSettings({ right_logo_url: bustedUrl })
      } else {
        await persistPrintSettings({ watermark_url: bustedUrl })
      }
      return slot
    },
    onSuccess: (slot) => {
      setErrorMsg(null)
      setNotice(`Updated ${slot.replace('_', ' ')} successfully. All printed documents will now embed this image.`)
      queryClient.invalidateQueries({ queryKey: ['institution_branding', institutionId] })
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed')
    },
  })

  const clearBrandingSlotMutation = useMutation({
    mutationFn: async (slot: 'left_logo' | 'right_logo' | 'watermark') => {
      if (slot === 'left_logo') {
        await persistPrintSettings({ left_logo_url: null }, null)
      } else if (slot === 'right_logo') {
        await persistPrintSettings({ right_logo_url: null })
      } else {
        await persistPrintSettings({ watermark_url: null })
      }
    },
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('Removed branding asset from printed templates.')
      queryClient.invalidateQueries({ queryKey: ['institution_branding', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to clear asset'),
  })

  const saveBrandingMetaMutation = useMutation({
    mutationFn: async () => {
      await persistPrintSettings({
        watermark_opacity: opacityDraft ?? branding?.watermark_opacity ?? 0.08,
        header_subtitle: (subtitleDraft ?? branding?.header_subtitle ?? '').trim() || null,
      })
    },
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('Saved print header subtitle and watermark opacity.')
      queryClient.invalidateQueries({ queryKey: ['institution_branding', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to save branding settings'),
  })

  const uploadSignatureMutation = useMutation({
    mutationFn: async ({ role, file }: { role: 'coe' | 'principal'; file: File }) => {
      if (file.size > 5 * 1024 * 1024) throw new Error('Signature image must be under 5 MB.')
      const ext = getFileExt(file)
      if (ext === 'svg') throw new Error('Use transparent PNG, JPG, or WEBP for signatures.')
      const path = `${institutionId}/signatures/${role}.${ext}`

      const { error: upErr } = await supabase.storage
        .from(PRIVATE_ASSETS_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined })
      if (upErr) throw upErr

      const current = branding ?? (await fetchInstitutionBranding(institutionId))
      const merged = {
        coe_signature_path: role === 'coe' ? path : current.coe_signature_path,
        principal_signature_path: role === 'principal' ? path : current.principal_signature_path,
      }

      const { error: setErr } = await supabase.from('institution_settings').upsert(
        {
          institution_id: institutionId,
          setting_group: 'EXAM_BRANDING',
          setting_key: 'exam_signatures',
          setting_value: merged,
          description: 'Private storage paths for COE and Principal digital signatures',
          updated_by: session?.user.id ?? null,
        },
        { onConflict: 'institution_id,setting_key' }
      )
      if (setErr) throw setErr
      return role
    },
    onSuccess: (role) => {
      setErrorMsg(null)
      setNotice(
        `Uploaded private ${role === 'coe' ? 'COE' : 'Principal'} signature. It will be signed on-demand during printing.`
      )
      queryClient.invalidateQueries({ queryKey: ['institution_branding', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['institution_signature_previews', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Signature upload failed'),
  })

  const clearSignatureMutation = useMutation({
    mutationFn: async (role: 'coe' | 'principal') => {
      const current = branding ?? (await fetchInstitutionBranding(institutionId))
      const merged = {
        coe_signature_path: role === 'coe' ? null : current.coe_signature_path,
        principal_signature_path: role === 'principal' ? null : current.principal_signature_path,
      }
      const { error } = await supabase.from('institution_settings').upsert(
        {
          institution_id: institutionId,
          setting_group: 'EXAM_BRANDING',
          setting_key: 'exam_signatures',
          setting_value: merged,
          updated_by: session?.user.id ?? null,
        },
        { onConflict: 'institution_id,setting_key' }
      )
      if (error) throw error
    },
    onSuccess: () => {
      setNotice('Signature cleared from digital print templates (reverts to wet signature line).')
      queryClient.invalidateQueries({ queryKey: ['institution_branding', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['institution_signature_previews', institutionId] })
    },
  })

  const handleQueueStudentPhotos = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const items: MatchedPhotoItem[] = Array.from(files).map((file) => {
      const stemUsn = file.name.replace(/\.[^.]+$/, '').trim().toUpperCase()
      return {
        file,
        stemUsn,
        student: studentByUsn.get(stemUsn.replace(/\s*\(\d+\)$/, '').trim()) ?? null,
      }
    })
    setQueuedPhotos(items)
    setNotice(null)
    setErrorMsg(null)
  }

  const bulkPhotoUploadMutation = useMutation({
    mutationFn: async () => {
      const matched = queuedPhotos.filter((q) => q.student !== null)
      if (matched.length === 0) throw new Error('No queued photos match active student USNs.')

      let uploaded = 0
      let failed = 0
      setUploadProgress({ done: 0, total: matched.length })

      const batchSize = 10
      for (let i = 0; i < matched.length; i += batchSize) {
        const chunk = matched.slice(i, i + batchSize)
        await Promise.all(
          chunk.map(async (item) => {
            const stu = item.student!
            const ext = getFileExt(item.file)
            if (ext === 'svg' || item.file.size > 5 * 1024 * 1024) {
              failed += 1
              return
            }
            const path = `${institutionId}/students/${stu.registration_number.trim().toUpperCase()}.${ext}`
            const { error: upErr } = await supabase.storage
              .from(PRIVATE_ASSETS_BUCKET)
              .upload(path, item.file, { upsert: true, contentType: item.file.type || undefined })
            if (upErr) {
              failed += 1
              return
            }
            const { error: dbErr } = await supabase
              .from('students')
              .update({ photo_url: path, updated_by: session?.user.id ?? null })
              .eq('id', stu.id)
            if (dbErr) {
              failed += 1
              return
            }
            uploaded += 1
          })
        )
        setUploadProgress({ done: Math.min(matched.length, i + batchSize), total: matched.length })
      }
      return { uploaded, failed }
    },
    onSuccess: (res) => {
      setUploadProgress(null)
      setQueuedPhotos([])
      setErrorMsg(null)
      setNotice(
        `Student photo batch complete: ${res.uploaded} uploaded & linked to private storage${
          res.failed > 0 ? ` (${res.failed} failed)` : ''
        }.`
      )
      queryClient.invalidateQueries({ queryKey: ['institution_students_photo_index', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['exam_hall_tickets', institutionId] })
    },
    onError: (err) => {
      setUploadProgress(null)
      setErrorMsg(err instanceof Error ? err.message : 'Bulk photo upload failed')
    },
  })

  if (isLoading || !branding) {
    return <div className="p-6 text-xs text-slate-500">Loading institution branding configuration...</div>
  }

  const effectiveOpacity = opacityDraft ?? branding.watermark_opacity
  const effectiveSubtitle = subtitleDraft ?? branding.header_subtitle ?? branding.university_affiliation ?? ''
  const matchedQueued = queuedPhotos.filter((q) => q.student !== null)
  const unmatchedQueued = queuedPhotos.filter((q) => q.student === null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">
          Multi-Tenant Document Branding, Signatures & Student Photos
        </h2>
        <p className="text-xs text-slate-500">
          Top-left logo, top-right logo, and optional watermark automatically appear on every printed document (Hall
          Tickets, Appearing Lists, Form A, Form B, QPDS, Room Posters, Marks Sheets, and Grade Cards).
        </p>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {notice}
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          {errorMsg}
        </div>
      )}

      {/* SECTION 1: PUBLIC DOCUMENT BRANDING (TOP-LEFT, TOP-RIGHT, WATERMARK) */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              1. Document Logos & Watermark (Public Bucket: <span className="font-mono text-xs">{BRANDING_BUCKET}</span>)
            </h3>
          </div>
          {!canManageBranding && (
            <span className="text-[11px] text-slate-500">View-only (COE / Institution Admin required to edit)</span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Top-Left Logo */}
          <div className="rounded-lg border border-slate-200 p-3 flex flex-col justify-between space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-800">Top-Left Logo (Primary Crest)</p>
              <p className="text-[11px] text-slate-500">College emblem / primary mark (PNG/SVG recommended).</p>
            </div>
            <div className="h-24 rounded-md bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center overflow-hidden p-2">
              {branding.left_logo_url ? (
                <img src={branding.left_logo_url} alt="Top-Left Logo" className="max-h-20 max-w-full object-contain" />
              ) : (
                <span className="text-[11px] text-slate-400">No top-left logo uploaded</span>
              )}
            </div>
            {canManageBranding && (
              <div className="flex items-center gap-2">
                <input
                  ref={leftLogoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadBrandingMutation.mutate({ slot: 'left_logo', file: f })
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={uploadBrandingMutation.isPending}
                  onClick={() => leftLogoRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Left Logo
                </button>
                {branding.left_logo_url && (
                  <button
                    type="button"
                    onClick={() => clearBrandingSlotMutation.mutate('left_logo')}
                    className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:text-red-600 hover:border-red-300"
                    title="Remove top-left logo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Top-Right Logo */}
          <div className="rounded-lg border border-slate-200 p-3 flex flex-col justify-between space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-800">Top-Right Logo (Accreditation / Trust)</p>
              <p className="text-[11px] text-slate-500">Optional secondary crest (e.g. NAAC, NBA, VTU, or Group logo).</p>
            </div>
            <div className="h-24 rounded-md bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center overflow-hidden p-2">
              {branding.right_logo_url ? (
                <img src={branding.right_logo_url} alt="Top-Right Logo" className="max-h-20 max-w-full object-contain" />
              ) : (
                <span className="text-[11px] text-slate-400">No top-right logo uploaded</span>
              )}
            </div>
            {canManageBranding && (
              <div className="flex items-center gap-2">
                <input
                  ref={rightLogoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadBrandingMutation.mutate({ slot: 'right_logo', file: f })
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={uploadBrandingMutation.isPending}
                  onClick={() => rightLogoRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Right Logo
                </button>
                {branding.right_logo_url && (
                  <button
                    type="button"
                    onClick={() => clearBrandingSlotMutation.mutate('right_logo')}
                    className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:text-red-600 hover:border-red-300"
                    title="Remove top-right logo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Background Watermark */}
          <div className="rounded-lg border border-slate-200 p-3 flex flex-col justify-between space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-800">Page Watermark (Optional)</p>
              <p className="text-[11px] text-slate-500">Centered softly behind every printed A4 sheet.</p>
            </div>
            <div className="h-24 rounded-md bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center overflow-hidden p-2">
              {branding.watermark_url ? (
                <img
                  src={branding.watermark_url}
                  alt="Watermark"
                  style={{ opacity: Math.max(0.15, effectiveOpacity * 2) }}
                  className="max-h-20 max-w-full object-contain"
                />
              ) : (
                <span className="text-[11px] text-slate-400">No watermark uploaded</span>
              )}
            </div>
            {canManageBranding && (
              <div className="flex items-center gap-2">
                <input
                  ref={watermarkRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadBrandingMutation.mutate({ slot: 'watermark', file: f })
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={uploadBrandingMutation.isPending}
                  onClick={() => watermarkRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Watermark
                </button>
                {branding.watermark_url && (
                  <button
                    type="button"
                    onClick={() => clearBrandingSlotMutation.mutate('watermark')}
                    className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:text-red-600 hover:border-red-300"
                    title="Remove watermark"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Header Subtitle & Watermark Opacity Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-2 border-t border-slate-100">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Print Header Subtitle / Affiliation Line (Optional Override)
            </label>
            <input
              type="text"
              disabled={!canManageBranding}
              value={subtitleDraft ?? branding.header_subtitle ?? ''}
              placeholder={branding.university_affiliation || 'e.g. An Autonomous Institution Affiliated to VTU, Belagavi | NAAC Accredited'}
              onChange={(e) => setSubtitleDraft(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Watermark Opacity: <strong>{Math.round(effectiveOpacity * 100)}%</strong>
              </label>
              <input
                type="range"
                min={0.03}
                max={0.25}
                step={0.01}
                disabled={!canManageBranding}
                value={effectiveOpacity}
                onChange={(e) => setOpacityDraft(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>
            {canManageBranding && (
              <button
                type="button"
                disabled={saveBrandingMetaMutation.isPending}
                onClick={() => saveBrandingMetaMutation.mutate()}
                className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
            )}
          </div>
        </div>

        {/* Live Mini A4 Header Preview */}
        <div className="rounded-lg border border-slate-300 bg-white p-4 relative overflow-hidden">
          {branding.watermark_url && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <img
                src={branding.watermark_url}
                alt=""
                style={{ opacity: effectiveOpacity }}
                className="max-h-28 max-w-[55%] object-contain"
              />
            </div>
          )}
          <div className="relative z-10 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="w-14 h-14 shrink-0 flex items-center justify-center">
              {branding.left_logo_url && (
                <img src={branding.left_logo_url} alt="Left" className="max-h-14 max-w-14 object-contain" />
              )}
            </div>
            <div className="flex-1 text-center min-w-0">
              <p className="text-sm font-bold uppercase text-slate-900 truncate">{branding.name}</p>
              {effectiveSubtitle && <p className="text-[11px] text-slate-600 truncate">{effectiveSubtitle}</p>}
              {branding.address_line && <p className="text-[10px] text-slate-500 truncate">{branding.address_line}</p>}
              <span className="inline-block mt-1.5 rounded bg-slate-900 px-2.5 py-0.5 text-[10px] font-semibold text-white">
                LIVE A4 HEADER PREVIEW — EXAMINATION HALL TICKET
              </span>
            </div>
            <div className="w-14 h-14 shrink-0 flex items-center justify-center">
              {branding.right_logo_url && (
                <img src={branding.right_logo_url} alt="Right" className="max-h-14 max-w-14 object-contain" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: PRIVATE SIGNATURES (COE & PRINCIPAL) */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              2. Official Digital Signatures (Private Bucket: <span className="font-mono text-xs">{PRIVATE_ASSETS_BUCKET}</span>)
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">Served via 5-minute signed URLs to COE/Admin only</span>
        </div>

        {!canManageBranding ? (
          <p className="text-xs text-slate-500">
            Digital signature management is restricted to Institution Admins, Principal, and Controller of Examinations.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* COE Signature */}
            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-800">Controller of Examinations (COE) Signature</p>
                <p className="text-[11px] text-slate-500">Transparent PNG recommended. Embedded on Hall Tickets, Grade Cards, Form A & QPDS.</p>
              </div>
              <div className="h-20 rounded bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center p-2">
                {signedSigs?.coeUrl ? (
                  <img src={signedSigs.coeUrl} alt="COE Signature" className="max-h-16 object-contain" />
                ) : (
                  <span className="text-[11px] text-slate-400">No COE signature uploaded (uses wet-sign line)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={coeSigRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadSignatureMutation.mutate({ role: 'coe', file: f })
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={uploadSignatureMutation.isPending}
                  onClick={() => coeSigRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload COE Signature
                </button>
                {branding.coe_signature_path && (
                  <button
                    type="button"
                    onClick={() => clearSignatureMutation.mutate('coe')}
                    className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Principal Signature */}
            <div className="rounded-lg border border-slate-200 p-3 space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-800">Principal / Head of Institution Signature</p>
                <p className="text-[11px] text-slate-500">Transparent PNG recommended. Embedded on Hall Tickets and Provisional Grade Cards.</p>
              </div>
              <div className="h-20 rounded bg-slate-50 border border-dashed border-slate-300 flex items-center justify-center p-2">
                {signedSigs?.principalUrl ? (
                  <img src={signedSigs.principalUrl} alt="Principal Signature" className="max-h-16 object-contain" />
                ) : (
                  <span className="text-[11px] text-slate-400">No Principal signature uploaded (uses wet-sign line)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={principalSigRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadSignatureMutation.mutate({ role: 'principal', file: f })
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={uploadSignatureMutation.isPending}
                  onClick={() => principalSigRef.current?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Principal Signature
                </button>
                {branding.principal_signature_path && (
                  <button
                    type="button"
                    onClick={() => clearSignatureMutation.mutate('principal')}
                    className="p-1.5 rounded-md border border-slate-300 text-slate-500 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: BULK USN-MATCHED STUDENT PHOTO UPLOADER */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              3. Bulk Student Passport Photo Uploader (USN-Matched · Private Bucket)
            </h3>
          </div>
          <span className="text-xs text-slate-600">
            {loadingStudents
              ? 'Indexing students...'
              : `${studentsWithPhotoCount} / ${allStudents.length} active students have photos linked`}
          </span>
        </div>

        <p className="text-xs text-slate-500">
          Name photo files by USN (e.g. <span className="font-mono">1AM25CS001.jpg</span>,{' '}
          <span className="font-mono">1AX25CS012.png</span>) and select multiple images at once. Matched files upload
          to <span className="font-mono">{PRIVATE_ASSETS_BUCKET}/{institutionId.slice(0, 8)}…/students/</span> and
          auto-embed into Hall Tickets via signed URLs.
        </p>

        {canManagePhotos && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={bulkPhotosRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                handleQueueStudentPhotos(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={loadingStudents || bulkPhotoUploadMutation.isPending}
              onClick={() => bulkPhotosRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" />
              Select Student Photos (Batch)
            </button>

            {matchedQueued.length > 0 && (
              <button
                type="button"
                disabled={bulkPhotoUploadMutation.isPending}
                onClick={() => bulkPhotoUploadMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {uploadProgress
                  ? `Uploading ${uploadProgress.done} / ${uploadProgress.total}...`
                  : `Upload ${matchedQueued.length} Matched Photo${matchedQueued.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        )}

        {queuedPhotos.length > 0 && (
          <div className="space-y-2 rounded-md bg-slate-50 border border-slate-200 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-800">
                Preview Queue: <span className="text-emerald-700">{matchedQueued.length} matched</span> ·{' '}
                <span className={unmatchedQueued.length > 0 ? 'text-amber-700' : 'text-slate-500'}>
                  {unmatchedQueued.length} unmatched (will be skipped)
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {unmatchedQueued.length > 0 && (
                  <button
                    type="button"
                    onClick={exportUnmatchedCsv}
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50"
                  >
                    Download Unmatched CSV ({unmatchedQueued.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={exportMissingPhotoStudentsCsv}
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  DB Missing Photos CSV ({allStudents.length - studentsWithPhotoCount})
                </button>
              </div>
            </div>
            {unmatchedQueued.length > 0 && (
              <div className="text-[11px] text-amber-800">
                Unmatched filenames:{' '}
                <span className="font-mono">
                  {unmatchedQueued
                    .slice(0, 15)
                    .map((u) => u.file.name)
                    .join(', ')}
                  {unmatchedQueued.length > 15 ? ` (+${unmatchedQueued.length - 15} more)` : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
