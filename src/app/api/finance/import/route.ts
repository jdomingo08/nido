import { NextResponse } from 'next/server'
import { requireFamilyOrError } from '@/domains/family/server/auth'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { importTransactionsCsv } from '@/domains/finance/data/core'

// POST /api/finance/import
// Body: raw CSV text (text/csv or text/plain), or JSON { "csv": "..." }.
// Idempotent: importing the same file twice changes nothing, re-imports
// supersede restated rows within the file's date range, and source='manual'
// rows are never deleted. See DECISIONS.md §9 for the dedupe-key semantics.
export async function POST(request: Request) {
  const auth = await requireFamilyOrError()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let csv = ''
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as { csv?: unknown } | null
    if (typeof body?.csv === 'string') csv = body.csv
  } else {
    csv = await request.text()
  }

  if (!csv.trim()) {
    return NextResponse.json({ error: 'empty_csv' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  try {
    const result = await importTransactionsCsv(supabase, auth.family.id, csv)
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'import_failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
