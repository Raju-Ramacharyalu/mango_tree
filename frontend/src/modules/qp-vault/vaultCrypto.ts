import forge from 'node-forge'
import katex from 'katex'
import type {
  IaEncryptedEnvelope,
  IaVaultPayload,
  SeeDecryptedPayload,
} from '@/types/qpVault'

export const KATEX_PRINT_HEAD_HTML =
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />'

export function generateCoeRsaKeypair(): Promise<{
  publicKeyPem: string
  privateKeyPem: string
  fingerprint: string
}> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 }, (err, keypair) => {
      if (err || !keypair) {
        reject(err ?? new Error('RSA keypair generation failed'))
        return
      }
      const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey)
      const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey)
      const md = forge.md.sha256.create()
      md.update(publicKeyPem)
      const fingerprint = md.digest().toHex().slice(0, 16).toUpperCase()
      resolve({ publicKeyPem, privateKeyPem, fingerprint })
    })
  })
}

export function validatePrivateKeyPem(pemText: string): boolean {
  try {
    forge.pki.privateKeyFromPem(pemText.trim())
    return true
  } catch {
    return false
  }
}

export function encryptIaEnvelope(
  payloadObj: IaVaultPayload,
  pin: string,
  facultyCode: string,
  coePublicKeyPem: string | null
): string {
  const jsonUtf8 = forge.util.encodeUtf8(JSON.stringify(payloadObj))
  const paperKey = forge.random.getBytesSync(32)
  const iv = forge.random.getBytesSync(16)

  const cipher = forge.cipher.createCipher('AES-CBC', paperKey)
  cipher.start({ iv })
  cipher.update(forge.util.createBuffer(jsonUtf8))
  cipher.finish()
  const cipherB64 = forge.util.encode64(cipher.output.getBytes())

  const cleanFac = facultyCode.trim().toUpperCase()
  const salt = forge.util.encodeUtf8(`AMC_IA_VAULT_${cleanFac}`)
  const pinDerivedKey = forge.pkcs5.pbkdf2(pin.trim(), salt, 1000, 32)
  const pinIv = forge.random.getBytesSync(16)

  const pinCipher = forge.cipher.createCipher('AES-CBC', pinDerivedKey)
  pinCipher.start({ iv: pinIv })
  pinCipher.update(forge.util.createBuffer(paperKey))
  pinCipher.finish()
  const facultyLockB64 = forge.util.encode64(pinCipher.output.getBytes())

  let coeLockB64: string | null = null
  if (coePublicKeyPem) {
    const pubKey = forge.pki.publicKeyFromPem(coePublicKeyPem)
    const rsaEnc = pubKey.encrypt(paperKey, 'RSA-OAEP')
    coeLockB64 = forge.util.encode64(rsaEnc)
  }

  const envelope: IaEncryptedEnvelope = {
    v: 1,
    encrypted: true,
    qp_pattern: payloadObj.qpPattern,
    iv: forge.util.encode64(iv),
    cipher: cipherB64,
    pin_iv: forge.util.encode64(pinIv),
    faculty_lock: facultyLockB64,
    coe_lock: coeLockB64,
  }
  return JSON.stringify(envelope)
}

