import { NextResponse, type NextRequest } from 'next/server'
import { exchangePublicToken } from '@/domains/finances/server/plaid-link'
import { FinancesError } from '@/domains/finances/server/errors'

export const runtime = 'nodejs'

// POST /api/finances/exchange
// Body: { public_token, entity_id, institution, accounts }
// Exchanges Plaid's public_token for a long-lived access_token, encrypts it,
// and persists the item + accounts under the chosen entity.
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const result = await exchangePublicToken(body as never)
    return NextResponse.json({ success: true, data: result })
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
