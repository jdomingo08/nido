import 'server-only'

import { z } from 'zod'

// ─── Tool input schemas ────────────────────────────────────────

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .describe('Monday of the target week, ISO format YYYY-MM-DD')

const Day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])

export const QueryScheduleInput = z.object({
  week_start_date: IsoDate.optional().describe(
    'Monday of the target week. Omit to use the current week.'
  )
})

export const SuggestTimeSlotInput = z.object({
  duration_min: z
    .number()
    .int()
    .min(15)
    .max(480)
    .describe('How long the slot needs to be, in minutes'),
  preferred_day: Day.optional().describe('Preferred day of the week. Omit to consider any day.'),
  week_start_date: IsoDate.optional().describe(
    'Monday of the target week. Omit to use the current week.'
  )
})

export const SearchLocalEventsInput = z.object({
  days_ahead: z
    .number()
    .int()
    .min(1)
    .max(14)
    .optional()
    .describe(
      'How many days from today to search (1-14). Defaults to 7 (rest of this week + weekend).'
    ),
  focus: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Optional narrowing topic, e.g. 'library storytimes', 'outdoor', 'park events for toddlers', 'mom meetups'. Omit for broad family search."
    )
})

export const GetWeatherInput = z.object({
  day: z
    .enum(['today', 'tomorrow', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    .optional()
    .describe(
      "Optional day to focus on. 'today' or 'tomorrow' resolve relative to now. Day-of-week values resolve within the target week. Omit to return current conditions plus the full 7-day outlook."
    ),
  week_start_date: IsoDate.optional().describe(
    'Monday of the target week when asking about a weekday. Omit to use the current week.'
  )
})

// ─── Write-tool inputs (require explicit verbal confirmation) ──────

const Confirmed = z
  .literal(true)
  .describe(
    'Set to true ONLY after the user has verbally confirmed (yes / sí / correcto / etc). Otherwise omit.'
  )

const StatusValue = z.enum(['proposed', 'approved', 'dismissed', 'completed'])

const Category = z.enum(['work', 'exercise', 'meal', 'errand', 'family', 'personal', 'other'])

export const AddActivityInput = z.object({
  day: Day.describe('Which day of the week to schedule the kid activity'),
  start_hour: z
    .number()
    .int()
    .min(6)
    .max(20)
    .describe('Hour of day to start (0–23). Whole hours only — kid activities snap to the hour.'),
  duration_min: z
    .number()
    .int()
    .min(15)
    .max(180)
    .describe('Activity duration in minutes (15–180).'),
  title: z.string().min(1).max(100).describe('Short title, e.g. "watercolor at the kitchen table"'),
  kid_names: z
    .array(z.string().max(50))
    .min(1)
    .max(10)
    .describe(
      'Names of the kids this activity is for. Resolved against the family roster — unmatched names are dropped. Use the names as the family normally says them.'
    ),
  confirmed: Confirmed
})

export const AddPersonalActivityInput = z.object({
  title: z.string().min(1).max(100).describe('Short title, e.g. "gym", "dinner prep"'),
  category: Category,
  recurring_days: z
    .array(Day)
    .min(1)
    .max(7)
    .optional()
    .describe('If recurring weekly, the days. Mutually exclusive with `day`.'),
  day: Day.optional().describe(
    'If a one-off, the specific day. Mutually exclusive with `recurring_days`.'
  ),
  start_hour: z
    .number()
    .min(0)
    .max(23.5)
    .describe('Start time as a decimal hour. 8 = 8:00, 8.5 = 8:30. Snapped to half-hours.'),
  duration_min: z.number().int().min(15).max(480).describe('Duration in minutes (15–480).'),
  notes: z.string().max(500).optional(),
  confirmed: Confirmed
})

export const SetActivityStatusInput = z.object({
  activity_id: z
    .string()
    .uuid()
    .describe(
      'ID of the kid activity. Get this from a previous query_schedule call (each entry includes an id).'
    ),
  status: StatusValue.describe(
    "New status. 'approved' marks it green-lit, 'dismissed' soft-rejects, 'completed' is the wrap-up."
  ),
  confirmed: Confirmed
})

export const RemovePersonalActivityInput = z.object({
  activity_id: z
    .string()
    .uuid()
    .describe(
      'ID of the personal (parent) activity. Get from query_schedule. For recurring rules this removes the rule entirely.'
    ),
  confirmed: Confirmed
})

export const RegenerateDayInput = z.object({
  day: Day,
  week_start_date: IsoDate.optional().describe(
    'Monday of the target week. Omit for the current week.'
  ),
  confirmed: Confirmed
})

// ─── Tool registry ─────────────────────────────────────────────

export type VoiceToolKind = 'read' | 'write'

export type VoiceTool = {
  name: string
  kind: VoiceToolKind
  description: string
  schema: z.ZodTypeAny
}

// Slice 1: read-only tools only. Write tools (regenerate_day, add_activity,
// add_personal_activity, etc.) come in slice 2 with the confirm gate.
export const VOICE_TOOLS: Record<string, VoiceTool> = {
  query_schedule: {
    name: 'query_schedule',
    kind: 'read',
    description:
      "Read the week's schedule: kid activities and parent personal activities, grouped by day. Use this any time the user asks what's happening, what's planned, or to check a specific day.",
    schema: QueryScheduleInput
  },
  suggest_time_slot: {
    name: 'suggest_time_slot',
    kind: 'read',
    description:
      "Find open time slots in the week given a duration. Use when the user asks 'when can I…' or 'what's a good time for…'. Returns up to 5 candidate slots ranked by how well they fit (mid-day blocks, low conflict density). The model proposes one to the user; if accepted, it would in a future version add it via add_personal_activity.",
    schema: SuggestTimeSlotInput
  },
  get_weather: {
    name: 'get_weather',
    kind: 'read',
    description:
      "Read the live weather forecast for the family's city. Use whenever the user asks about the weather — today, tomorrow, the rest of the week, or a specific day. Returns current conditions plus a per-day morning/afternoon/evening summary, and (if a single day is requested) the hourly forecast for that day.",
    schema: GetWeatherInput
  },
  search_local_events: {
    name: 'search_local_events',
    kind: 'read',
    description:
      "Search the live web for real upcoming family-friendly events near the family's city — library storytimes, park programs, children's museum events, free outdoor activities, mom/parent meetups, etc. Use whenever the parent asks what's happening locally, what to do this weekend, where to take the kids, or for ideas outside the home. Returns up to ~12 events with venue, date/time, audience, and a URL when available. Cached 24 hours per city so repeated calls in the same day are cheap.",
    schema: SearchLocalEventsInput
  },
  add_activity: {
    name: 'add_activity',
    kind: 'write',
    description:
      'Add a new kid activity to the current week plan. Call AFTER verbally confirming the parsed intent (day, time, duration, title, which kids). Refuses if the week has no plan yet — say "let me generate this week first" in that case.',
    schema: AddActivityInput
  },
  add_personal_activity: {
    name: 'add_personal_activity',
    kind: 'write',
    description:
      'Add a parent activity to the household calendar (work blocks, gym, meals, errands). Either recurring (recurring_days) OR one-off (day) — not both. Call AFTER verbally confirming. Personal activities are constraints the kid orchestrator respects.',
    schema: AddPersonalActivityInput
  },
  set_activity_status: {
    name: 'set_activity_status',
    kind: 'write',
    description:
      "Change a kid activity's status (approved / dismissed / completed / proposed). Use after the user confirms what they meant — first call query_schedule to find the activity_id.",
    schema: SetActivityStatusInput
  },
  remove_personal_activity: {
    name: 'remove_personal_activity',
    kind: 'write',
    description:
      'Delete a parent activity. Get the activity_id from a query_schedule call first. Call AFTER verbally confirming.',
    schema: RemovePersonalActivityInput
  },
  regenerate_day: {
    name: 'regenerate_day',
    kind: 'write',
    description:
      "Replace ALL kid activities for a single day with a fresh AI-generated set. Costs ~$0.05 and takes 10–15 seconds. Always confirm verbally before calling — this destroys the day's existing activities.",
    schema: RegenerateDayInput
  }
}

// ─── Realtime tool-shape generator ─────────────────────────────

// Realtime expects a flat function-tool object:
//   { type: 'function', name, description, parameters: <JSON-Schema> }
// (Different from Chat Completions which nests under `function: {...}`.)
export type RealtimeFunctionTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export function buildRealtimeTools(): RealtimeFunctionTool[] {
  return Object.values(VOICE_TOOLS).map((t) => {
    // Strip the JSON-Schema $schema field — Realtime doesn't need or expect it.
    const raw = z.toJSONSchema(t.schema) as Record<string, unknown>
    const parameters = { ...raw }
    delete parameters.$schema
    return {
      type: 'function',
      name: t.name,
      description: t.description,
      parameters
    }
  })
}
