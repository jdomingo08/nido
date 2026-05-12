import { Redis } from '@upstash/redis'
import type { LocalEvent } from './types'

const CACHE_TTL_SECONDS = 24 * 60 * 60

let client: Redis | null = null

function getClient(): Redis | null {
  if (client) return client
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  client = new Redis({ url, token })
  return client
}

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/[\s,]+/g, '-')
}

// Cache key buckets shared across all families in the same locale + week, so a
// thousand Doral users hit one upstream search per week, not a thousand.
function cacheKey(city: string, weekStartIso: string): string {
  return `local-events:v1:${normalizeCity(city)}:${weekStartIso}`
}

export async function getCachedEvents(
  city: string,
  weekStartIso: string
): Promise<LocalEvent[] | null> {
  const c = getClient()
  if (!c) return null
  try {
    const hit = await c.get<LocalEvent[]>(cacheKey(city, weekStartIso))
    return hit ?? null
  } catch {
    return null
  }
}

export async function setCachedEvents(
  city: string,
  weekStartIso: string,
  events: LocalEvent[]
): Promise<void> {
  const c = getClient()
  if (!c) return
  try {
    await c.set(cacheKey(city, weekStartIso), events, { ex: CACHE_TTL_SECONDS })
  } catch {
    // Cache failures are non-fatal; we just lose the optimization.
  }
}
