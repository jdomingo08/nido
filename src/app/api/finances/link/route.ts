import { NextResponse } from 'next/server'
import { createLinkToken } from '@/domains/finances/server/plaid-link'
import { FinancesError } from '@/domains/finances/server/errors'

export const runtime = 'nodejs'

// POST /api/finances/link
// Returns a Plaid link_token scoped to the current authenticated user.
// The client opens Plaid Link with this token; no Plaid secret leaves the server.
export async function POST() {
  try {
    const { link_token, expiration } = await createLinkToken()
    return NextResponse.json({ success: true, data: { link_token, expiration } })
  } catch (e) {
    if (e instanceof FinancesError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      )
    }
    const message = e instanceof Error ? e.message : 'Unexpected error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
