import { getOpenAIClient } from '@/lib/openai/client'
import type { LocalEvent, SearchLocalEventsOptions } from './types'

const PROVIDER_MODEL = process.env.LOCAL_EVENTS_MODEL ?? 'gpt-4o-mini'

// JSON schema enforced on the model output. Hand-written rather than generated
// from a Zod schema so we don't pull in zod-to-json-schema as a new dep.
const EVENT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          venue: { type: ['string', 'null'] },
          address: { type: ['string', 'null'] },
          start: {
            type: 'string',
            description:
              'ISO 8601 datetime in the local timezone of the city. Date-only ok if time unknown.'
          },
          end: { type: ['string', 'null'] },
          audience: {
            type: 'string',
            enum: ['kids', 'family', 'parents', 'general']
          },
          category: {
            type: 'string',
            enum: ['library', 'park', 'museum', 'outdoor', 'class', 'meetup', 'community', 'other']
          },
          description: { type: 'string' },
          url: { type: ['string', 'null'] },
          cost: { type: ['string', 'null'] }
        },
        required: [
          'title',
          'venue',
          'address',
          'start',
          'end',
          'audience',
          'category',
          'description',
          'url',
          'cost'
        ],
        additionalProperties: false
      }
    }
  },
  required: ['events'],
  additionalProperties: false
} as const

function buildPrompt(opts: SearchLocalEventsOptions): string {
  const max = opts.maxResults ?? 12
  return [
    `Find real, upcoming community events suitable for families with young children (ages 0-8) within roughly 10 miles of ${opts.city}.`,
    `Date range: ${opts.startDate} through ${opts.endDate}.`,
    '',
    'Include things like:',
    '- Library storytimes and kids programs',
    '- Park / nature center / botanical garden activities',
    '- Children museum exhibits and workshops',
    '- Free outdoor concerts, festivals, farmers markets',
    '- Mommy-and-me classes, parent meetups, support groups',
    '- Free or low-cost classes (art, music, swim, gym)',
    '',
    'Skip:',
    '- Adult-only events (bars, 18+ shows)',
    '- Online/virtual events',
    '- Events that have already passed',
    '- Vague "every weekday" listings without a specific date',
    '',
    `Return up to ${max} events. Search reputable local sources (city/county websites, library calendars, Eventbrite, local parenting blogs, official venue sites). Provide an authoritative source URL when available. If a field is unknown leave it null — do not invent.`
  ].join('\n')
}

interface RawResponseOutput {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
}

function extractText(response: RawResponseOutput): string | null {
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text
  }
  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (
            (block?.type === 'output_text' || block?.type === 'text') &&
            typeof block.text === 'string'
          ) {
            return block.text
          }
        }
      }
    }
  }
  return null
}

export async function fetchEventsFromProvider(
  opts: SearchLocalEventsOptions
): Promise<LocalEvent[]> {
  const openai = getOpenAIClient()
  const prompt = buildPrompt(opts)

  // OpenAI's Responses API exposes the hosted `web_search` tool that grounds
  // the model in live web results. Combined with a structured JSON schema on
  // text.format we get back a clean event list without a second extraction pass.
  const response = await openai.responses.create({
    model: PROVIDER_MODEL,
    input: prompt,
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    text: {
      format: {
        type: 'json_schema',
        name: 'local_events',
        strict: true,
        schema: EVENT_OUTPUT_SCHEMA
      }
    }
  })

  const text = extractText(response as RawResponseOutput)
  if (!text) {
    console.warn('[local-events] provider returned no text output')
    return []
  }

  try {
    const parsed = JSON.parse(text) as { events?: LocalEvent[] }
    return parsed.events ?? []
  } catch (e) {
    console.warn('[local-events] failed to parse provider JSON', e)
    return []
  }
}
