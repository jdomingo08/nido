'use client'

// P&L statement (VIEWS.md §3): months as columns, income section, expense
// sections grouped by segment with subtotals, grand total, net row, memo,
// one-off toggles and cell drill-downs. Toggling a one-off persists to
// finance_settings and recomputes the whole dashboard server-side so every
// view stays consistent.

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CAT_COLORS, SEG_COLORS, type CategoryKey } from '@/domains/finance/engine'
import { setExcludedOneOffs } from '@/domains/finance/data/actions'
import { money, money0, monthLong, monthShort, pct, signedMoney0 } from './format'
import type { IncomeBucket, PnlViewData } from './pnl-data'

type Drill =
  | { kind: 'cat'; key: CategoryKey; month: string }
  | { kind: 'month'; month: string }
  | { kind: 'inc'; bucket: IncomeBucket; month: string }

const INCOME_COLORS: Record<IncomeBucket, string> = {
  salary: '#1F6F54',
  bonus: '#2E8B8B',
  other: '#7A8450',
  interest: '#6A4C93'
}

export function PnlView({ data }: { data: PnlViewData }) {
  const t = useTranslations('finance')
  const locale = useLocale()
  const [drill, setDrill] = useState<Drill | null>(null)
  const [isPending, startTransition] = useTransition()

  const excluded = new Set(data.excludedIds)

  function persistExcluded(ids: Set<string>) {
    startTransition(async () => {
      await setExcludedOneOffs([...ids])
    })
  }

  function toggleOneOff(id: string) {
    const next = new Set(excluded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    persistExcluded(next)
  }

  const mShort = (m: string) => monthShort(m, locale) + (m === data.partialMonth ? '*' : '')

  const num = 'text-right tabular-nums whitespace-nowrap'
  const cell = `${num} px-2 py-1.5`
  const zero = <span className="text-ink/30">·</span>

  return (
    <div className="flex flex-col gap-6">
      {drill && <DrillPanel data={data} drill={drill} onDrill={setDrill} locale={locale} />}

      {data.oneOffs.length > 0 && (
        <section className="rounded-2xl border border-black/10 bg-[--color-shell] p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-wide uppercase opacity-70">
              {t('pnl.oneOffTitle')}
            </h2>
            <div className="flex gap-2 text-xs">
              <button
                className="rounded-full border border-black/15 px-3 py-1 hover:bg-black/5"
                disabled={isPending}
                onClick={() => persistExcluded(new Set())}
              >
                {t('pnl.includeAll')}
              </button>
              <button
                className="rounded-full border border-black/15 px-3 py-1 hover:bg-black/5"
                disabled={isPending}
                onClick={() => persistExcluded(new Set(data.oneOffs.map((o) => o.id)))}
              >
                {t('pnl.excludeAll')}
              </button>
            </div>
          </div>
          <p className="mb-3 rounded-lg bg-black/5 px-3 py-2 text-xs">
            {data.excludedCount > 0
              ? t('pnl.excludedBanner', {
                  count: data.excludedCount,
                  total: money(data.excludedTotal)
                })
              : t('pnl.includedBanner')}
          </p>
          <ul className="flex flex-col divide-y divide-black/5">
            {data.oneOffs.map((o) => {
              const off = excluded.has(o.id)
              return (
                <li
                  key={o.id}
                  className={`flex items-center gap-3 py-2 ${off ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={!off}
                    disabled={isPending}
                    onChange={() => toggleOneOff(o.id)}
                    aria-label={o.merchant}
                  />
                  <span className="w-16 shrink-0 text-xs tabular-nums opacity-70">
                    {monthShort(o.month, locale)} {o.date.slice(8, 10)}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <Dot color={CAT_COLORS[o.category]} />
                    <span className="truncate">{o.merchant}</span>
                    {o.linkedCount > 0 && (
                      <span className="hidden text-xs opacity-60 sm:inline">
                        {t('pnl.linkedCredits', { total: money(o.linkedTotal), net: money(o.net) })}
                      </span>
                    )}
                  </span>
                  <span className={`${num} text-sm`}>{money(o.net)}</span>
                  <span
                    className={`w-20 shrink-0 text-right text-[10px] font-semibold uppercase ${off ? 'text-red-700' : 'text-emerald-800'}`}
                  >
                    {off ? t('pnl.excluded') : t('pnl.included')}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-black/10 bg-[--color-shell] p-4 sm:p-5">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase opacity-70">
            {t('pnl.title')}
          </h2>
          {data.partialMonth && <span className="text-xs opacity-60">{t('pnl.partialNote')}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-black/20 text-xs tracking-wide uppercase opacity-70">
                <th className="px-2 py-2 text-left">{t('pnl.category')}</th>
                {data.months.map((m) => (
                  <th key={m} className={cell}>
                    {mShort(m)}
                  </th>
                ))}
                <th className={`${cell} font-bold`}>{t('pnl.ytd')}</th>
                <th className={cell}>{t('pnl.avgMonth')}</th>
                <th className={cell}>%</th>
              </tr>
            </thead>
            <tbody>
              {data.hasIncome && (
                <>
                  <SectionHead
                    label={t('pnl.income')}
                    color="#1F6F54"
                    span={data.months.length + 4}
                  />
                  {data.incomeRows.map((r) => (
                    <tr key={r.bucket} className="border-b border-black/5">
                      <td className="px-2 py-1.5">
                        <Dot color={INCOME_COLORS[r.bucket]} /> {t(`pnl.${r.bucket}`)}
                      </td>
                      {data.months.map((m) => {
                        const v = r.byMonth[m]
                        return (
                          <td key={m} className={cell}>
                            {v ? (
                              <CellButton
                                onClick={() =>
                                  setDrill({ kind: 'inc', bucket: r.bucket, month: m })
                                }
                              >
                                {money0(v)}
                              </CellButton>
                            ) : (
                              zero
                            )}
                          </td>
                        )
                      })}
                      <td className={`${cell} font-semibold`}>{money0(r.total)}</td>
                      <td className={`${cell} opacity-60`}>{money0(r.avg)}</td>
                      <td className={`${cell} opacity-60`}>—</td>
                    </tr>
                  ))}
                  <tr className="border-b border-black/15 bg-black/5 font-semibold">
                    <td className="px-2 py-1.5">{t('pnl.totalIncome')}</td>
                    {data.months.map((m) => (
                      <td key={m} className={cell}>
                        {data.incomeTotalByMonth[m] != null
                          ? money0(data.incomeTotalByMonth[m])
                          : zero}
                      </td>
                    ))}
                    <td className={`${cell} font-bold`}>{money0(data.incomeTotal)}</td>
                    <td className={cell}>{money0(data.incomeAvg)}</td>
                    <td className={cell}>—</td>
                  </tr>
                </>
              )}

              {data.segments.map((seg) => (
                <SegmentRows
                  key={seg.segment}
                  seg={seg}
                  months={data.months}
                  cell={cell}
                  zero={zero}
                  onDrill={setDrill}
                />
              ))}

              <tr className="border-y-2 border-black/30 bg-black/5 font-bold">
                <td className="px-2 py-2">{t('pnl.totalNetSpend')}</td>
                {data.months.map((m) => (
                  <td key={m} className={cell}>
                    <CellButton onClick={() => setDrill({ kind: 'month', month: m })}>
                      {money0(data.monthTotals[m] ?? 0)}
                    </CellButton>
                  </td>
                ))}
                <td className={cell}>{money0(data.totalSpend)}</td>
                <td className={cell}>{money0(data.avgMonthly)}</td>
                <td className={cell}>100%</td>
              </tr>

              {data.hasIncome && (
                <tr className="font-bold">
                  <td className="px-2 py-2">{t('pnl.net')}</td>
                  {data.months.map((m) => {
                    const v = data.netByMonth[m]
                    return (
                      <td
                        key={m}
                        className={`${cell} ${v == null ? '' : v >= 0 ? 'text-emerald-800' : 'text-red-700'}`}
                      >
                        {v == null ? zero : signedMoney0(v)}
                      </td>
                    )
                  })}
                  <td
                    className={`${cell} ${data.netTotal >= 0 ? 'text-emerald-800' : 'text-red-700'}`}
                  >
                    {signedMoney0(data.netTotal)}
                  </td>
                  <td className={cell}>—</td>
                  <td className={cell}>{pct(data.savingsRate, 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-[--color-shell] p-4 text-sm sm:p-5">
        <h3 className="mb-2 text-xs font-semibold tracking-wide uppercase opacity-70">
          {t('pnl.memoTitle')}
        </h3>
        <div className="flex justify-between border-b border-black/5 py-1">
          <span>{t('pnl.memoPayments')}</span>
          <span className="tabular-nums">{money(Math.abs(data.memoPayments))}</span>
        </div>
        <div className="flex justify-between py-1">
          <span>{t('pnl.memoCredits')}</span>
          <span className="tabular-nums">{money(Math.abs(data.memoCredits))}</span>
        </div>
        <p className="mt-2 text-xs opacity-60">{t('pnl.memoNote')}</p>
      </section>
    </div>
  )
}

function SegmentRows({
  seg,
  months,
  cell,
  zero,
  onDrill
}: {
  seg: PnlViewData['segments'][number]
  months: string[]
  cell: string
  zero: React.ReactNode
  onDrill: (d: Drill) => void
}) {
  const t = useTranslations('finance')
  return (
    <>
      <SectionHead
        label={t(`segments.${seg.segment}`)}
        color={SEG_COLORS[seg.segment]}
        span={months.length + 4}
      />
      {seg.rows.map((r) => (
        <tr key={r.key} className="border-b border-black/5">
          <td className="px-2 py-1.5">
            <Dot color={CAT_COLORS[r.key]} /> {t(`categories.${r.key}`)}
            {r.fixed && <Badge>{t('pnl.fixed')}</Badge>}
          </td>
          {months.map((m) => {
            const v = r.byMonth[m] ?? 0
            return (
              <td key={m} className={cell}>
                {v ? (
                  <CellButton onClick={() => onDrill({ kind: 'cat', key: r.key, month: m })}>
                    {money0(v)}
                  </CellButton>
                ) : (
                  zero
                )}
              </td>
            )
          })}
          <td className={`${cell} font-semibold`}>{money0(r.total)}</td>
          <td className={`${cell} opacity-60`}>{money0(r.avg)}</td>
          <td className={`${cell} opacity-60`}>{pct(r.pctOfSpend, 0)}</td>
        </tr>
      ))}
      <tr className="border-b border-black/15 bg-black/5 font-semibold">
        <td className="px-2 py-1.5">
          {t('pnl.subtotal', { segment: t(`segments.${seg.segment}`) })}
        </td>
        {months.map((m) => {
          const v = seg.subtotalByMonth[m] ?? 0
          return (
            <td key={m} className={cell}>
              {v ? money0(v) : zero}
            </td>
          )
        })}
        <td className={`${cell} font-bold`}>{money0(seg.subtotal)}</td>
        <td className={cell}>{money0(seg.avg)}</td>
        <td className={cell}>{pct(seg.pctOfSpend, 0)}</td>
      </tr>
    </>
  )
}

function DrillPanel({
  data,
  drill,
  onDrill,
  locale
}: {
  data: PnlViewData
  drill: Drill
  onDrill: (d: Drill | null) => void
  locale: string
}) {
  const t = useTranslations('finance')

  let title: React.ReactNode = null
  let rows: { date: string; label: React.ReactNode; amount: number; onClick?: () => void }[] = []

  if (drill.kind === 'cat') {
    const list = data.drillTxns
      .filter((x) => x.category === drill.key && x.month === drill.month)
      .sort((a, b) => b.amount - a.amount)
    title = (
      <>
        <Dot color={CAT_COLORS[drill.key]} /> {t(`categories.${drill.key}`)} ·{' '}
        {monthLong(drill.month, locale)}
      </>
    )
    rows = list.map((x) => ({
      date: x.date,
      label: (
        <>
          {x.merchant}
          {x.isFixed && <Badge>{t('pnl.fixed')}</Badge>}
          {x.type === 'Refund' && x.description && (
            <span className="opacity-60"> · {x.description}</span>
          )}
        </>
      ),
      amount: x.amount
    }))
  } else if (drill.kind === 'month') {
    title = <>{monthLong(drill.month, locale)}</>
    const byCat = new Map<CategoryKey, number>()
    for (const x of data.drillTxns) {
      if (x.month !== drill.month) continue
      byCat.set(x.category, (byCat.get(x.category) ?? 0) + x.amount)
    }
    rows = [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, amount]) => ({
        date: '',
        label: (
          <>
            <Dot color={CAT_COLORS[key]} /> {t(`categories.${key}`)}
          </>
        ),
        amount,
        onClick: () => onDrill({ kind: 'cat', key, month: drill.month })
      }))
  } else {
    title = (
      <>
        {t(`pnl.${drill.bucket}`)} · {monthLong(drill.month, locale)}
      </>
    )
    if (drill.bucket === 'salary') {
      rows = data.paychecks
        .filter((p) => !p.isBonus && p.payDate.slice(0, 7) === drill.month)
        .sort((a, b) => a.payDate.localeCompare(b.payDate))
        .map((p) => ({
          date: p.payDate,
          label: (
            <>
              {t('pnl.paycheckNet')}
              {p.verified && <Badge>{t('pnl.verified')}</Badge>}
            </>
          ),
          amount: p.net
        }))
    } else {
      if (data.fixedMonths.includes(drill.month)) {
        rows = data.recurring
          .filter((r) => r.bucket === drill.bucket)
          .map((r) => ({ date: `${drill.month}-01`, label: r.name, amount: r.amount }))
      }
      rows = rows.concat(
        data.oneOffIncome
          .filter((o) => o.month === drill.month && o.bucket === drill.bucket)
          .map((o) => ({
            date: `${o.month}-01`,
            label: (
              <>
                {o.name} <Badge>{t('pnl.oneOff')}</Badge>
              </>
            ),
            amount: o.amount
          }))
      )
    }
  }

  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <section className="rounded-2xl border-2 border-black/20 bg-[--color-chalk] p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button
          className="rounded-full border border-black/15 px-3 py-1 text-xs hover:bg-black/5"
          onClick={() => onDrill(null)}
        >
          {t('pnl.close')}
        </button>
      </div>
      <div className="flex justify-between border-b border-black/15 py-1.5 text-sm font-semibold">
        <span>{t('pnl.drillTotal', { count: rows.length })}</span>
        <span className="tabular-nums">{money(total)}</span>
      </div>
      <ul className="max-h-80 overflow-y-auto text-sm">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-black/5 py-1.5">
            <span className="w-24 shrink-0 text-xs tabular-nums opacity-60">{r.date}</span>
            <span className="min-w-0 flex-1 truncate">
              {r.onClick ? (
                <button
                  className="underline decoration-dotted hover:opacity-70"
                  onClick={r.onClick}
                >
                  {r.label}
                </button>
              ) : (
                r.label
              )}
            </span>
            <span className="tabular-nums">{money(r.amount)}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-xs opacity-60">{t('pnl.drillEmpty')}</li>}
      </ul>
    </section>
  )
}

function SectionHead({ label, color, span }: { label: string; color: string; span: number }) {
  return (
    <tr className="border-b border-black/10">
      <td
        colSpan={span}
        className="px-2 pt-4 pb-1 text-xs font-bold tracking-wider uppercase"
        style={{ color }}
      >
        {label}
      </td>
    </tr>
  )
}

function CellButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className="cursor-pointer rounded px-0.5 underline decoration-black/20 decoration-dotted underline-offset-2 hover:bg-black/5"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 rounded-full border border-black/15 px-1.5 py-0.5 align-middle text-[10px] tracking-wide uppercase opacity-70">
      {children}
    </span>
  )
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
      style={{ background: color }}
    />
  )
}
