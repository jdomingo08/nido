import OpenAI from 'openai'

let cached: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (cached) return cached

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')

  cached = new OpenAI({ apiKey })
  return cached
}

export const OPENAI_MODELS = {
  skeleton: 'gpt-4o-mini',
  validator: 'gpt-4o-mini',
  hydrate: 'gpt-4o',
  // gpt-4o produced ~9K output tokens for a full week which crossed Vercel
  // hobby's 60s function ceiling (~70s wall time). gpt-4o-mini is 3-4x faster
  // and supports structured outputs; quality is slightly lower but the time
  // budget actually fits. Upgrade to Pro or move to background jobs later
  // and we can switch this back to gpt-4o.
  orchestrate: 'gpt-4o-mini'
} as const

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
