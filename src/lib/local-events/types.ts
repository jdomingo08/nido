export type EventAudience = 'kids' | 'family' | 'parents' | 'general'

export type EventCategory =
  | 'library'
  | 'park'
  | 'museum'
  | 'outdoor'
  | 'class'
  | 'meetup'
  | 'community'
  | 'other'

export interface LocalEvent {
  title: string
  venue: string | null
  address: string | null
  start: string
  end: string | null
  audience: EventAudience
  category: EventCategory
  description: string
  url: string | null
  cost: string | null
}

export interface SearchLocalEventsOptions {
  city: string
  startDate: string
  endDate: string
  maxResults?: number
}

export interface SearchLocalEventsResult {
  events: LocalEvent[]
  city: string
  searchedAt: string
  cached: boolean
}
