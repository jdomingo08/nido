import type { WeatherIcon } from '@/lib/weather/openmeteo'

const ICON_TINT: Record<WeatherIcon, string> = {
  sun: '#FF7A1A',
  'partly-cloudy': '#F4D22B',
  cloud: '#B38BFF',
  rain: '#2D4DF3',
  storm: '#16121A',
  snow: '#17C3C1',
  fog: '#B7E9D5'
}

export function WeatherIconSvg({ icon, size = 22 }: { icon: WeatherIcon; size?: number }) {
  const c = ICON_TINT[icon]
  switch (icon) {
    case 'sun':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="4.5" fill={c} />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2
            return (
              <line
                key={i}
                x1={12 + Math.cos(a) * 7}
                y1={12 + Math.sin(a) * 7}
                x2={12 + Math.cos(a) * 9.5}
                y2={12 + Math.sin(a) * 9.5}
                stroke={c}
                strokeWidth="2"
                strokeLinecap="round"
              />
            )
          })}
        </svg>
      )
    case 'partly-cloudy':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <circle cx="9" cy="9" r="3.5" fill={c} />
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 6) * Math.PI * 2
            return (
              <line
                key={i}
                x1={9 + Math.cos(a) * 5.5}
                y1={9 + Math.sin(a) * 5.5}
                x2={9 + Math.cos(a) * 7.5}
                y2={9 + Math.sin(a) * 7.5}
                stroke={c}
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )
          })}
          <path d="M9 18a3.2 3.2 0 010-6.4 4 4 0 017.6-1.2 3.2 3.2 0 01.4 6.4H9z" fill="#B38BFF" />
        </svg>
      )
    case 'cloud':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M7 18a4 4 0 010-8 5 5 0 019.5-1.5A4 4 0 0117 18H7z" fill={c} />
        </svg>
      )
    case 'rain':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M7 14a4 4 0 010-8 5 5 0 019.5-1.5A4 4 0 0117 14H7z" fill={c} opacity="0.55" />
          <line x1="9" y1="17" x2="8" y2="21" stroke={c} strokeWidth="2" strokeLinecap="round" />
          <line x1="13" y1="17" x2="12" y2="21" stroke={c} strokeWidth="2" strokeLinecap="round" />
          <line x1="17" y1="17" x2="16" y2="21" stroke={c} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'storm':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M7 12a4 4 0 010-8 5 5 0 019.5-1.5A4 4 0 0117 12H7z" fill={c} opacity="0.7" />
          <path
            d="M11 13l-3 5h3l-1.5 4 4-6h-2.5l1-3z"
            fill="#F4D22B"
            stroke="#16121A"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'snow':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path
            d="M7 14a4 4 0 010-8 5 5 0 019.5-1.5A4 4 0 0117 14H7z"
            fill="#B7E9D5"
            opacity="0.7"
          />
          {[8, 12, 16].map((x) => (
            <g key={x}>
              <circle cx={x} cy="19" r="1.2" fill={c} />
            </g>
          ))}
        </svg>
      )
    case 'fog':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M3 9h18" stroke={c} strokeWidth="2" strokeLinecap="round" />
          <path d="M5 13h14" stroke={c} strokeWidth="2" strokeLinecap="round" />
          <path d="M3 17h18" stroke={c} strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
  }
}
