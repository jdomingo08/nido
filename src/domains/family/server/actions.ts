'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireFamily } from './auth'

const Methodology = z.enum([
  'montessori',
  'reggio',
  'waldorf',
  'play-based',
  'outdoor',
  'stem',
  'mixed'
])

const FamilyUpdateSchema = z.object({
  household_name: z.string().min(1).max(100),
  city: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : (v ?? null))),
  methodologies: z.array(Methodology).max(7),
  density: z.enum(['calm', 'balanced', 'packed']),
  agent_level: z.enum(['hidden', 'subtle', 'transparent']),
  locale: z.enum(['en', 'es'])
})

export type FamilyUpdateInput = z.infer<typeof FamilyUpdateSchema>

export async function updateFamily(input: FamilyUpdateInput) {
  const data = FamilyUpdateSchema.parse(input)
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('families').update(data).eq('id', family.id)
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
  revalidatePath('/dashboard')
}

// ─── Kids ────────────────────────────────────────────────────

const KidSchema = z.object({
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(18),
  color: z.string().min(1).max(40),
  tags: z.array(z.string().max(50)).max(10)
})

export type KidInput = z.infer<typeof KidSchema>

export async function addKid(input: KidInput) {
  const data = KidSchema.parse(input)
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('kids').insert({
    family_id: family.id,
    name: data.name,
    age: data.age,
    color: data.color,
    avatar_color: data.color,
    tags: data.tags
  })
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
  revalidatePath('/dashboard')
}

export async function updateKid(id: string, input: KidInput) {
  const data = KidSchema.parse(input)
  await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('kids')
    .update({
      name: data.name,
      age: data.age,
      color: data.color,
      avatar_color: data.color,
      tags: data.tags
    })
    .eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
  revalidatePath('/dashboard')
}

export async function removeKid(id: string) {
  const validated = z.string().uuid().parse(id)
  await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('kids').delete().eq('id', validated)
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
  revalidatePath('/dashboard')
}

// ─── Preferences (values, constraints, dislikes) ─────────────

const PrefKind = z.enum(['value', 'constraint', 'dislike'])
export type PrefKindValue = z.infer<typeof PrefKind>

const AddPreferenceSchema = z.object({
  kind: PrefKind,
  text: z.string().min(1).max(200)
})

export async function addPreference(input: { kind: PrefKindValue; text: string }) {
  const data = AddPreferenceSchema.parse({ ...input, text: input.text.trim() })
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('family_preferences').insert({
    family_id: family.id,
    kind: data.kind,
    text: data.text
  })
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
}

export async function removePreference(id: string) {
  const validated = z.string().uuid().parse(id)
  await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('family_preferences').delete().eq('id', validated)
  if (error) throw new Error(error.message)

  revalidatePath('/settings')
}
