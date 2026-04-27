import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Mirrors the schema in src/domains/family/server/onboarding.ts.
// We test the schema in isolation to keep the test free of server-only imports.
const KidSchema = z.object({
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(18),
  color: z.string().default('sunset'),
  tags: z.array(z.string().max(50)).max(10).default([])
})

const OnboardingSchema = z.object({
  household_name: z.string().min(1).max(100),
  city: z.string().max(100).optional().nullable(),
  timezone: z.string().max(64).optional().nullable(),
  member_name: z.string().min(1).max(100),
  member_role: z
    .enum(['mom', 'dad', 'caregiver', 'grandparent', 'partner', 'other'])
    .default('other'),
  member_avatar_color: z.string().default('flamingo'),
  methodology: z
    .enum(['montessori', 'reggio', 'waldorf', 'play-based', 'outdoor', 'stem', 'mixed'])
    .optional()
    .nullable(),
  kids: z.array(KidSchema).max(10),
  values: z.array(z.string().max(200)).max(20).default([]),
  constraints: z.array(z.string().max(200)).max(20).default([]),
  dislikes: z.array(z.string().max(200)).max(20).default([])
})

describe('onboarding schema', () => {
  it('accepts a minimal valid payload', () => {
    const parsed = OnboardingSchema.parse({
      household_name: 'Familia Ortega',
      member_name: 'Camila',
      kids: [{ name: 'Luna', age: 3 }]
    })
    expect(parsed.household_name).toBe('Familia Ortega')
    expect(parsed.member_role).toBe('other')
    expect(parsed.kids[0]?.color).toBe('sunset')
  })

  it('rejects an empty household name', () => {
    expect(() =>
      OnboardingSchema.parse({
        household_name: '',
        member_name: 'Camila',
        kids: []
      })
    ).toThrow()
  })

  it('rejects a kid with out-of-range age', () => {
    expect(() =>
      OnboardingSchema.parse({
        household_name: 'X',
        member_name: 'Y',
        kids: [{ name: 'Z', age: 25 }]
      })
    ).toThrow()
  })

  it('rejects an unknown methodology', () => {
    expect(() =>
      OnboardingSchema.parse({
        household_name: 'X',
        member_name: 'Y',
        kids: [],
        methodology: 'attachment-parenting'
      })
    ).toThrow()
  })

  it('caps kids at 10', () => {
    const tenKids = Array.from({ length: 11 }, (_, i) => ({ name: `K${i}`, age: 3 }))
    expect(() =>
      OnboardingSchema.parse({
        household_name: 'X',
        member_name: 'Y',
        kids: tenKids
      })
    ).toThrow()
  })
})
