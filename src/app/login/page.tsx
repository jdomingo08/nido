'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Mode = 'magic_link' | 'password'

export default function LoginPage() {
  const t = useTranslations('common')
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('magic_link')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` }
    })
    setLoading(false)
    if (error) setError(error.message)
    else setMagicLinkSent(true)
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    router.replace('/')
    router.refresh()
  }

  if (magicLinkSent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F5ECDC] p-6">
        <div className="w-full max-w-md rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-8 shadow-[4px_4px_0_#16121A]">
          <p className="font-mono text-xs tracking-widest uppercase opacity-60">check your inbox</p>
          <h1 className="mt-2 font-[family-name:var(--font-archivo-black)] text-3xl tracking-tight">
            we just sent you a link.
          </h1>
          <p className="mt-3 text-sm opacity-80">
            open the email at <b>{email}</b> and tap the button. you&apos;ll come right back here.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5ECDC] p-6">
      <div className="w-full max-w-md rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-8 shadow-[4px_4px_0_#16121A]">
        <p className="font-mono text-xs tracking-widest uppercase opacity-60">{t('appName')}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{t('tagline')}</h1>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={() => setMode('magic_link')}
            className={`flex-1 rounded-lg border-2 border-[#16121A] px-3 py-2 text-sm font-bold transition ${
              mode === 'magic_link'
                ? 'bg-[#FF3D7F] text-[#FBF5E8] shadow-[2px_2px_0_#16121A]'
                : 'bg-transparent'
            }`}
          >
            magic link
          </button>
          <button
            type="button"
            onClick={() => setMode('password')}
            className={`flex-1 rounded-lg border-2 border-[#16121A] px-3 py-2 text-sm font-bold transition ${
              mode === 'password'
                ? 'bg-[#FF3D7F] text-[#FBF5E8] shadow-[2px_2px_0_#16121A]'
                : 'bg-transparent'
            }`}
          >
            password
          </button>
        </div>

        <form
          onSubmit={mode === 'magic_link' ? handleMagicLink : handlePassword}
          className="mt-6 flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1">
            <span className="font-mono text-xs tracking-widest uppercase opacity-60">email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-base focus:ring-2 focus:ring-[#FF3D7F] focus:outline-none"
              placeholder="you@email.com"
            />
          </label>

          {mode === 'password' && (
            <label className="flex flex-col gap-1">
              <span className="font-mono text-xs tracking-widest uppercase opacity-60">
                password
              </span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-base focus:ring-2 focus:ring-[#FF3D7F] focus:outline-none"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-lg border-2 border-[#16121A] bg-[#16121A] px-4 py-3 font-bold tracking-tight text-[#FBF5E8] shadow-[3px_3px_0_#FF3D7F] transition disabled:opacity-60"
          >
            {loading ? t('loading') : mode === 'magic_link' ? 'send link' : 'sign in'}
          </button>

          {error && (
            <p className="rounded-md border border-[#FF3D7F] bg-[#FFB4A5]/40 p-2 text-sm text-[#16121A]">
              {error}
            </p>
          )}
        </form>
      </div>
    </main>
  )
}
