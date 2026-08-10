'use server'

import { revalidatePath } from 'next/cache'
import { requireFamily } from '@/domains/family/server/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Persists which one-off charges are excluded from the books
// (finance_settings.excluded_txns — VIEWS.md state mapping). Toggling
// recalculates the entire dashboard on the next render so no two views
// ever disagree.
export async function setExcludedOneOffs(excludedIds: string[]): Promise<void> {
  const { family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const clean = excludedIds.filter((v) => typeof v === 'string').slice(0, 500)

  const { error } = await supabase.from('finance_settings').upsert(
    {
      family_id: family.id,
      excluded_txns: clean
    },
    { onConflict: 'family_id' }
  )
  if (error) throw new Error(`Failed to save one-off exclusions: ${error.message}`)

  revalidatePath('/finance')
}