export function decryptIaEnvelopeWithPin(
  envelope: IaEncryptedEnvelope,
  pin: string,
  facultyCode: string
): IaVaultPayload {
  const cleanFac = facultyCode.trim().toUpperCase()
  const salt = forge.util.encodeUtf8(`AMC_IA_VAULT_${cleanFac}`)
  const pinDerivedKey = forge.pkcs5.pbkdf2(pin.trim(), salt, 1000, 32)
  const pinIv = forge.util.decode64(envelope.pin_iv)
  const encPaperKey = forge.util.decode64(envelope.faculty_lock)

  const pinDecipher = forge.cipher.createDecipher('AES-CBC', pinDerivedKey)
  pinDecipher.start({ iv: pinIv })
  pinDecipher.update(forge.util.createBuffer(encPaperKey))
  if (!pinDecipher.finish()) {
    throw new Error('Invalid 4-Digit PIN: unable to unlock encrypted question paper.')
  }
  const paperKey = pinDecipher.output.getBytes()

  const iv = forge.util.decode64(envelope.iv)
  const encCipher = forge.util.decode64(envelope.cipher)
  const decipher = forge.cipher.createDecipher('AES-CBC', paperKey)
  decipher.start({ iv })
  decipher.update(forge.util.createBuffer(encCipher))
  if (!decipher.finish()) {
    throw new Error('Vault cipher corrupted or invalid PIN.')
  }
  return JSON.parse(forge.util.decodeUtf8(decipher.output.getBytes())) as IaVaultPayload
}

export function decryptIaEnvelopeWithCoePem(
  envelope: IaEncryptedEnvelope,
  privateKeyPem: string
): IaVaultPayload {
  if (!envelope.coe_lock) {
    throw new Error('Missing coe_lock: this paper was saved before a tenant COE Public Key was published.')
  }
  const privKey = forge.pki.privateKeyFromPem(privateKeyPem.trim())
  const encPaperKey = forge.util.decode64(envelope.coe_lock)
  let paperKey: string
  try {
    paperKey = privKey.decrypt(encPaperKey, 'RSA-OAEP')
  } catch {
    paperKey = privKey.decrypt(encPaperKey, 'RSAES-PKCS1-V1_5')
  }

  const iv = forge.util.decode64(envelope.iv)
  const encCipher = forge.util.decode64(envelope.cipher)
  const decipher = forge.cipher.createDecipher('AES-CBC', paperKey)
  decipher.start({ iv })
  decipher.update(forge.util.createBuffer(encCipher))
  if (!decipher.finish()) {
    throw new Error('Decryption failed: loaded .pem private key does not match this institution vault.')
  }
  return JSON.parse(forge.util.decodeUtf8(decipher.output.getBytes())) as IaVaultPayload
}

export function encryptSeeEnvelope(
  payload: SeeDecryptedPayload,
  coePublicKeyPem: string
): { encryptedAesKey: string; encryptedPayload: string } {
  const aesKey = forge.random.getBytesSync(32)
  const iv = forge.random.getBytesSync(16)
  const cipher = forge.cipher.createCipher('AES-CBC', aesKey)
  cipher.start({ iv })
  cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(JSON.stringify(payload))))
  if (!cipher.finish()) throw new Error('Unable to encrypt SEE payload.')

  const rsaPublicKey = forge.pki.publicKeyFromPem(coePublicKeyPem.trim())
  const keyAndIv = `${forge.util.encode64(aesKey)}::${forge.util.encode64(iv)}`
  const encryptedAesKey = forge.util.encode64(rsaPublicKey.encrypt(keyAndIv, 'RSA-OAEP'))
  const encryptedPayload = forge.util.encode64(cipher.output.getBytes())
  return { encryptedAesKey, encryptedPayload }
}

export function decryptSeeEnvelopeWithCoePem(
  encryptedAesKey: string,
  encryptedPayload: string,
  privateKeyPem: string
): SeeDecryptedPayload {
  const privKey = forge.pki.privateKeyFromPem(privateKeyPem.trim())
  const rawEncKey = forge.util.decode64(encryptedAesKey)
  let keyAndIv: string
  try {
    keyAndIv = privKey.decrypt(rawEncKey, 'RSA-OAEP')
  } catch {
    keyAndIv = privKey.decrypt(rawEncKey, 'RSAES-PKCS1-V1_5')
  }
  const [aesKey64, iv64] = keyAndIv.split('::')
  if (!aesKey64 || !iv64) throw new Error('Invalid AES envelope header.')

  const decipher = forge.cipher.createDecipher('AES-CBC', forge.util.decode64(aesKey64))
  decipher.start({ iv: forge.util.decode64(iv64) })
  decipher.update(forge.util.createBuffer(forge.util.decode64(encryptedPayload)))
  if (!decipher.finish()) {
    throw new Error('Decryption failed: loaded .pem key does not match this SEE paper.')
  }
  return JSON.parse(forge.util.decodeUtf8(decipher.output.getBytes())) as SeeDecryptedPayload
}

