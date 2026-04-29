'use client'

import dynamic from 'next/dynamic'

// Client-only mount for the voice button. We can't pass `ssr: false` to
// `next/dynamic` from a Server Component (Next 13+ App Router restriction),
// so we wrap the dynamic import in a thin client boundary.
const VoiceButton = dynamic(() => import('./voice-button').then((m) => m.VoiceButton), {
  ssr: false
})

export function VoiceButtonMount() {
  return <VoiceButton />
}
