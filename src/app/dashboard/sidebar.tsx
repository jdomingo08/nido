import { signOut } from '@/domains/family/server/onboarding'
import type { Tables } from '@/lib/supabase/database.types'
import type { CurrentWeather } from '@/lib/weather/openmeteo'
import { WeatherIconSvg } from './weather-icon'
import { SidebarNav } from './sidebar-nav'

type Family = Tables<'families'>
type Member = Tables<'family_members'>
type Kid = Tables<'kids'>

const COLOR_HEX: Record<string, string> = {
  flamingo: '#FF3D7F',
  aqua: '#17C3C1',
  sunset: '#FF7A1A',
  electric: '#2D4DF3',
  citrus: '#F4D22B',
  lavender: '#B38BFF'
}

export function Sidebar({
  family,
  members,
  kids,
  weather,
  userEmail
}: {
  family: Family
  members: Member[]
  kids: Kid[]
  weather: CurrentWeather | null
  userEmail: string | undefined
}) {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r-2 border-[#16121A] bg-[#16121A] text-[#FBF5E8]">
      {/* Brand */}
      <div className="px-5 pt-6 pb-4">
        <p className="text-[36px] leading-none font-bold tracking-tight text-[#F4D22B]">nido</p>
        <p className="mt-2 font-mono text-[10px] tracking-widest uppercase opacity-60">
          {family.household_name}
        </p>
        {userEmail && (
          <p className="font-mono text-[9px] tracking-widest uppercase opacity-30">{userEmail}</p>
        )}
      </div>

      {/* Nav */}
      <SidebarNav />

      {/* Spacer pushes weather + chips to bottom */}
      <div className="flex-1" />

      {/* Weather card */}
      {weather && <SidebarWeather weather={weather} />}

      {/* Family chips */}
      <SidebarFamilyChips members={members} kids={kids} />

      {/* Sign out */}
      <form action={signOut} className="border-t border-[#FBF5E8]/15 px-3 py-3">
        <button
          type="submit"
          className="w-full rounded-md border border-[#FBF5E8]/30 px-3 py-2 font-mono text-[10px] tracking-widest text-[#FBF5E8]/70 uppercase transition hover:border-[#FBF5E8] hover:text-[#FBF5E8]"
        >
          sign out
        </button>
      </form>
    </aside>
  )
}

function SidebarWeather({ weather }: { weather: CurrentWeather }) {
  const bias = biasNarrative(weather)
  return (
    <div className="mx-3 mb-3 rounded-lg border border-[#FBF5E8]/15 bg-[#FBF5E8]/5 p-3">
      <div className="flex items-center gap-2">
        <WeatherIconSvg icon={weather.icon} size={16} />
        <span className="font-mono text-[9px] tracking-widest uppercase opacity-60">
          {weather.city} · now
        </span>
      </div>
      <p className="mt-1.5 text-[15px] font-bold tracking-tight">
        {capitalize(weather.label)}, {weather.temp_f}°F / {weather.temp_c}°C
      </p>
      <p className="mt-1 font-mono text-[10px] tracking-tight opacity-60">{bias}</p>
    </div>
  )
}

function SidebarFamilyChips({ members, kids }: { members: Member[]; kids: Kid[] }) {
  const all: Array<{ id: string; name: string; color: string; kind: 'adult' | 'kid' }> = [
    ...members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.avatar_color,
      kind: 'adult' as const
    })),
    ...kids.map((k) => ({
      id: k.id,
      name: k.name,
      color: k.avatar_color,
      kind: 'kid' as const
    }))
  ]

  if (all.length === 0) return null

  return (
    <div className="border-t border-[#FBF5E8]/15 px-3 py-3">
      <p className="mb-2 font-mono text-[9px] tracking-widest uppercase opacity-40">family</p>
      <div className="flex flex-wrap gap-1.5">
        {all.map((p) => (
          <FamilyChip key={`${p.kind}-${p.id}`} name={p.name} color={p.color} />
        ))}
      </div>
    </div>
  )
}

function FamilyChip({ name, color }: { name: string; color: string }) {
  const tint = COLOR_HEX[color] ?? '#FBF5E8'
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-[#FBF5E8]/5 py-0.5 pr-2 pl-0.5">
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-[#16121A]"
        style={{ background: tint }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="text-[11px] font-bold tracking-tight">{name}</span>
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Tiny narrative the weather "agent" prints to remind the user the orchestrator
// is reasoning about conditions. Heuristic, not LLM.
function biasNarrative(w: CurrentWeather): string {
  switch (w.icon) {
    case 'sun':
      return 'weather_agent biasing outdoor +2'
    case 'partly-cloudy':
      return 'weather_agent neutral · outdoor ok'
    case 'cloud':
      return 'weather_agent neutral · indoor ok'
    case 'rain':
    case 'storm':
      return 'weather_agent biasing indoor +2'
    case 'snow':
      return 'weather_agent biasing cozy indoor'
    case 'fog':
      return 'weather_agent suggesting near-home outings'
  }
}

// We export the sub-components explicitly so the layout can lay them out
// however it likes if needed later.
export { SidebarWeather, SidebarFamilyChips }
