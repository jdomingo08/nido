import type { DayForecast } from '@/lib/weather/openmeteo'
import { WeatherIconSvg } from './weather-icon'

export function WeatherStrip({ dayForecast }: { dayForecast: DayForecast }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#16121A]/30 bg-[#FBF5E8] px-3 py-2">
      {(['morning', 'afternoon', 'evening'] as const).map((part) => {
        const p = dayForecast.parts[part]
        return (
          <div key={part} className="flex items-center gap-2">
            <WeatherIconSvg icon={p.icon} />
            <div className="flex flex-col leading-tight">
              <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
                {part}
              </span>
              <span className="font-mono text-[12px] font-bold tracking-tight">
                {p.label} · {p.temp_f}°
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
