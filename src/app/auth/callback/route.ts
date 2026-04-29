import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Handles Supabase OAuth, magic-link, and invite redirects.
// Supabase emits one of two callback shapes depending on flow + project config:
//   - PKCE code flow → ?code=...      → exchangeCodeForSession
//   - Token-hash flow → ?token_hash=... &type=... → verifyOtp
// We support both so invite emails ("type=invite") work alongside
// email/password magic-link sign-in.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const queryNext = searchParams.get('next')

  const supabase = await createSupabaseServerClient()

  let exchanged = false
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    exchanged = !error
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    exchanged = !error
  }

  if (!exchanged) {
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }

  // Resolve where to send the user. Order:
  //   1. Explicit ?next= on the callback URL (magic-link signin, etc.)
  //   2. Invite recovery: if the freshly-signed-in user has an `invite_token`
  //      on their metadata (we set this when calling
  //      auth.admin.inviteUserByEmail), drop them on /invite/accept so the
  //      RPC runs. This rescues the case where Supabase's "set password"
  //      template strips the `next=` param mid-flow.
  //   3. Root.
  let next = queryNext ?? '/'
  if (!queryNext) {
    const {
      data: { user }
    } = await supabase.auth.getUser()
    const inviteToken = user?.user_metadata?.invite_token
    if (typeof inviteToken === 'string' && inviteToken.length > 0) {
      next = `/invite/accept?token=${encodeURIComponent(inviteToken)}`
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
