import { requireFamily } from '@/domains/family/server/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchCurrentWeatherForCity } from '@/lib/weather/openmeteo'
import { VoiceButtonMount } from '@/components/voice/voice-button-mount'
import { Sidebar } from './sidebar'

// Wraps every /dashboard/* page with the persistent left sidebar.
// Family + members + kids are fetched once here so child pages don't
// duplicate the queries.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, family } = await requireFamily()
  const supabase = await createSupabaseServerClient()

  const [{ data: members }, { data: kids }, weather] = await Promise.all([
    supabase
      .from('family_members')
      .select('*')
      .eq('family_id', family.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('kids')
      .select('*')
      .eq('family_id', family.id)
      .order('created_at', { ascending: true }),
    fetchCurrentWeatherForCity(family.city)
  ])

  return (
    <div className="flex min-h-screen bg-[#F5ECDC]">
      <Sidebar
        family={family}
        members={members ?? []}
        kids={kids ?? []}
        weather={weather}
        userEmail={user.email}
      />
      <div className="min-w-0 flex-1">{children}</div>
      <VoiceButtonMount />
    </div>
  )
}
