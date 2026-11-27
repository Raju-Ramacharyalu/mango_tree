import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck, Download, Upload, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { InstitutionVaultKey } from '@/types/qpVault'
import { generateCoeRsaKeypair, validatePrivateKeyPem } from './vaultCrypto'

interface Props {
  institutionId: string
  institutionCode: string
  vaultKey: InstitutionVaultKey | null
  coePrivateKeyPem: string
  onLoadPrivateKey: (pem: string, fileName: string) => void
  onClearPrivateKey: () => void
  canManageVault: boolean
}

export function SecurityVaultTab({
  institutionId,
  institutionCode,
  vaultKey,
  coePrivateKeyPem,
  onLoadPrivateKey,
  onClearPrivateKey,
  canManageVault,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()
  const [isGenerating, setIsGenerating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleGenerateKeypair = async () => {
    if (
      vaultKey &&
      !window.confirm(
        'WARNING: Rotating this institution RSA keypair will require your NEW .pem file for future papers. Keep a backup of your previous .pem to decrypt older papers. Continue?'
      )
    ) {
      return
    }
    setIsGenerating(true)
    setErrorMsg(null)
    setNotice(null)
    try {
      const { publicKeyPem, privateKeyPem, fingerprint } = await generateCoeRsaKeypair()

      const { error } = await supabase.from('institution_vault_keys').upsert(
        {
          institution_id: institutionId,
          public_key_pem: publicKeyPem,
          key_fingerprint: fingerprint,
          algorithm: 'RSA-2048-OAEP',
          rotated_at: new Date().toISOString(),
          created_by: session?.user.id ?? null,
          updated_by: session?.user.id ?? null,
        },
        { onConflict: 'institution_id' }
      )
      if (error) throw error

      const fileName = `COE_Master_Private_Key_${institutionCode}_${fingerprint}.pem`
      const blob = new Blob([privateKeyPem], { type: 'application/x-pem-file;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)

      onLoadPrivateKey(privateKeyPem, fileName)
      setNotice(
        `Generated RSA-2048 keypair (Fingerprint: ${fingerprint}). Private key downloaded offline and unlocked in RAM for this session.`
      )
      queryClient.invalidateQueries({ queryKey: ['institution_vault_key', institutionId] })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate keypair')
    } finally {
      setIsGenerating(false)
    }
  }

  const genStaffPinsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_missing_staff_pins', {
        p_institution_id: institutionId,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    onSuccess: (count) => {
      setErrorMsg(null)
      setNotice(`Generated 4-digit Faculty IA Vault PINs for ${count} staff profiles.`)
      queryClient.invalidateQueries({ queryKey: ['qp_vault_staff', institutionId] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to generate staff PINs'),
  })

  const handleUploadPem = (file: File) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? '').trim()
      if (!validatePrivateKeyPem(text)) {
        setErrorMsg('Invalid .pem RSA Private Key file.')
        return
      }
      setErrorMsg(null)
      onLoadPrivateKey(text, file.name)
      setNotice(`Loaded ${file.name} into browser session RAM. Vault unlocked for decryption.`)
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-5">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Per-Tenant RSA Public Key Card */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-indigo-600" />
              Per-Tenant COE RSA-2048 Vault Key
            </h2>
            <span
              className={
                vaultKey
                  ? 'rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-[11px] font-semibold'
                  : 'rounded-full bg-amber-50 text-amber-800 px-2.5 py-0.5 text-[11px] font-semibold'
              }
            >
              {vaultKey ? 'Public Key Active' : 'Not Initialized'}
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Every institution holds its own isolated RSA-2048 keypair. Only the <strong>Public Key</strong> is stored
            in Supabase so faculty and external setters can encrypt papers. The <strong>Private Key (.pem)</strong>{' '}
            never touches the server and stays strictly offline with the COE.
          </p>

          {vaultKey && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
              <p>
                <strong>Fingerprint:</strong> <span className="font-mono text-indigo-800">{vaultKey.key_fingerprint}</span>
              </p>
              <p>
                <strong>Algorithm:</strong> {vaultKey.algorithm}
              </p>
              <p>
                <strong>Last Rotated:</strong> {new Date(vaultKey.rotated_at).toLocaleString()}
              </p>
            </div>
          )}

          {canManageVault && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={isGenerating}
                onClick={handleGenerateKeypair}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isGenerating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {isGenerating
                  ? 'Generating 2048-bit RSA...'
                  : vaultKey
                    ? 'Rotate Keypair & Download New .pem'
                    : 'Generate Institution RSA Keypair'}
              </button>
              <button
                type="button"
                disabled={genStaffPinsMutation.isPending}
                onClick={() => genStaffPinsMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {genStaffPinsMutation.isPending ? 'Generating...' : 'Generate Missing 4-Digit Staff PINs'}
              </button>
            </div>
          )}
        </div>

        {/* Session RAM Private Key Unlocker */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              COE Offline Private Key Session (.pem)
            </h2>
            <span
              className={
                coePrivateKeyPem
                  ? 'rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-[11px] font-semibold'
                  : 'rounded-full bg-red-50 text-red-700 px-2.5 py-0.5 text-[11px] font-semibold'
              }
            >
              {coePrivateKeyPem ? 'Vault Unlocked (RAM)' : 'Vault Locked'}
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Upload your offline <code className="font-mono">.pem</code> key to decrypt submitted SEE question papers,
            IA question papers, and OMR Master Answer Key CSVs. Closing this browser tab clears the key automatically.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              {coePrivateKeyPem ? 'Replace Loaded .pem Key' : 'Load COE Private Key (.pem)'}
              <input
                type="file"
                accept=".pem,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUploadPem(f)
                  e.target.value = ''
                }}
              />
            </label>
            {coePrivateKeyPem && (
              <button
                type="button"
                onClick={() => {
                  onClearPrivateKey()
                  setNotice('COE Private Key cleared from browser session RAM.')
                }}
                className="rounded-md border border-red-300 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Lock Vault Now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
