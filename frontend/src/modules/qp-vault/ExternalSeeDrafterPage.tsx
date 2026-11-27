import { useEffect, useState } from 'react'
import { Lock, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/services/supabase'
import type { PaperFormat, SeeOmrItem, SeeQuestionBlock } from '@/types/qpVault'
import { encryptSeeEnvelope, renderMathToHtmlString } from './vaultCrypto'

interface TokenValidationResult {
  valid: boolean
  reason?: string
  nomination_id?: string
  institution_name?: string
  course_code?: string
  course_title?: string
  department_name?: string
  setter_name?: string
  setter_email?: string
  blueprint?: PaperFormat
  has_public_key?: boolean
  public_key_pem?: string | null
}

function createEmptyBlock(): SeeQuestionBlock {
  const empty = () => ({ text: '', image: null, scheme: '', marks: '', bloom: 'L2', co: 'CO1' })
  return { a: empty(), b: empty(), c: empty() }
}

function createStandardDraft(): Record<string, { q1: SeeQuestionBlock; q2: SeeQuestionBlock }> {
  const out: Record<string, { q1: SeeQuestionBlock; q2: SeeQuestionBlock }> = {}
  for (let m = 1; m <= 5; m++) {
    out[`m${m}`] = { q1: createEmptyBlock(), q2: createEmptyBlock() }
  }
  return out
}

function createOmrDraft(): Record<string, SeeOmrItem> {
  const out: Record<string, SeeOmrItem> = {}
  for (let q = 1; q <= 50; q++) {
    out[`q${q}`] = { text: '', image: null, optA: '', optB: '', optC: '', optD: '', answer: 'A', bloom: 'L1', co: 'CO1' }
  }
  return out
}

export function ExternalSeeDrafterPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [stage, setStage] = useState<'LOADING' | 'ERROR' | 'NDA' | 'DRAFTING' | 'SUCCESS'>('LOADING')
  const [meta, setMeta] = useState<TokenValidationResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [ndaSig, setNdaSig] = useState('')
  const [busy, setBusy] = useState(false)

  const [standardModules, setStandardModules] = useState(createStandardDraft)
  const [omrQuestions, setOmrQuestions] = useState(createOmrDraft)

  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault()
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'p', 's', 'x'].includes(e.key.toLowerCase())) {
        e.preventDefault()
        window.alert('SECURITY POLICY: Copy, Paste, Save, and Print are disabled in the confidential setter portal.')
      }
    }
    window.addEventListener('contextmenu', onCtx)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('contextmenu', onCtx)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setErrorMsg('No secure appointment token found in the URL. Open the exact link provided by the COE.')
      setStage('ERROR')
      return
    }
    supabase
      .rpc('get_setter_nomination_by_token', { p_token: token })
      .then(({ data, error }) => {
        if (error) {
          setErrorMsg(error.message)
          setStage('ERROR')
          return
        }
        const res = data as TokenValidationResult
        if (!res?.valid) {
          setErrorMsg(res?.reason || 'Access denied.')
          setStage('ERROR')
          return
        }
        setMeta(res)
        setStage('NDA')
      })
  }, [token])

  const handleSignNda = async () => {
    setBusy(true)
    setErrorMsg('')
    try {
      const { error } = await supabase.rpc('record_setter_nda_acceptance', {
        p_token: token,
        p_signature_name: ndaSig.trim(),
        p_browser_agent: navigator.userAgent,
      })
      if (error) throw error
      setStage('DRAFTING')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'NDA verification failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSealAndSubmit = async () => {
    if (!meta?.public_key_pem) {
      setErrorMsg('COE Public Key is not configured for this institution yet. Contact the COE.')
      return
    }
    if (!window.confirm('WARNING: This permanently encrypts and submits your question paper. You cannot edit afterward. Proceed?')) {
      return
    }
    setBusy(true)
    setErrorMsg('')
    try {
      const format: PaperFormat = meta.blueprint ?? 'STANDARD'
      const payload =
        format === 'OMR'
          ? {
              course: meta.course_code ?? '',
              format,
              setter: meta.setter_name ?? '',
              department: meta.department_name ?? '',
              timestamp: new Date().toISOString(),
              questions: omrQuestions,
            }
          : {
              course: meta.course_code ?? '',
              format: 'STANDARD' as PaperFormat,
              setter: meta.setter_name ?? '',
              department: meta.department_name ?? '',
              timestamp: new Date().toISOString(),
              modules: standardModules,
            }

      const { encryptedAesKey, encryptedPayload } = encryptSeeEnvelope(payload, meta.public_key_pem)
      const { error } = await supabase.rpc('submit_encrypted_see_paper', {
        p_token: token,
        p_paper_format: format,
        p_encrypted_aes_key: encryptedAesKey,
        p_encrypted_payload: encryptedPayload,
        p_browser_agent: navigator.userAgent,
      })
      if (error) throw error
      setStage('SUCCESS')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setBusy(false)
    }
  }

  if (stage === 'LOADING') {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Authenticating secure link...</div>
  }

  if (stage === 'ERROR') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-md text-center space-y-3 shadow-sm">
          <AlertTriangle className="h-10 w-10 text-red-500 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">Secure Portal Locked</h1>
          <p className="text-xs text-slate-600">{errorMsg}</p>
        </div>
      </div>
    )
  }

  if (stage === 'NDA' && meta) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl max-w-2xl w-full p-8 space-y-5 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
            <ShieldAlert className="h-9 w-9 text-red-600 shrink-0" />
            <div>
              <h1 className="text-xl font-bold text-slate-900">Non-Disclosure Agreement (NDA)</h1>
              <p className="text-xs text-slate-500 font-medium">
                {meta.institution_name} · Strictly Confidential Examination Record
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-xs text-slate-700 space-y-2 leading-relaxed">
            <p>
              Dear <strong>{meta.setter_name}</strong>, you are appointed to draft the confidential Question Paper &amp;
              Scheme of Evaluation for <strong>{meta.course_code} — {meta.course_title}</strong>.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>I will maintain strict secrecy regarding the question paper and scheme of evaluation.</li>
              <li>I will not retain any soft copy or hard copy on personal devices or physical media.</li>
              <li>I acknowledge my browser audit metadata and NDA timestamp are legally recorded.</li>
            </ul>
          </div>

          {errorMsg && <p className="text-xs text-red-600 font-semibold">{errorMsg}</p>}

          <div className="rounded-lg bg-red-50 border border-red-200 p-4 space-y-2">
            <label className="block text-xs font-bold text-red-900">
              Type your full name exactly ({meta.setter_name}) to digitally sign:
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ndaSig}
                onChange={(e) => setNdaSig(e.target.value)}
                placeholder={meta.setter_name}
                className="flex-1 rounded-md border border-red-300 bg-white px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={busy || !ndaSig.trim()}
                onClick={handleSignNda}
                className="rounded-md bg-red-600 px-5 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
              >
                {busy ? 'Recording...' : 'I Agree & Sign'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (stage === 'SUCCESS') {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-slate-200 p-8 max-w-md text-center space-y-3 shadow-sm">
          <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto" />
          <h1 className="text-lg font-bold text-slate-900">Encrypted Transmission Complete</h1>
          <p className="text-xs text-slate-600">
            Your question paper has been RSA-2048 encrypted and sealed in the COE Vault. You may close this window.
          </p>
        </div>
      </div>
    )
  }

  const isOmr = meta?.blueprint === 'OMR'

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500 font-semibold">{meta?.institution_name} · Welcome, {meta?.setter_name}</p>
            <h1 className="text-xl font-bold text-slate-900">{meta?.course_code} — {meta?.course_title}</h1>
            <span className="inline-block mt-1 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
              Auto-Locked Format: {meta?.blueprint}
            </span>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={handleSealAndSubmit}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Lock className="h-4 w-4" />
            {busy ? 'Encrypting & Sealing...' : 'Seal & Submit Final Draft'}
          </button>
        </header>

        {errorMsg && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{errorMsg}</div>
        )}

        {isOmr ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 50 }, (_, i) => i + 1).map((n) => {
              const key = `q${n}`
              const q = omrQuestions[key]
              return (
                <div key={key} className="bg-white rounded-lg border border-slate-200 p-3 space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <strong className="text-indigo-900">Q{n}.</strong>
                    <select
                      value={q.answer}
                      onChange={(e) =>
                        setOmrQuestions((prev) => ({
                          ...prev,
                          [key]: { ...prev[key], answer: e.target.value as 'A' | 'B' | 'C' | 'D' },
                        }))
                      }
                      className="rounded border border-emerald-400 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-800"
                    >
                      <option value="A">Ans: A</option>
                      <option value="B">Ans: B</option>
                      <option value="C">Ans: C</option>
                      <option value="D">Ans: D</option>
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Question text..."
                    value={q.text}
                    onChange={(e) =>
                      setOmrQuestions((prev) => ({ ...prev, [key]: { ...prev[key], text: e.target.value } }))
                    }
                    className="w-full rounded border border-slate-300 p-1.5"
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['optA', 'optB', 'optC', 'optD'] as const).map((field, idx) => (
                      <input
                        key={field}
                        placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                        value={q[field]}
                        onChange={(e) =>
                          setOmrQuestions((prev) => ({
                            ...prev,
                            [key]: { ...prev[key], [field]: e.target.value },
                          }))
                        }
                        className="rounded border border-slate-300 px-2 py-1"
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((mNum) => {
              const mKey = `m${mNum}`
              const mod = standardModules[mKey]
              return (
                <section key={mKey} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <h2 className="text-sm font-bold text-indigo-900 border-b border-slate-100 pb-2">
                    MODULE {mNum} (Q{mNum * 2 - 1} OR Q{mNum * 2})
                  </h2>
                  {(['q1', 'q2'] as const).map((qKey, qIdx) => (
                    <div key={qKey} className="space-y-2">
                      <h3 className="text-xs font-bold text-slate-700">
                        Question {mNum * 2 - 1 + qIdx}
                      </h3>
                      {(['a', 'b', 'c'] as const).map((sub) => {
                        const item = mod[qKey][sub]
                        return (
                          <div key={sub} className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg">
                            <div className="md:col-span-5 space-y-1">
                              <textarea
                                rows={2}
                                placeholder={`${sub}) Question text ($...$ for LaTeX)...`}
                                value={item.text}
                                onChange={(e) =>
                                  setStandardModules((prev) => ({
                                    ...prev,
                                    [mKey]: {
                                      ...prev[mKey],
                                      [qKey]: { ...prev[mKey][qKey], [sub]: { ...item, text: e.target.value } },
                                    },
                                  }))
                                }
                                className="w-full rounded border border-slate-300 bg-white p-1.5"
                              />
                              {item.text.includes('$') && (
                                <div
                                  className="rounded bg-white border border-dashed border-indigo-200 px-2 py-1"
                                  dangerouslySetInnerHTML={{ __html: renderMathToHtmlString(item.text) }}
                                />
                              )}
                            </div>
                            <div className="md:col-span-4">
                              <textarea
                                rows={2}
                                placeholder="Scheme & Solution split-up..."
                                value={item.scheme}
                                onChange={(e) =>
                                  setStandardModules((prev) => ({
                                    ...prev,
                                    [mKey]: {
                                      ...prev[mKey],
                                      [qKey]: { ...prev[mKey][qKey], [sub]: { ...item, scheme: e.target.value } },
                                    },
                                  }))
                                }
                                className="w-full rounded border border-emerald-200 bg-emerald-50/40 p-1.5"
                              />
                            </div>
                            <div className="md:col-span-3 grid grid-cols-3 gap-1">
                              <input
                                placeholder="M"
                                value={item.marks}
                                onChange={(e) =>
                                  setStandardModules((prev) => ({
                                    ...prev,
                                    [mKey]: {
                                      ...prev[mKey],
                                      [qKey]: {
                                        ...prev[mKey][qKey],
                                        [sub]: { ...item, marks: e.target.value.replace(/\D/g, '') },
                                      },
                                    },
                                  }))
                                }
                                className="rounded border border-slate-300 bg-white px-1.5 py-1 text-center font-bold"
                              />
                              <select
                                value={item.bloom}
                                onChange={(e) =>
                                  setStandardModules((prev) => ({
                                    ...prev,
                                    [mKey]: {
                                      ...prev[mKey],
                                      [qKey]: { ...prev[mKey][qKey], [sub]: { ...item, bloom: e.target.value } },
                                    },
                                  }))
                                }
                                className="rounded border border-slate-300 bg-white px-1 py-1"
                              >
                                {['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((l) => (
                                  <option key={l} value={l}>{l}</option>
                                ))}
                              </select>
                              <select
                                value={item.co}
                                onChange={(e) =>
                                  setStandardModules((prev) => ({
                                    ...prev,
                                    [mKey]: {
                                      ...prev[mKey],
                                      [qKey]: { ...prev[mKey][qKey], [sub]: { ...item, co: e.target.value } },
                                    },
                                  }))
                                }
                                className="rounded border border-slate-300 bg-white px-1 py-1"
                              >
                                {['CO1', 'CO2', 'CO3', 'CO4', 'CO5', 'CO6'].map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
