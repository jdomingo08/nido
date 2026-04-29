import { NextResponse, type NextRequest } from 'next/server'
import { requireFamilyOrError } from '@/domains/family/server/auth'
import { dispatchTool } from '@/lib/voice/dispatcher'

// POST /api/voice/tools/[tool]
// Browser forwards a function-call from OpenAI Realtime here. We re-auth
// against the user's Supabase cookie (the browser is the user's), dispatch
// the tool against family-scoped data, and return the JSON result. The
// browser then relays this back to OpenAI via the data channel.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tool: string }> }
) {
  const auth = await requireFamilyOrError()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { tool } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const result = await dispatchTool(tool, body, auth.family.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json(result.result)
}
