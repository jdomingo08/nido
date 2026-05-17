import { describe, expect, it, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptToken, decryptToken } from '@/domains/finances/server/encryption'

beforeAll(() => {
  process.env.FINANCES_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('finances encryption', () => {
  it('round-trips a token', () => {
    const original = 'access-sandbox-12345-abcdef'
    const enc = encryptToken(original)
    expect(enc.ciphertext).toBeInstanceOf(Buffer)
    expect(enc.nonce).toHaveLength(12)
    expect(enc.tag).toHaveLength(16)
    expect(enc.ciphertext.toString()).not.toContain(original)

    const decrypted = decryptToken(enc)
    expect(decrypted).toBe(original)
  })

  it('produces a different nonce + ciphertext each call', () => {
    const a = encryptToken('same-token')
    const b = encryptToken('same-token')
    expect(a.nonce.equals(b.nonce)).toBe(false)
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false)
  })

  it('throws on tampered ciphertext', () => {
    const enc = encryptToken('access-token')
    const tampered = {
      ...enc,
      ciphertext: Buffer.concat([
        enc.ciphertext.subarray(0, enc.ciphertext.length - 1),
        Buffer.from([0])
      ])
    }
    expect(() => decryptToken(tampered)).toThrow()
  })

  it('throws when key is missing', () => {
    const saved = process.env.FINANCES_ENCRYPTION_KEY
    delete process.env.FINANCES_ENCRYPTION_KEY
    try {
      expect(() => encryptToken('x')).toThrow(/FINANCES_ENCRYPTION_KEY/)
    } finally {
      process.env.FINANCES_ENCRYPTION_KEY = saved
    }
  })
})
