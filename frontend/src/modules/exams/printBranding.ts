import { supabase } from '@/services/supabase'

export const BRANDING_BUCKET = 'institution-branding'
export const PRIVATE_ASSETS_BUCKET = 'tenant-private-assets'

export interface InstitutionBranding {
  institution_id: string
  name: string
  short_name: string | null
  university_affiliation: string | null
  address_line: string | null
  header_subtitle: string | null
  left_logo_url: string | null
  right_logo_url: string | null
  watermark_url: string | null
  watermark_opacity: number
  coe_signature_path: string | null
  principal_signature_path: string | null
}

type SignedUrlMap = Map<string, string>

export interface StudentPhotoLookupInput {
  key: string
  photo_url?: string | null
  registration_number?: string | null
  admission_number?: string | null
}

export function escapeHtml(val: string | number | null | undefined): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function fetchInstitutionBranding(
  institutionId: string,
  fallbackName = 'Institution'
): Promise<InstitutionBranding> {
  const [instRes, settingsRes] = await Promise.all([
    supabase
      .from('institutions')
      .select('name, short_name, university_affiliation, logo_url, address_line1, city, state')
      .eq('id', institutionId)
      .maybeSingle(),
    supabase
      .from('institution_settings')
      .select('setting_key, setting_value')
      .eq('institution_id', institutionId)
      .eq('setting_group', 'EXAM_BRANDING'),
  ])

  const inst = instRes.data
  const settingsMap = new Map<string, Record<string, unknown>>()
  for (const row of settingsRes.data ?? []) {
    if (row.setting_value && typeof row.setting_value === 'object') {
      settingsMap.set(row.setting_key as string, row.setting_value as Record<string, unknown>)
    }
  }

  const printCfg = settingsMap.get('print_branding') ?? {}
  const sigCfg = settingsMap.get('exam_signatures') ?? {}

  const rawAddressParts = [inst?.address_line1, inst?.city, inst?.state]
    .filter((v): v is string => Boolean(v && v.trim()))
    .flatMap((part) => part.split(',').map((s) => s.trim()).filter(Boolean))
  const seenAddrTokens = new Set<string>()
  const dedupedAddressParts = rawAddressParts.filter((token) => {
    const key = token.toLowerCase()
    if (seenAddrTokens.has(key)) return false
    seenAddrTokens.add(key)
    return true
  })
  const addressLine = dedupedAddressParts.join(', ') || null

  const leftLogo =
    (typeof printCfg.left_logo_url === 'string' && printCfg.left_logo_url) ||
    (typeof inst?.logo_url === 'string' && inst.logo_url) ||
    null

  const rightLogo =
    typeof printCfg.right_logo_url === 'string' && printCfg.right_logo_url
      ? printCfg.right_logo_url
      : null

  const watermarkUrl =
    typeof printCfg.watermark_url === 'string' && printCfg.watermark_url
      ? printCfg.watermark_url
      : null

  const rawOpacity = Number(printCfg.watermark_opacity)
  const watermarkOpacity =
    !Number.isNaN(rawOpacity) && rawOpacity >= 0.02 && rawOpacity <= 0.35 ? rawOpacity : 0.08

  const headerSubtitle =
    typeof printCfg.header_subtitle === 'string' && printCfg.header_subtitle.trim()
      ? printCfg.header_subtitle.trim()
      : null

  return {
    institution_id: institutionId,
    name: inst?.name ?? fallbackName,
    short_name: inst?.short_name ?? null,
    university_affiliation: inst?.university_affiliation ?? null,
    address_line: addressLine,
    header_subtitle: headerSubtitle,
    left_logo_url: leftLogo,
    right_logo_url: rightLogo,
    watermark_url: watermarkUrl,
    watermark_opacity: watermarkOpacity,
    coe_signature_path:
      typeof sigCfg.coe_signature_path === 'string' && sigCfg.coe_signature_path
        ? sigCfg.coe_signature_path
        : null,
    principal_signature_path:
      typeof sigCfg.principal_signature_path === 'string' && sigCfg.principal_signature_path
        ? sigCfg.principal_signature_path
        : null,
  }
}

