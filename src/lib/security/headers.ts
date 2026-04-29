import { NextResponse } from 'next/server'

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co https://api.openai.com https://api.openweathermap.org",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

export function getAllowedOrigins(): string[] {
  return [process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000'].filter(
    (origin): origin is string => Boolean(origin)
  )
}

export function applySecurityHeaders(response: NextResponse, origin: string | null): NextResponse {
  const headers = response.headers

  headers.set('Content-Security-Policy', CSP_DIRECTIVES)
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set(
    'Permissions-Policy',
    // microphone=(self) is required by the voice agent (Realtime over WebRTC).
    // camera stays denied — we don't use it.
    'camera=(), microphone=(self), geolocation=(self), interest-cohort=()'
  )

  const allowed = getAllowedOrigins()
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }

  return response
}
