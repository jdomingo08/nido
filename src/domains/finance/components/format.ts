// Formatting rules from VIEWS.md — get these right, they're everywhere:
// · currency uses a Unicode minus (−, U+2212) for negatives, not a hyphen
// · money0 (no decimals) in KPIs/tables; money (2dp) in drill-downs
// · zero cells render as '·', not $0
// · partial months get an asterisk in column headers

const MINUS = '−'

export function money(v: number | null | undefined, dec = 2): string {
  const n = v == null || Number.isNaN(v) ? 0 : v
  return (
    (n < 0 ? MINUS : '') +
    '$' +
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  )
}

export function money0(v: number | null | undefined): string {
  return money(v, 0)
}

export function signedMoney0(v: number): string {
  return (
    (v >= 0 ? '+' : MINUS) + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })
  )
}

export function pct(r: number, dec = 1): string {
  return (r * 100).toFixed(dec) + '%'
}

const MONTHS_SHORT: Record<string, Record<string, string>> = {
  en: {
    '01': 'Jan',
    '02': 'Feb',
    '03': 'Mar',
    '04': 'Apr',
    '05': 'May',
    '06': 'Jun',
    '07': 'Jul',
    '08': 'Aug',
    '09': 'Sep',
    '10': 'Oct',
    '11': 'Nov',
    '12': 'Dec'
  },
  es: {
    '01': 'ene',
    '02': 'feb',
    '03': 'mar',
    '04': 'abr',
    '05': 'may',
    '06': 'jun',
    '07': 'jul',
    '08': 'ago',
    '09': 'sep',
    '10': 'oct',
    '11': 'nov',
    '12': 'dic'
  }
}

export function monthShort(month: string, locale = 'en'): string {
  return MONTHS_SHORT[locale]?.[month.slice(5, 7)] ?? month
}

export function monthLong(month: string, locale = 'en'): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, 1))
  )
}
