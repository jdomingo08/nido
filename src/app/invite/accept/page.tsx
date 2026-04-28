import Link from 'next/link'
import { redirect } from 'next/navigation'
import { acceptInvite } from '@/domains/family/server/invitations'
import { getCurrentUser } from '@/domains/family/server/auth'

// The wife clicks the magic-link in her email → /auth/callback exchanges
// the code → forwards her here with `?token=…`. We validate via RPC and
// drop her on the dashboard inside the shared family. Errors render a
// dead-simple recovery page; the most common one ("you already belong to
// a family") tells her to sign out first.
export default async function AcceptInvitePage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  const user = await getCurrentUser()
  if (!user) {
    // Shouldn't happen — the auth callback runs first — but if cookies were
    // cleared, send them to login and bring them back.
    const next = `/invite/accept${token ? `?token=${encodeURIComponent(token)}` : ''}`
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  if (!token) {
    return (
      <ErrorShell
        title="missing token"
        body="this invite link is incomplete. ask the person who invited you to send a fresh one."
      />
    )
  }

  let errorMessage: string | null = null
  try {
    await acceptInvite(token)
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'something went wrong'
  }

  if (!errorMessage) {
    redirect('/dashboard')
  }

  return <ErrorShell title="invite couldn't be accepted" body={errorMessage} />
}

function ErrorShell({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen bg-[#F5ECDC] p-6 md:p-10">
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-6 shadow-[3px_3px_0_#16121A]">
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">{title}</p>
          <p className="mt-2 text-sm">{body}</p>
          <div className="mt-4 flex gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase"
            >
              go to dashboard
            </Link>
            <Link
              href="/login"
              className="rounded-lg border-2 border-[#16121A] bg-[#16121A] px-3 py-1.5 text-xs font-bold tracking-widest text-[#FBF5E8] uppercase"
            >
              sign out + try again
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
