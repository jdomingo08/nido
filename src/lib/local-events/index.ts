import { getCachedEvents, setCachedEvents } from './cache'
import { fetchEventsFromProvider } from './provider'
import type {
  LocalEvent,
  SearchLocalEventsOptions,
  SearchLocalEventsResult
} from './types'

export type {
  LocalEvent,
  SearchLocalEventsOptions,
  SearchLocalEventsResult,
  EventAudience,
  EventCategory
} from './types'

// ISO week-anchor for the cache key: Monday 00:00 UTC of the week containing
// `startDate`. Two requests landing in the same week share one upstream call.
function weekAnchor(startDate: string): string {
  const d = new Date(`${startDate}T00:00:00Z`)
  const dow = d.getUTCDay()
  const daysSinceMonday = (dow + 6) % 7
  d.setUTCDate(d.getUTCDate() - daysSinceMonday)
  return d.toISOString().slice(0, 10)
}

export async function searchLocalEvents(
  opts: SearchLocalEventsOptions
): Promise<SearchLocalEventsResult> {
  const trimmedCity = opts.city.trim()
  const now = new Date().toISOString()

  if (!trimmedCity) {
    return { events: [], city: trimmedCity, searchedAt: now, cached: false }
  }

  const weekKey = weekAnchor(opts.startDate)
  const cached = await getCachedEvents(trimmedCity, weekKey)
  if (cached) {
    return { events: cached, city: trimmedCity, searchedAt: now, cached: true }
  }

  let events: LocalEvent[] = []
  try {
    events = await fetchEventsFromProvider({ ...opts, city: trimmedCity })
  } catch (e) {
    console.warn('[local-events] provider failed', e)
    return { events: [], city: trimmedCity, searchedAt: now, cached: false }
  }

  if (events.length > 0) {
    await setCachedEvents(trimmedCity, weekKey, events)
  }

  return { events, city: trimmedCity, searchedAt: now, cached: false }
}
