import { LoginCard } from './login-card'

// Server component: reads the optional ?error= the auth callback sets on a
// failed code exchange, and hands a clean boolean to the interactive card.
export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  return <LoginCard hasError={Boolean(error)} />
}
