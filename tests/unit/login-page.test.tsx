import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import messages from '../../messages/en.json'
import { LoginCard } from '@/app/login/login-card'

const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null })

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { signInWithOAuth }
  })
}))

function renderCard(props: { hasError?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoginCard {...props} />
    </NextIntlClientProvider>
  )
}

describe('LoginCard (Google sign-in)', () => {
  beforeEach(() => {
    signInWithOAuth.mockClear()
  })

  it('renders a single Continue with Google button', () => {
    renderCard()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
    // Google-only: no email/password fields remain.
    expect(screen.queryByPlaceholderText(/email/i)).not.toBeInTheDocument()
  })

  it('calls signInWithOAuth with provider google and the callback redirect on click', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(signInWithOAuth).toHaveBeenCalledTimes(1)
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'http://localhost:3000/auth/callback' }
    })
  })

  it('shows an error banner when hasError is set (callback bounce)', () => {
    renderCard({ hasError: true })
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't sign you in/i)
  })

  it('shows no error banner by default', () => {
    renderCard()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
