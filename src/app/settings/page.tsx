import Link from 'next/link'
import { requireFamily } from '@/domains/family/server/auth'
import { signOut } from '@/domains/family/server/onboarding'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FamilySection } from './family-section'
import { KidsSection } from './kids-section'
import { PreferencesSection } from './preferences-section'

export default async function SettingsPage() {
  const { user, family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const [{ data: kids }, { data: preferences }] = await Promise.all([
    supabase
      .from('kids')
      .select('*')
      .eq('family_id', family.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('family_preferences')
      .select('*')
      .eq('family_id', family.id)
      .order('created_at', { ascending: true })
  ])

  return (
    <main className="min-h-screen bg-[#F5ECDC] p-6 md:p-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-xs tracking-widest uppercase opacity-60">
              settings · {family.household_name}
            </p>
            <p className="font-mono text-[11px] tracking-widest uppercase opacity-50">
              signed in · {user.email}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
            >
              ← week
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
              >
                sign out
              </button>
            </form>
          </div>
        </div>

        <h1 className="mt-6 text-3xl font-bold tracking-tight md:text-4xl">the rules.</h1>
        <p className="mt-1 max-w-xl text-sm opacity-75">
          changes apply to your next week generation. regenerate from the dashboard to use them
          right away.
        </p>

        <div className="mt-8 flex flex-col gap-6">
          <FamilySection family={family} />
          <KidsSection kids={kids ?? []} />
          <PreferencesSection preferences={preferences ?? []} />
        </div>
      </div>
    </main>
  )
}
