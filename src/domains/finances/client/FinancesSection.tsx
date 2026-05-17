'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LinkButton } from './LinkButton'
import type { EntityWithConnections } from '../server/list-connections'

interface FinancesSectionProps {
  data: EntityWithConnections[]
}

export function FinancesSection({ data }: FinancesSectionProps) {
  const t = useTranslations('finances')
  const router = useRouter()

  return (
    <section className="rounded-2xl border-2 border-[#16121A] bg-[#FBF5E8] p-5">
      <header className="mb-4">
        <h2 className="text-lg font-bold tracking-tight">{t('title')}</h2>
        <p className="mt-1 text-sm opacity-75">{t('description')}</p>
      </header>

      {data.length === 0 && <p className="text-sm opacity-75">{t('noEntities')}</p>}

      <div className="flex flex-col gap-4">
        {data.map(({ entity, items }) => (
          <article key={entity.id} className="rounded-xl border border-[#16121A]/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">{entity.name}</h3>
              <span className="font-mono text-[10px] tracking-widest uppercase opacity-60">
                {entity.kind}
              </span>
            </div>

            {items.length === 0 ? (
              <p className="mb-3 text-sm opacity-70">{t('noConnections')}</p>
            ) : (
              <ul className="mb-3 space-y-2 text-sm">
                {items.map((item) => (
                  <li key={item.id}>
                    <div className="font-medium">{item.institution_name}</div>
                    <ul className="ml-4 opacity-75">
                      {item.accounts.map((a) => (
                        <li key={a.id}>
                          {a.name}
                          {a.mask ? ` ••${a.mask}` : ''}{' '}
                          <span className="text-xs">({a.type})</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            <LinkButton
              entityId={entity.id}
              onConnected={() => router.refresh()}
              label={items.length === 0 ? t('connectFirst') : t('connectAnother')}
            />
          </article>
        ))}
      </div>
    </section>
  )
}
