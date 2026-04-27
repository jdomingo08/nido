import { redirect } from 'next/navigation'
import { getCurrentFamily, getCurrentUser } from '@/domains/family/server/auth'
import { OnboardingFlow } from './onboarding-flow'

export default async function OnboardingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const family = await getCurrentFamily()
  if (family) redirect('/dashboard')

  return <OnboardingFlow defaultName={user.email?.split('@')[0] ?? ''} />
}