export async function signPrivateAssets(
  paths: Array<string | null | undefined>,
  expiresInSeconds = 300
): Promise<SignedUrlMap> {
  const result: SignedUrlMap = new Map()
  const storagePaths: string[] = []

  for (const p of paths) {
    if (!p || !p.trim()) continue
    const clean = p.trim()
    if (/^https?:\/\//i.test(clean)) {
      result.set(clean, clean)
    } else if (!storagePaths.includes(clean)) {
      storagePaths.push(clean)
    }
  }

  const chunkSize = 100
  for (let i = 0; i < storagePaths.length; i += chunkSize) {
    const chunk = storagePaths.slice(i, i + chunkSize)
    const { data } = await supabase.storage
      .from(PRIVATE_ASSETS_BUCKET)
      .createSignedUrls(chunk, expiresInSeconds)

    for (const item of data ?? []) {
      if (item.path && item.signedUrl && !item.error) {
        result.set(item.path, item.signedUrl)
      }
    }
  }

  return result
}

/**
 * Resolves student photos in batch with automatic USN -> admission_number fallback
 * so photos uploaded before USN migration keep appearing on Hall Tickets & Temp IDs.
 */
export async function signStudentPhotosWithFallback(
  institutionId: string,
  items: StudentPhotoLookupInput[],
  expiresInSeconds = 300
): Promise<SignedUrlMap> {
  const resolved: SignedUrlMap = new Map()
  const primaryPaths: string[] = []
  const needsFallback: StudentPhotoLookupInput[] = []

  for (const item of items) {
    if (item.photo_url && item.photo_url.trim()) {
      primaryPaths.push(item.photo_url.trim())
    }
  }

  const primarySigned = await signPrivateAssets(primaryPaths, expiresInSeconds)

  for (const item of items) {
    const p = item.photo_url?.trim()
    const url = p ? primarySigned.get(p) : undefined
    if (url) {
      resolved.set(item.key, url)
    } else {
      needsFallback.push(item)
    }
  }

  if (needsFallback.length === 0) return resolved

  // Index tenant-private-assets/{institutionId}/students/ once for fast extension-agnostic fallback
  const fileIndex = new Map<string, string>()
  const folder = `${institutionId}/students`
  let offset = 0
  const limit = 1000
  while (true) {
    const { data: files, error } = await supabase.storage
      .from(PRIVATE_ASSETS_BUCKET)
      .list(folder, { limit, offset })
    if (error || !files || files.length === 0) break
    for (const f of files) {
      if (!f.name || f.name === '.emptyFolderPlaceholder') continue
      const stem = f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      if (stem && !fileIndex.has(stem)) {
        fileIndex.set(stem, `${folder}/${f.name}`)
      }
    }
    if (files.length < limit) break
    offset += limit
  }

  const fallbackPathByKey = new Map<string, string>()
  for (const item of needsFallback) {
    const candidates = [item.registration_number, item.admission_number]
      .filter((v): v is string => Boolean(v && v.trim()))
      .map((v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    for (const stem of candidates) {
      const path = fileIndex.get(stem)
      if (path) {
        fallbackPathByKey.set(item.key, path)
        break
      }
    }
  }

  if (fallbackPathByKey.size > 0) {
    const signedFallback = await signPrivateAssets(Array.from(fallbackPathByKey.values()), expiresInSeconds)
    for (const [key, path] of fallbackPathByKey.entries()) {
      const url = signedFallback.get(path)
      if (url) resolved.set(key, url)
    }
  }

  return resolved
}

export function renderBrandedHeaderHtml(
  branding: InstitutionBranding,
  documentBadge: string,
  extraSubline?: string
): string {
  const hasAnyLogo = Boolean(branding.left_logo_url || branding.right_logo_url)
  const leftSlot = hasAnyLogo
    ? `<div class="brand-logo-slot">${
        branding.left_logo_url
          ? `<img src="${escapeHtml(branding.left_logo_url)}" class="brand-logo" alt="Left Logo" />`
          : ''
      }</div>`
    : ''

  const rightSlot = hasAnyLogo
    ? `<div class="brand-logo-slot">${
        branding.right_logo_url
          ? `<img src="${escapeHtml(branding.right_logo_url)}" class="brand-logo" alt="Right Logo" />`
          : ''
      }</div>`
    : ''

  const affiliationLine = branding.header_subtitle || branding.university_affiliation || ''

  return `<div class="brand-hdr">
    ${leftSlot}
    <div class="brand-hdr-center">
      <h1>${escapeHtml(branding.name)}</h1>
      ${affiliationLine ? `<p class="brand-sub">${escapeHtml(affiliationLine)}</p>` : ''}
      ${branding.address_line ? `<p class="brand-addr">${escapeHtml(branding.address_line)}</p>` : ''}
      <div class="brand-badge">${escapeHtml(documentBadge)}</div>
      ${extraSubline ? `<p class="brand-extra">${escapeHtml(extraSubline)}</p>` : ''}
    </div>
    ${rightSlot}
  </div>`
}

export function renderWatermarkHtml(
  branding: InstitutionBranding,
  mode: 'per-page' | 'fixed'
): string {
  if (!branding.watermark_url) return ''
  const cls = mode === 'fixed' ? 'wm-layer wm-fixed' : 'wm-layer wm-page'
  return `<div class="${cls}" aria-hidden="true">
    <img src="${escapeHtml(branding.watermark_url)}" class="wm-img" style="opacity:${branding.watermark_opacity}" alt="" />
  </div>`
}

export function renderSignatureBlockHtml(
  label: string,
  signedImgUrl: string | null | undefined
): string {
  return `<div class="sig-col">
    <div class="sig-img-wrap">${
      signedImgUrl ? `<img src="${escapeHtml(signedImgUrl)}" class="sig-img" alt="${escapeHtml(label)}" />` : ''
    }</div>
    <div class="sig-line"></div>
    <span>${escapeHtml(label)}</span>
  </div>`
}

export function openBrandedPrintWindow(params: {
  title: string
  landscape?: boolean
  branding: InstitutionBranding
  watermarkMode?: 'per-page' | 'fixed'
  extraCss?: string
  headHtml?: string
  bodyHtml: string
}): void {
  const { title, landscape = false, branding, watermarkMode = 'fixed', extraCss = '', headHtml = '', bodyHtml } = params
  const win = window.open('', '_blank', 'width=1050,height=840')
  if (!win) {
    window.alert('Please allow pop-ups in your browser to print branded A4 exam documents.')
    return
  }

  const fixedWatermark = watermarkMode === 'fixed' ? renderWatermarkHtml(branding, 'fixed') : ''

  win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  ${headHtml}
  <style>
    @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111; font-size: 11px; margin: 0; background: #fff; }
    .page { position: relative; page-break-after: always; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    .doc-body { position: relative; z-index: 1; }
    .wm-layer { pointer-events: none; display: flex; align-items: center; justify-content: center; z-index: 0; }
    .wm-page { position: absolute; inset: 0; }
    .wm-fixed { position: fixed; inset: 0; }
    .wm-img { max-width: 68%; max-height: 68%; object-fit: contain; }
    .brand-hdr { display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1.5px solid #1e293b; padding-bottom: 8px; margin-bottom: 10px; }
    .brand-logo-slot { width: 64px; height: 64px; flex: 0 0 64px; display: flex; align-items: center; justify-content: center; }
    .brand-logo { max-width: 64px; max-height: 64px; object-fit: contain; }
    .brand-hdr-center { flex: 1; text-align: center; min-width: 0; }
    .brand-hdr-center h1 { margin: 0; font-size: 15px; text-transform: uppercase; letter-spacing: 0.3px; }
    .brand-sub { margin: 2px 0 0; font-size: 10.5px; color: #334155; }
    .brand-addr { margin: 2px 0 0; font-size: 9.8px; color: #475569; }
    .brand-badge { display: inline-block; margin-top: 5px; padding: 3px 10px; background: #1e293b; color: #fff; font-weight: 700; font-size: 10.5px; border-radius: 3px; }
    .brand-extra { margin: 4px 0 0; font-size: 10.5px; color: #334155; }
    .meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; font-size: 10.5px; background: #f8fafc; border: 1px solid #cbd5e1; padding: 5px 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    th, td { border: 1px solid #475569; padding: 4px 6px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    .signatures { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-top: 22px; text-align: center; font-size: 10.5px; font-weight: 600; }
    .sig-col { flex: 1; }
    .sig-img-wrap { height: 40px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 3px; }
    .sig-img { max-height: 38px; max-width: 140px; object-fit: contain; }
    .sig-line { border-top: 1px solid #334155; margin-bottom: 4px; }
    ${extraCss}
  </style>
</head>
<body>
  ${fixedWatermark}
  <div class="doc-body">${bodyHtml}</div>
  <script>
    window.addEventListener('load', function () {
      var imgs = Array.prototype.slice.call(document.images || []);
      Promise.all(imgs.map(function (img) {
        if (img.complete) return Promise.resolve();
        return new Promise(function (resolve) {
          img.onload = resolve;
          img.onerror = resolve;
        });
      })).then(function () {
        setTimeout(function () { window.print(); }, 180);
      });
    });
  </script>
</body>
</html>`)
  win.document.close()
}
