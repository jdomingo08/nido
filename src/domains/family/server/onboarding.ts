'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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
  methodologies: z
    .array(z.enum(['montessori', 'reggio', 'waldorf', 'play-based', 'outdoor', 'stem', 'mixed']))
    .max(7)
    .default([]),
  kids: z.array(KidSchema).max(10),
  values: z.array(z.string().max(200)).max(20).default([]),
  constraints: z.array(z.string().max(200)).max(20).default([]),
  dislikes: z.array(z.string().max(200)).max(20).default([])
})

export type OnboardingInput = z.infer<typeof OnboardingSchema>

export async function completeOnboarding(input: OnboardingInput) {
  const data = OnboardingSchema.parse(input)
  const supabase = await createSupabaseServerClient()

  const { data: familyId, error: rpcError } = await supabase.rpc('create_family_for_current_user', {
    p_household_name: data.household_name,
    p_city: data.city ?? '',
    p_timezone: data.timezone ?? '',
    p_locale: '',
    p_member_name: data.member_name,
    p_member_role: data.member_role,
    p_member_avatar_color: data.member_avatar_color
  })

  if (rpcError || !familyId) {
    throw new Error(rpcError?.message ?? 'Failed to create family')
  }

  if (data.methodologies.length > 0) {
    const { error: methodologyError } = await supabase
      .from('families')
      .update({ methodologies: data.methodologies })
      .eq('id', familyId)
    if (methodologyError) throw new Error(methodologyError.message)
  }

  if (data.kids.length > 0) {
    const { error: kidsError } = await supabase.from('kids').insert(
      data.kids.map((k) => ({
        family_id: familyId,
        name: k.name,
        age: k.age,
        color: k.color,
        avatar_color: k.color,
        tags: k.tags
      }))
    )
    if (kidsError) throw new Error(kidsError.message)
  }

  const allPrefs = [
    ...data.values.map((text) => ({ family_id: familyId, kind: 'value' as const, text })),
    ...data.constraints.map((text) => ({
      family_id: familyId,
      kind: 'constraint' as const,
      text
    })),
    ...data.dislikes.map((text) => ({ family_id: familyId, kind: 'dislike' as const, text }))
  ].filter((p) => p.text.trim().length > 0)

  if (allPrefs.length > 0) {
    const { error: prefsError } = await supabase.from('family_preferences').insert(allPrefs)
    if (prefsError) throw new Error(prefsError.message)
  }

  revalidatePath('/')
  redirect('/dashboard')
}

export async function signOut() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
