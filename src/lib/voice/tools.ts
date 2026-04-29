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
