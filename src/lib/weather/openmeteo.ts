// Open-Meteo client. Free, no API key required.
// Docs: https://open-meteo.com/en/docs

export type DayId = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type WeatherIcon = 'sun' | 'partly-cloudy' | 'cloud' | 'rain' | 'storm' | 'snow' | 'fog'

export type PartForecast = {
  code: number
  icon: WeatherIcon
  label: string
  temp_f: number
  temp_c: number
}

export type DayPart = 'morning' | 'afternoon' | 'evening'

export type DayForecast = {
  day: DayId
  date: string // YYYY-MM-DD
  parts: Record<DayPart, PartForecast>
}

export async function geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    city
  )}&count=1&language=en`
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) return null
    const data = (await res.json()) as { results?: Array<{ latitude: number; longitude: number }> }
    const first = data.results?.[0]
    if (!first) return null
    return { lat: first.latitude, lon: first.longitude }
  } catch {
    return null
  }
}

export async function fetchWeekForecast(args: {
  lat: number
  lon: number
  startDate: Date
}): Promise<DayForecast[]> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(args.lat))
  url.searchParams.set('longitude', String(args.lon))
  url.searchParams.set('hourly', 'temperature_2m,weather_code')
  url.searchParams.set('forecast_days', '7')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('temperature_unit', 'fahrenheit')

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast failed: ${res.status}`)
  }

  const data = (await res.json()) as {
    hourly: {
      time: string[]
      temperature_2m: number[]
      weather_code: number[]
    }
  }

  type DayBucket = { hours: number[]; temps: number[]; codes: number[] }
  const byDate = new Map<string, DayBucket>()

  for (let i = 0; i < data.hourly.time.length; i++) {
    const iso = data.hourly.time[i]
    if (!iso) continue
    const dateKey = iso.slice(0, 10)
    const hour = parseInt(iso.slice(11, 13), 10)
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { hours: [], temps: [], codes: [] })
    }
    const bucket = byDate.get(dateKey)!
    bucket.hours.push(hour)
    bucket.temps.push(data.hourly.temperature_2m[i] ?? 0)
    bucket.codes.push(data.hourly.weather_code[i] ?? 0)
  }

  const dayIds: DayId[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const result: DayForecast[] = []

  for (const [dateKey, bucket] of byDate) {
    const date = new Date(`${dateKey}T12:00:00`)
    const dayId = dayIds[date.getDay()] ?? 'mon'
    result.push({
      day: dayId,
      date: dateKey,
      parts: {
        morning: aggregatePart(bucket, 6, 12),
        afternoon: aggregatePart(bucket, 12, 18),
        evening: aggregatePart(bucket, 18, 22)
      }
    })
  }

  return result
}

function aggregatePart(
  bucket: { hours: number[]; temps: number[]; codes: number[] },
  fromHour: number,
  toHour: number
): PartForecast {
  const indices: number[] = []
  for (let i = 0; i < bucket.hours.length; i++) {
    const h = bucket.hours[i]
    if (h !== undefined && h >= fromHour && h < toHour) indices.push(i)
  }
  if (indices.length === 0) {
    return { code: 0, icon: 'sun', label: 'clear', temp_f: 0, temp_c: 0 }
  }
  const tempF = indices.reduce((sum, i) => sum + (bucket.temps[i] ?? 0), 0) / indices.length
  const dominantCode = mode(indices.map((i) => bucket.codes[i] ?? 0))
  return {
    code: dominantCode,
    icon: codeToIcon(dominantCode),
    label: codeToLabel(dominantCode),
    temp_f: Math.round(tempF),
    temp_c: Math.round(((tempF - 32) * 5) / 9)
  }
}

function mode(arr: number[]): number {
  const counts = new Map<number, number>()
  let best = arr[0] ?? 0
  let bestCount = 0
  for (const v of arr) {
    const next = (counts.get(v) ?? 0) + 1
    counts.set(v, next)
    if (next > bestCount) {
      best = v
      bestCount = next
    }
  }
  return best
}

// WMO weather code → minimal icon set.
// Reference: https://open-meteo.com/en/docs (Weather variable WMO Code)
function codeToIcon(code: number): WeatherIcon {
  if (code === 0) return 'sun'
  if (code <= 2) return 'partly-cloudy'
  if (code === 3) return 'cloud'
  if (code <= 48) return 'fog'
  if (code <= 67) return 'rain'
  if (code <= 77) return 'snow'
  if (code <= 82) return 'rain'
  if (code <= 86) return 'snow'
  if (code <= 99) return 'storm'
  return 'cloud'
}

function codeToLabel(code: number): string {
  if (code === 0) return 'clear'
  if (code <= 2) return 'partly cloudy'
  if (code === 3) return 'overcast'
  if (code <= 48) return 'foggy'
  if (code <= 57) return 'drizzle'
  if (code <= 67) return 'rainy'
  if (code <= 77) return 'snowy'
  if (code <= 82) return 'showers'
  if (code <= 86) return 'snowy'
  if (code <= 99) return 'storm'
  return 'cloudy'
}

// For passing the forecast to the LLM in plain text.
export function summarizeForLlm(forecast: DayForecast[]): string {
  if (forecast.length === 0) return '(no forecast available — assume mild)'
  return forecast
    .map(
      (d) =>
        `- ${d.day} (${d.date}): morning ${d.parts.morning.label} ${d.parts.morning.temp_f}°, ` +
        `afternoon ${d.parts.afternoon.label} ${d.parts.afternoon.temp_f}°, ` +
        `evening ${d.parts.evening.label} ${d.parts.evening.temp_f}°`
    )
    .join('\n')
}
