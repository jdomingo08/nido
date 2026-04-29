'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type SessionMint = {
  client_secret: string
  expires_at: number
  model: string
  session_id: string | null
}

type Connection = {
  pc: RTCPeerConnection
  dc: RTCDataChannel
  micTrack: MediaStreamTrack
  audioEl: HTMLAudioElement
}

type Status = 'idle' | 'connecting' | 'live' | 'error'

const TOOLS_BASE = '/api/voice/tools'

// Floating mic. First click opens a Realtime session over WebRTC; second
// click tears everything down. While live, transcripts surface as a small
// caption pill above the button. Function calls round-trip through our
// /api/voice/tools/[tool] endpoint and back to OpenAI via the data channel.
export function VoiceButton() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [caption, setCaption] = useState<string>('')
  const connRef = useRef<Connection | null>(null)
  const captionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const teardown = useCallback(() => {
    const conn = connRef.current
    if (!conn) return
    try {
      conn.dc.close()
    } catch {
      /* noop */
    }
    try {
      conn.pc.close()
    } catch {
      /* noop */
    }
    try {
      conn.micTrack.stop()
    } catch {
      /* noop */
    }
    try {
      conn.audioEl.srcObject = null
      conn.audioEl.remove()
    } catch {
      /* noop */
    }
    connRef.current = null
  }, [])

  useEffect(() => {
    return () => teardown()
  }, [teardown])

  const showCaption = useCallback((text: string) => {
    setCaption(text)
    if (captionTimerRef.current) clearTimeout(captionTimerRef.current)
    captionTimerRef.current = setTimeout(() => setCaption(''), 4000)
  }, [])

  const handleEvent = useCallback(
    async (raw: string) => {
      let evt: { type?: string; [k: string]: unknown }
      try {
        evt = JSON.parse(raw)
      } catch {
        return
      }
      if (!evt.type) return
      const conn = connRef.current
      if (!conn) return

      switch (evt.type) {
        // The model finished a function-call. Forward args to our tools API,
        // then ship the result back as a `function_call_output` item, then
        // ask the model to resume with `response.create`.
        case 'response.function_call_arguments.done': {
          const name = String(evt.name ?? '')
          const callId = String(evt.call_id ?? '')
          const argsStr = String(evt.arguments ?? '{}')
          let parsedArgs: unknown
          try {
            parsedArgs = JSON.parse(argsStr)
          } catch {
            parsedArgs = {}
          }

          let output: string
          try {
            const res = await fetch(`${TOOLS_BASE}/${encodeURIComponent(name)}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(parsedArgs)
            })
            const json = await res.json()
            if (!res.ok) {
              output = JSON.stringify({ ok: false, error: json?.error ?? 'tool_failed' })
            } else {
              output = JSON.stringify({ ok: true, result: json })
            }
          } catch (e) {
            output = JSON.stringify({
              ok: false,
              error: e instanceof Error ? e.message : 'tool_fetch_failed'
            })
          }

          conn.dc.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output
              }
            })
          )
          conn.dc.send(JSON.stringify({ type: 'response.create' }))
          return
        }
        // User speech transcribed (a few names depending on SDK version).
        case 'conversation.item.input_audio_transcription.completed': {
          const text = String(
            (evt as { transcript?: string }).transcript ?? ''
          )
          if (text) showCaption(`you: ${text}`)
          return
        }
        // Assistant audio transcript ready (final).
        case 'response.audio_transcript.done':
        case 'response.output_audio_transcript.done': {
          const text = String(
            (evt as { transcript?: string }).transcript ?? ''
          )
          if (text) showCaption(text)
          return
        }
        // Surface real errors to the user.
        case 'error': {
          const message =
            (evt as { error?: { message?: string } }).error?.message ?? 'realtime_error'
          setError(message)
          setStatus('error')
          teardown()
          return
        }
      }
    },
    [showCaption, teardown]
  )

  const start = useCallback(async () => {
    setError(null)
    setStatus('connecting')
    try {
      // 1. Mint ephemeral session.
      const sessionRes = await fetch('/api/voice/session', { method: 'POST' })
      if (!sessionRes.ok) {
        const j = await sessionRes.json().catch(() => ({}))
        throw new Error(j?.error ?? `session_${sessionRes.status}`)
      }
      const session = (await sessionRes.json()) as SessionMint

      // 2. Get mic.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const micTrack = stream.getAudioTracks()[0]
      if (!micTrack) throw new Error('no_audio_track')

      // 3. Build the peer connection + remote audio sink.
      const pc = new RTCPeerConnection()
      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      audioEl.style.display = 'none'
      document.body.appendChild(audioEl)

      pc.ontrack = (e) => {
        const remote = e.streams[0]
        if (remote) audioEl.srcObject = remote
      }

      pc.addTrack(micTrack, stream)

      // 4. Data channel for events.
      const dc = pc.createDataChannel('oai-events')
      dc.onmessage = (e) => {
        if (typeof e.data === 'string') void handleEvent(e.data)
      }
      dc.onclose = () => {
        // If OpenAI closes the channel, surface as a soft end.
        if (connRef.current && connRef.current.dc === dc) {
          setStatus('idle')
          teardown()
        }
      }

      // 5. SDP exchange.
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.client_secret}`,
            'Content-Type': 'application/sdp'
          },
          body: offer.sdp ?? ''
        }
      )
      if (!sdpRes.ok) {
        const text = await sdpRes.text().catch(() => '')
        throw new Error(`sdp_${sdpRes.status}:${text.slice(0, 200)}`)
      }
      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      connRef.current = { pc, dc, micTrack, audioEl }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setStatus('live')
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (connRef.current?.pc === pc) {
            setStatus('idle')
            teardown()
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'voice_failed')
      setStatus('error')
      teardown()
    }
  }, [handleEvent, teardown])

  const stop = useCallback(() => {
    teardown()
    setStatus('idle')
    setCaption('')
  }, [teardown])

  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col items-end gap-2">
      {caption && (
        <div className="pointer-events-auto max-w-[340px] rounded-xl border-2 border-[#16121A] bg-[#FBF5E8] px-3 py-2 text-[12px] leading-snug shadow-[2px_2px_0_#16121A]">
          {caption}
        </div>
      )}
      {error && status === 'error' && (
        <div className="pointer-events-auto max-w-[340px] rounded-xl border-2 border-[#FF3D7F] bg-[#FFB4A5]/40 px-3 py-2 text-[11px] leading-snug">
          voice error · {error}
        </div>
      )}
      <button
        type="button"
        onClick={status === 'live' || status === 'connecting' ? stop : start}
        disabled={status === 'connecting'}
        className={`pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#16121A] shadow-[3px_3px_0_#16121A] transition active:translate-y-px ${
          status === 'live'
            ? 'bg-[#FF3D7F] text-[#FBF5E8]'
            : status === 'connecting'
              ? 'bg-[#F4D22B] text-[#16121A]'
              : 'bg-[#FBF5E8] text-[#16121A]'
        }`}
        aria-label={status === 'live' ? 'stop voice' : 'start voice'}
        title={
          status === 'live'
            ? 'stop voice'
            : status === 'connecting'
              ? 'connecting…'
              : 'ask nido (read-only)'
        }
      >
        {status === 'connecting' ? <Spinner /> : status === 'live' ? <StopIcon /> : <MicIcon />}
      </button>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0014 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function Spinner() {
  return (
    <span className="relative flex h-5 w-5">
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-[#16121A]/30 border-t-[#16121A]" />
    </span>
  )
}
