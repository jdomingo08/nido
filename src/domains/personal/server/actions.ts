'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireFamily } from '@/domains/family/server/auth'
import { isoDate, mostRecentMonday } from '@/domains/planning/server/queries'

const Day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
const Category = z.enum(['work', 'exercise', 'meal', 'errand', 'family', 'personal', 'other'])

const Base = z.object({
  title: z.string().min(1).max(100),
  category: Category,
  color: z.string().min(1).max(40),
  notes: z.string().max(500).optional().nullable(),
  start_hour: z.number().min(0).max(23.5),
  duration_min: z.number().int().min(15).max(480),
  family_member_id: z.string().uuid().nullable().optional()
})

const RecurringSchema = Base.extend({
  is_recurring: z.literal(true),
  recurring_days: z.array(Day).min(1)
})

const OneOffSchema = Base.extend({
  is_recurring: z.literal(false),
  day: Day
})

const PersonalActivityInput = z.discriminatedUnion('is_recurring', [RecurringSchema, OneOffSchema])

export type PersonalActivityInput = z.infer<typeof PersonalActivityInput>

export async function addPersonalActivity(input: PersonalActivityInput) {
  const data = PersonalActivityInput.parse(input)
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const insertData = {
    family_id: family.id,
    family_member_id: data.family_member_id ?? null,
    title: data.title.trim(),
    category: data.category,
    color: data.color,
    notes: data.notes ?? null,
    start_hour: data.start_hour,
    duration_min: data.duration_min,
    is_recurring: data.is_recurring,
    recurring_days: data.is_recurring ? data.recurring_days : [],
    day: data.is_recurring ? null : data.day,
    week_start_date: data.is_recurring ? null : isoDate(mostRecentMonday(new Date()))
  }

  const { error } = await supabase.from('personal_activities').insert(insertData)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard')
}

export async function removePersonalActivity(id: string) {
  const validated = z.string().uuid().parse(id)
  await requireFamily()
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('personal_activities').delete().eq('id', validated)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard')
}

const TimeMoveSchema = z.object({
  id: z.string().uuid(),
  day: Day.optional(),
  start_hour: z.number().min(0).max(23.5)
})

// Used by the timeline drag-to-reschedule (Stage 2). Only works for one-off rows
// today — moving a recurring rule needs an "edit single occurrence" UI we'll
// build later.
export async function movePersonalActivity(input: z.infer<typeof TimeMoveSchema>) {
  const data = TimeMoveSchema.parse(input)
  await requireFamily()
  const supabase = await createSupabaseServerClient()

  const update: { start_hour: number; day?: string } = { start_hour: data.start_hour }
  if (data.day) update.day = data.day

  const { error } = await supabase
    .from('personal_activities')
    .update(update)
    .eq('id', data.id)
    .eq('is_recurring', false)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard')
}
