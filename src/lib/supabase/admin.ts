import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

/**
 * Service-role Supabase client. Server-only — never import from client code.
 * Bypasses RLS; use sparingly and gated behind explicit admin checks.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured')
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')

  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  return cached
}
