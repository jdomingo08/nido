import { NextResponse } from 'next/server'
import { requireFamilyOrError } from '@/domains/family/server/auth'
import { getOpenAIClient } from '@/lib/openai/client'
import { buildVoiceSystemPrompt } from '@/lib/voice/system-prompt'
import { buildRealtimeTools } from '@/lib/voice/tools'

const VOICE_MODEL = process.env.VOICE_REALTIME_MODEL ?? 'gpt-realtime'
const VOICE_VOICE = process.env.VOICE_REALTIME_VOICE ?? 'marin'

// POST /api/voice/session
// Mints an OpenAI Realtime ephemeral client_secret with the family-scoped
// system prompt and tool registry baked in. Browser uses the secret only
// for the WebRTC handshake — it's short-lived (≤ 1 minute by default) and
// carries our prompt/tools, so the client can't tamper with either.
export async function POST() {
  const auth = await requireFamilyOrError()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const instructions = await buildVoiceSystemPrompt(auth.family)
  const tools = buildRealtimeTools()

  const openai = getOpenAIClient()

  try {
    // The SDK helper creates a session + ephemeral client secret in one call.
    // Returns { value, expires_at, session: { id, ... } }.
    const secret = await openai.realtime.clientSecrets.create({
      session: {
        type: 'realtime',
        model: VOICE_MODEL,
        instructions,
        output_modalities: ['audio'],
        audio: {
          output: { voice: VOICE_VOICE },
          input: {
            transcription: { model: 'gpt-4o-transcribe' }
          }
        },
        tools,
        tool_choice: 'auto'
      }
    })

    return NextResponse.json({
      client_secret: secret.value,
      expires_at: secret.expires_at,
      model: VOICE_MODEL,
      // Pass back the OpenAI session id so the browser can correlate
      // future tool-call POSTs to a specific session in the audit log.
      session_id: secret.session && 'id' in secret.session ? secret.session.id : null
    })
  } catch (e) {
    console.error('[voice/session] mint failed', e)
    const message = e instanceof Error ? e.message : 'session_mint_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
