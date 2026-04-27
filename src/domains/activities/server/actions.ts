'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const StatusSchema = z.enum(['proposed', 'approved', 'dismissed', 'completed', 'missed'])

export async function setActivityStatus(activityId: string, status: z.infer<typeof StatusSchema>) {
  const validated = StatusSchema.parse(status)
  const supabase = await createSupabaseServerClient()

  const update: {
    status: typeof validated
    completed_at?: string | null
    completed_source?: 'manual' | null
  } = {
    status: validated
  }

  if (validated === 'completed') {
    update.completed_at = new Date().toISOString()
    update.completed_source = 'manual'
  }

  const { error } = await supabase.from('activities').update(update).eq('id', activityId)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard')
}

// Form action wrappers (work with `<form action={...}>`)
export async function approveActivity(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing activity id')
  await setActivityStatus(id, 'approved')
}

export async function dismissActivity(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing activity id')
  await setActivityStatus(id, 'dismissed')
}

const MoveSchema = z.object({
  id: z.string().uuid(),
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).optional(),
  start_hour: z.number().int().min(0).max(23)
})

// Reschedule a kid activity. Drag-to-reschedule on the day timeline calls this.
// Kid activities are stored with integer hour granularity (the orchestrator
// generates them on the hour); the timeline drag snaps to whole-hour slots.
export async function moveActivity(input: z.infer<typeof MoveSchema>) {
  const data = MoveSchema.parse(input)
  const supabase = await createSupabaseServerClient()

  const update: { start_hour: number; day?: string } = { start_hour: data.start_hour }
  if (data.day) update.day = data.day

  const { error } = await supabase.from('activities').update(update).eq('id', data.id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard', 'layout')
}
