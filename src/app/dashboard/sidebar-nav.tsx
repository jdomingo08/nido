'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type NavItem = {
  href: string | null // null = disabled / coming-soon
  label: string
  icon: 'week' | 'balance' | 'agents' | 'settings'
  comingSoon?: boolean
}

const ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'the week', icon: 'week' },
  { href: null, label: 'balance', icon: 'balance', comingSoon: true },
  { href: null, label: 'agents', icon: 'agents', comingSoon: true },
  { href: '/settings', label: 'settings', icon: 'settings' }
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-1 px-3">
      {ITEMS.map((item) => {
        const active =
          item.href === '/dashboard'
            ? pathname === '/dashboard' || pathname.startsWith('/dashboard/')
            : item.href === pathname
        return <NavRow key={item.label} item={item} active={active} />
      })}
    </nav>
  )
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const baseClass =
    'flex items-center gap-3 rounded-lg px-3 py-2 font-bold tracking-tight transition'
  const activeClass = 'bg-[#FF3D7F] text-[#FBF5E8] shadow-[2px_2px_0_#FBF5E8]/15'
  const inactiveClass = 'text-[#FBF5E8] hover:bg-[#FBF5E8]/10'
  const disabledClass = 'cursor-not-allowed text-[#FBF5E8]/30'

  if (item.href === null) {
    return (
      <span className={`${baseClass} ${disabledClass}`} title="coming soon">
        <NavIcon name={item.icon} />
        <span>{item.label}</span>
        <span className="ml-auto font-mono text-[8px] tracking-widest uppercase opacity-60">
          soon
        </span>
      </span>
    )
  }

  return (
    <Link href={item.href} className={`${baseClass} ${active ? activeClass : inactiveClass}`}>
      <NavIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  )
}

function NavIcon({ name }: { name: NavItem['icon'] }) {
  switch (name) {
    case 'week':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 5h4v14H5zM15 5h4v14h-4z" fill="currentColor" />
        </svg>
      )
    case 'balance':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 18h6m0 0V8m0 10h6M14 8L20 14M10 8L4 14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'agents':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 7v5l3 2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'settings':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}