export function renderMathToHtmlString(rawText = ''): string {
  if (!rawText) return ''
  const escapePlain = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>')

  const tokens = String(rawText).split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g)
  return tokens
    .map((token) => {
      if (token.startsWith('$$') && token.endsWith('$$')) {
        try {
          return katex.renderToString(normalizeMathExpression(token.slice(2, -2)), { displayMode: true, throwOnError: false })
        } catch {
          return escapePlain(token)
        }
      }
      if (token.startsWith('$') && token.endsWith('$')) {
        try {
          return katex.renderToString(normalizeMathExpression(token.slice(1, -1)), { displayMode: false, throwOnError: false })
        } catch {
          return escapePlain(token)
        }
      }
      return escapePlain(token)
    })
    .join('')
}

export function compressDiagramToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select a valid image file (PNG, JPG, WebP).'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read image file.'))
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = () => reject(new Error('Corrupted image content.'))
      img.onload = () => {
        const maxW = 520
        const maxH = 240
        const ratio = Math.min(1, maxW / img.width, maxH / img.height)
        let w = Math.max(1, Math.round(img.width * ratio))
        let h = Math.max(1, Math.round(img.height * ratio))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas unavailable'))
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        let dataUrl = canvas.toDataURL('image/jpeg', 0.55)
        if (dataUrl.length > 24500) {
          w = Math.max(1, Math.round(w * 0.82))
          h = Math.max(1, Math.round(h * 0.82))
          canvas.width = w
          canvas.height = h
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          dataUrl = canvas.toDataURL('image/jpeg', 0.42)
        }
        resolve(dataUrl)
      }
      img.src = String(e.target?.result ?? '')
    }
    reader.readAsDataURL(file)
  })
}

export function containsMathOrSpecialSymbols(str = ''): boolean {
  if (!str) return false
  return /\$|\\(frac|int|iint|sum|prod|sqrt|lim|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|tau|phi|omega|Omega|Delta|infty|pm|leq|geq|neq|approx|times|div|partial|nabla|vec|hat|bar|begin|cdot|rightarrow|rightleftharpoons|equiv)|[^\x00-\x7F]/.test(
    String(str)
  )
}

export function normalizeMathExpression(expr = ''): string {
  let s = String(expr).trim()
  s = s.replace(/\\left\[\s*\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}\s*\\right\]/g, '\\begin{bmatrix}$1\\end{bmatrix}')
  s = s.replace(/\[\s*\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}\s*\]/g, '\\begin{bmatrix}$1\\end{bmatrix}')
  s = s.replace(/\\left\(\s*\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}\s*\\right\)/g, '\\begin{pmatrix}$1\\end{pmatrix}')
  s = s.replace(/\(\s*\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}\s*\)/g, '\\begin{pmatrix}$1\\end{pmatrix}')
  s = s.replace(/\\left\|\s*\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}\s*\\right\|/g, '\\begin{vmatrix}$1\\end{vmatrix}')
  s = s.replace(/\|\s*\\begin\{matrix\}([\s\S]*?)\\end\{matrix\}\s*\|/g, '\\begin{vmatrix}$1\\end{vmatrix}')
  s = s.replace(/\\?\bmod\s*~\s*/gi, '\\text{mod } ')
  s = s.replace(/~/g, '\\ ')
  return s
}

export function getBase64SizeKB(dataUrl = ''): number {
  return dataUrl ? Math.max(1, Math.round((dataUrl.length * 0.75) / 1024)) : 0
}
