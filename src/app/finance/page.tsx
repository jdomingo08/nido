import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireFamily } from '@/domains/family/server/auth'
import { getFinanceData } from '@/domains/finance/data/queries'
import { buildPnlViewData } from '@/domains/finance/components/pnl-data'
import { PnlView } from '@/domains/finance/components/pnl-view'
import type { IncomeBucket } from '@/domains/finance/components/pnl-data'

// Finance · P&L statement (Phase 1: read-only statement + one-off toggles +
// drill-downs). Lives at /finance, not under /dashboard, because the
// dashboard's [day] dynamic segment would swallow the path.
export default async function FinancePage() {
  const { family } = await requireFamily()
  const t = await getTranslations('finance')

  const data = await getFinanceData(family.id)

  if (!data.hasTransactions) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Header title={t('title')} />
        <div className="rounded-2xl border border-black/10 bg-[--color-shell] p-6 text-sm">
          <p>{t('empty.body')}</p>
          <p className="mt-2 text-xs opacity-60">{t('empty.hint')}</p>
        </div>
      </main>
    )
  }

  const toBucket = (type: string): IncomeBucket => {
    const ty = type.toLowerCase()
    if (ty.includes('bonus')) return 'bonus'
    if (ty.includes('interest')) return 'interest'
    return 'other'
  }

  const view = buildPnlViewData(data.model, data.excludedOneOffIds, {
    paychecks: data.paychecks.map((p) => ({
      payDate: p.payDate,
      net: p.net,
      isBonus: p.bonus > 0,
      verified: p.source === 'stub'
    })),
    recurring: data.recurringIncome.map((r) => ({
      name: r.name,
      amount: r.amount,
      bucket: toBucket(r.type)
    })),
    oneOffIncome: data.oneOffIncome.map((o) => ({
      month: o.month,
      name: o.name,
      amount: o.amount,
      bucket: toBucket(o.type)
    }))
  })

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Header title={t('title')} />
      <PnlView data={view} />
    </main>
  )
}

function Header({ title }: { title: string }) {
  return (
    <header className="mb-6 flex items-baseline justify-between">
      <h1 className="text-2xl font-bold lowercase">{title}</h1>
      <Link href="/dashboard" className="text-sm underline decoration-dotted hover:opacity-70">
        ← dashboard
      </Link>
    </header>
  )
}
