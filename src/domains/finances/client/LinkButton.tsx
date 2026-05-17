'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink, type PlaidLinkOnSuccess } from 'react-plaid-link'
import type { PlaidAccountType } from '../shared/types'

interface LinkButtonProps {
  entityId: string
  onConnected?: (accountCount: number) => void
  label?: string
}

interface LinkTokenResponse {
  success: boolean
  data?: { link_token: string; expiration: string }
  error?: string
}

interface ExchangeResponse {
  success: boolean
  data?: { item_id: string; account_count: number }
  error?: string
}

const PLAID_ACCOUNT_TYPES: readonly PlaidAccountType[] = [
  'depository',
  'credit',
  'loan',
  'investment',
  'other'
]

function coerceAccountType(t: string | null | undefined): PlaidAccountType {
  return PLAID_ACCOUNT_TYPES.includes(t as PlaidAccountType) ? (t as PlaidAccountType) : 'other'
}

export function LinkButton({
  entityId,
  onConnected,
  label = 'Connect a bank or card'
}: LinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch a link_token on demand so it doesn't expire while sitting idle.
  const requestToken = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/finances/link', { method: 'POST' })
      const json = (await res.json()) as LinkTokenResponse
      if (!json.success || !json.data) throw new Error(json.error ?? 'Failed to start Plaid')
      setLinkToken(json.data.link_token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start Plaid')
      setBusy(false)
    }
  }, [])

  const onSuccess: PlaidLinkOnSuccess = useCallback(
    async (public_token, metadata) => {
      try {
        const res = await fetch('/api/finances/exchange', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            public_token,
            entity_id: entityId,
            institution: {
              id: metadata.institution?.institution_id ?? '',
              name: metadata.institution?.name ?? 'Unknown'
            },
            accounts: metadata.accounts.map((a) => ({
              id: a.id,
              name: a.name,
              mask: a.mask ?? null,
              type: coerceAccountType(a.type),
              subtype: a.subtype ?? null
            }))
          })
        })
        const json = (await res.json()) as ExchangeResponse
        if (!json.success || !json.data) throw new Error(json.error ?? 'Exchange failed')
        onConnected?.(json.data.account_count)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save connection')
      } finally {
        setBusy(false)
        setLinkToken(null)
      }
    },
    [entityId, onConnected]
  )

  const { open, ready } = usePlaidLink({
    token: linkToken ?? '',
    onSuccess,
    onExit: () => {
      setBusy(false)
      setLinkToken(null)
    }
  })

  useEffect(() => {
    if (linkToken && ready) open()
  }, [linkToken, ready, open])

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={requestToken}
        disabled={busy}
        className="rounded-lg border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-1.5 text-xs font-bold tracking-widest uppercase hover:bg-[#16121A] hover:text-[#FBF5E8] disabled:opacity-60"
      >
        {busy ? 'opening plaid…' : label}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
