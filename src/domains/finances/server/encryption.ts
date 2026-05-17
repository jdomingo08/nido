import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'
const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16

export interface EncryptedToken {
  ciphertext: Buffer
  nonce: Buffer
  tag: Buffer
}

function loadKey(): Buffer {
  const b64 = process.env.FINANCES_ENCRYPTION_KEY
  if (!b64) {
    throw new Error('FINANCES_ENCRYPTION_KEY is not set')
  }
  const key = Buffer.from(b64, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `FINANCES_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`
    )
  }
  return key
}

export function encryptToken(plaintext: string): EncryptedToken {
  const key = loadKey()
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALG, key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Unexpected GCM tag length: ${tag.length}`)
  }
  return { ciphertext, nonce, tag }
}

export function decryptToken(enc: EncryptedToken): string {
  const key = loadKey()
  const decipher = createDecipheriv(ALG, key, enc.nonce)
  decipher.setAuthTag(enc.tag)
  const plaintext = Buffer.concat([decipher.update(enc.ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
