import { describe, expect, it } from 'vitest'
import {
  EntityKindSchema,
  ExchangePublicTokenSchema,
  PlaidAccountTypeSchema
} from '@/domains/finances/shared/schema'

describe('finances Zod schemas', () => {
  it('accepts personal/business entity kinds', () => {
    expect(EntityKindSchema.parse('personal')).toBe('personal')
    expect(EntityKindSchema.parse('business')).toBe('business')
  })

  it('rejects unknown entity kinds', () => {
    expect(() => EntityKindSchema.parse('investment')).toThrow()
  })

  it('parses a valid Plaid exchange payload', () => {
    const parsed = ExchangePublicTokenSchema.parse({
      public_token: 'public-sandbox-abc-123',
      entity_id: '12345678-1234-4123-8123-123456789012',
      institution: { id: 'ins_1', name: 'Chase' },
      accounts: [
        { id: 'acc_1', name: 'Plat Card', mask: '0001', type: 'credit', subtype: 'credit card' }
      ]
    })
    expect(parsed.accounts).toHaveLength(1)
  })

  it('rejects an exchange payload missing public_token', () => {
    expect(() =>
      ExchangePublicTokenSchema.parse({
        entity_id: '12345678-1234-4123-8123-123456789012',
        institution: { id: 'ins_1', name: 'Chase' },
        accounts: []
      })
    ).toThrow()
  })

  it('rejects an exchange payload with non-uuid entity_id', () => {
    expect(() =>
      ExchangePublicTokenSchema.parse({
        public_token: 'public-x',
        entity_id: 'not-a-uuid',
        institution: { id: 'i', name: 'B' },
        accounts: []
      })
    ).toThrow()
  })

  it('accepts the five Plaid account types', () => {
    for (const t of ['depository', 'credit', 'loan', 'investment', 'other'] as const) {
      expect(PlaidAccountTypeSchema.parse(t)).toBe(t)
    }
  })
})
