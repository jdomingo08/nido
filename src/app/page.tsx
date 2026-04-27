import { redirect } from 'next/navigation'
import { getCurrentFamily, getCurrentUser } from '@/domains/family/server/auth'

// Single source of truth for "where should this user go right now?"
// Unauthenticated → /login
// Authenticated, no family → /onboarding
// Authenticated, family exists → /dashboard
export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const family = await getCurrentFamily()
  if (!family) redirect('/onboarding')

  redirect('/dashboard')
}
