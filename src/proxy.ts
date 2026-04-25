import { NextRequest, NextResponse } from 'next/server'
import { applySecurityHeaders, getAllowedOrigins } from '@/lib/security/headers'
import { defaultLocale, isLocale, LOCALE_COOKIE, locales, type Locale } from '@/lib/i18n/config'

export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin')

  if (request.method === 'OPTIONS') {
    return handlePreflight(origin)
  }

  const response = NextResponse.next()

  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value
  if (!isLocale(cookieLocale)) {
    const detected = detectLocale(request.headers.get('accept-language'))
    response.cookies.set(LOCALE_COOKIE, detected, {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365
    })
  }

  return applySecurityHeaders(response, origin)
}

function detectLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale
  const preferred = acceptLanguage.split(',')[0]?.split('-')[0]?.toLowerCase()
  return preferred && (locales as readonly string[]).includes(preferred)
    ? (preferred as Locale)
    : defaultLocale
}

function handlePreflight(origin: string | null): NextResponse {
  const allowed = getAllowedOrigins()
  if (!origin || !allowed.includes(origin)) {
    return new NextResponse(null, { status: 403 })
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    }
  })
}

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)']
}
