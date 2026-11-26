import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Upload, KeyRound, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { PRIVATE_ASSETS_BUCKET } from '@/modules/exams/printBranding'
import type { StudentFrontOfficeRecord } from '@/types/frontOffice'

interface Props {
  institutionId: string
  students: StudentFrontOfficeRecord[]
  canManagePhotos: boolean
}

function compressToJpegBlob(source: HTMLImageElement | HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
    const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
    const maxDim = 900
    const scale = Math.min(1, maxDim / Math.max(srcW || 1, srcH || 1))
    const w = Math.max(1, Math.round(srcW * scale))
    const h = Math.max(1, Math.round(srcH * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return reject(new Error('Canvas context unavailable'))
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(source, 0, 0, w, h)
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Failed to encode JPEG'))
        resolve(blob)
      },
      'image/jpeg',
      0.86
    )
  })
}

export function PhotoBoothTab({ institutionId, students, canManagePhotos }: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [lookupId, setLookupId] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [requirePinCheck, setRequirePinCheck] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [batchFilter, setBatchFilter] = useState('ALL')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const studentByLookup = useMemo(() => {
    const map = new Map<string, StudentFrontOfficeRecord>()
    for (const s of students) {
      map.set(s.registration_number.trim().toUpperCase(), s)
      if (s.admission_number) map.set(s.admission_number.trim().toUpperCase(), s)
    }
    return map
  }, [students])

  const activeStudent = useMemo(() => {
    const clean = lookupId.trim().toUpperCase()
    return clean ? (studentByLookup.get(clean) ?? null) : null
  }, [lookupId, studentByLookup])

  const analytics = useMemo(() => {
    const total = students.length
    const uploaded = students.filter((s) => Boolean(s.photo_url) || s.photo_upload_count > 0).length
    const pending = Math.max(0, total - uploaded)
    const missingPin = students.filter((s) => !s.photo_pin).length
    const batches = Array.from(
      new Set(students.map((s) => s.scheme_batch).filter((b): b is number => b !== null))
    ).sort((a, b) => b - a)
    return {
      total,
      uploaded,
      pending,
      missingPin,
      pct: total > 0 ? Math.round((uploaded / total) * 1000) / 10 : 0,
      batches,
    }
  }, [students])

  const pendingList = useMemo(() => {
    return students
      .filter((s) => !s.photo_url && s.photo_upload_count === 0)
      .filter((s) => batchFilter === 'ALL' || String(s.scheme_batch ?? '') === batchFilter)
      .slice(0, 60)
  }, [students, batchFilter])

  const generatePinsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_missing_student_pins', {
        p_institution_id: institutionId,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    onSuccess: (count) => {
      setErrorMsg(null)
      setNotice(`Generated 4-digit Photo Booth PINs for ${count} students.`)
      queryClient.invalidateQueries({ queryKey: ['front_office_students', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to generate PINs'),
  })

  const startCamera = async () => {
    try {
      setErrorMsg(null)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      setCameraActive(true)
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      }, 60)
    } catch {
      setErrorMsg('Camera access denied or unavailable. Use file upload instead.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }

  const captureFromCamera = async () => {
    if (!videoRef.current) return
    try {
      const blob = await compressToJpegBlob(videoRef.current)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewBlob(blob)
      setPreviewUrl(URL.createObjectURL(blob))
      stopCamera()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Capture failed')
    }
  }

  const handleFilePick = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Photo must be under 5 MB.')
      return
    }
    setErrorMsg(null)
    const tempUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = async () => {
      try {
        const blob = await compressToJpegBlob(img)
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setPreviewBlob(blob)
        setPreviewUrl(URL.createObjectURL(blob))
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Image processing failed')
      } finally {
        URL.revokeObjectURL(tempUrl)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(tempUrl)
      setErrorMsg('Invalid image file.')
    }
    img.src = tempUrl
  }

  const uploadPhotoMutation = useMutation({
    mutationFn: async () => {
      if (!activeStudent) throw new Error('Select a valid student USN / Admission Number first.')
      if (!previewBlob) throw new Error('Capture or select a photo first.')

      if (requirePinCheck) {
        const { data: verify, error: vErr } = await supabase.rpc('verify_student_photo_pin', {
          p_institution_id: institutionId,
          p_identifier: activeStudent.registration_number,
          p_pin: pinInput.trim(),
        })
        if (vErr) throw vErr
        const result = verify as { matched: boolean; reason?: string }
        if (!result.matched) throw new Error(result.reason || 'PIN verification failed.')
      }

      const fileStem = activeStudent.registration_number.trim().toUpperCase()
      const storagePath = `${institutionId}/students/${fileStem}.jpg`

      const { error: upErr } = await supabase.storage
        .from(PRIVATE_ASSETS_BUCKET)
        .upload(storagePath, previewBlob, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw upErr

      const { error: dbErr } = await supabase
        .from('students')
        .update({
          photo_url: storagePath,
          photo_upload_count: (activeStudent.photo_upload_count ?? 0) + 1,
          last_photo_upload: new Date().toISOString(),
          updated_by: session?.user.id ?? null,
        })
        .eq('id', activeStudent.id)
      if (dbErr) throw dbErr

      return activeStudent.registration_number
    },
    onSuccess: (usn) => {
      setErrorMsg(null)
      setNotice(`Uploaded & linked passport photo for ${usn} to private storage.`)
      setPreviewBlob(null)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      setPinInput('')
      queryClient.invalidateQueries({ queryKey: ['front_office_students', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['exam_hall_tickets', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Photo upload failed'),
  })

  return (
    <div className="space-y-5">
      {/* Analytics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total Students</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{analytics.total.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Photos Uploaded</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{analytics.uploaded.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Pending Photos</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{analytics.pending.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Completion Rate</p>
            <p className="text-2xl font-bold text-indigo-700 mt-1">{analytics.pct}%</p>
          </div>
          {canManagePhotos && analytics.missingPin > 0 && (
            <button
              type="button"
              disabled={generatePinsMutation.isPending}
              onClick={() => generatePinsMutation.mutate()}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
              title="Generate 4-digit PINs for students missing one"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Gen {analytics.missingPin} PINs
            </button>
          )}
        </div>
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

      {/* Photo Capture Desk */}
      {canManagePhotos && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Camera className="h-4 w-4 text-indigo-600" />
              Student Photo Booth Desk (Private Bucket)
            </h2>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={requirePinCheck}
                onChange={(e) => setRequirePinCheck(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              Require Student 4-Digit PIN Verification
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">USN or Admission Number</label>
              <input
                type="text"
                placeholder="e.g. 1AM25CS001"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
              />
            </div>
            {requirePinCheck && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">4-Digit PIN</label>
                <input
                  type="password"
                  maxLength={4}
                  placeholder="••••"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono tracking-widest"
                />
              </div>
            )}
          </div>

          {activeStudent && (
            <div className="rounded-md bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs text-indigo-900 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>{activeStudent.full_name}</strong> · {activeStudent.registration_number} ·{' '}
                {activeStudent.program_code} (Sem {activeStudent.current_sem})
              </div>
              <span className="font-mono text-[11px]">
                Uploads: {activeStudent.photo_upload_count} · PIN: {activeStudent.photo_pin ?? 'Not set'}
              </span>
            </div>
          )}

          {activeStudent && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleFilePick(f)
                      e.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Choose Image File
                  </button>
                  {!cameraActive ? (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Open Webcam
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={captureFromCamera}
                        className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Capture Frame
                      </button>
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
                      >
                        Stop Camera
                      </button>
                    </>
                  )}
                </div>

                {cameraActive && (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full max-w-xs rounded-lg border border-slate-300 bg-black"
                  />
                )}
              </div>

              <div className="space-y-3">
                {previewUrl ? (
                  <div className="flex items-end gap-4">
                    <img
                      src={previewUrl}
                      alt="Captured preview"
                      className="w-28 h-36 object-cover rounded-md border border-slate-300"
                    />
                    <button
                      type="button"
                      disabled={uploadPhotoMutation.isPending}
                      onClick={() => uploadPhotoMutation.mutate()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <RefreshCw className={uploadPhotoMutation.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                      {uploadPhotoMutation.isPending ? 'Uploading...' : 'Confirm & Save Photo'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Captured or uploaded photos are auto-compressed to JPEG and stored privately under{' '}
                    <span className="font-mono">{activeStudent.registration_number}.jpg</span>.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pending Uploads Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800">
            Pending Photo Uploads (Showing first {pendingList.length} of {analytics.pending})
          </span>
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
          >
            <option value="ALL">All Scheme Batches</option>
            {analytics.batches.map((b) => (
              <option key={b} value={String(b)}>
                Scheme Batch {b}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 font-semibold">USN</th>
                <th className="px-4 py-2 font-semibold">Student Name</th>
                <th className="px-4 py-2 font-semibold">Branch / Sem</th>
                <th className="px-4 py-2 font-semibold">Photo PIN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pendingList.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-emerald-700">
                    All students in this batch have photos uploaded.
                  </td>
                </tr>
              ) : (
                pendingList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono font-semibold text-slate-900">
                      <button
                        type="button"
                        onClick={() => setLookupId(s.registration_number)}
                        className="text-indigo-700 hover:underline"
                      >
                        {s.registration_number}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{s.full_name}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {s.program_code} · Sem {s.current_sem}
                    </td>
                    <td className="px-4 py-2 font-mono text-slate-500">{s.photo_pin ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
