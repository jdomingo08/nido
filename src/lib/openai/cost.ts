// Per-1M-tokens USD pricing — keep in sync with platform.openai.com/docs/pricing.
const PRICING_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10 },
  'text-embedding-3-small': { input: 0.02, output: 0 }
}

export function calculateCost(
  model: string,
  usage: { prompt_tokens?: number | null; completion_tokens?: number | null } | null | undefined
): number {
  if (!usage) return 0
  const pricing = PRICING_PER_1M_TOKENS[model]
  if (!pricing) return 0
  const inputCost = ((usage.prompt_tokens ?? 0) / 1_000_000) * pricing.input
  const outputCost = ((usage.completion_tokens ?? 0) / 1_000_000) * pricing.output
  return Number((inputCost + outputCost).toFixed(6))
}
