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
  orchestrate: 'gpt-4o'
} as const

export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
