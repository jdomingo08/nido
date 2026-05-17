import { z } from 'zod'

export const EntityKindSchema = z.enum(['personal', 'business'])
export const EntityMemberRoleSchema = z.enum(['owner', 'member'])

export const PlaidAccountTypeSchema = z.enum([
  'depository',
  'credit',
  'loan',
  'investment',
  'other'
])

const InstitutionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(200)
})

const AccountSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  mask: z.string().max(8).nullable().optional(),
  type: PlaidAccountTypeSchema,
  subtype: z.string().max(64).nullable().optional()
})

export const ExchangePublicTokenSchema = z.object({
  public_token: z.string().min(1).max(200),
  entity_id: z.string().uuid(),
  institution: InstitutionSchema,
  accounts: z.array(AccountSchema).min(0).max(50)
})

export type ExchangePublicTokenInput = z.infer<typeof ExchangePublicTokenSchema>
