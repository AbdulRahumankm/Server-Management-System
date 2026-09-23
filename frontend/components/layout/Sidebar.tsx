'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/servers', label: 'Servers' },
  { href: '/keys', label: 'SSH Keys' },
  { href: '/inventory', label: 'Dynamic Inventory' },
  { href: '/users', label: 'Users', permission: 'user:manage' },
  { href: '/roles', label: 'Roles', permission: 'role:manage' },
  { href: '/audit-logs', label: 'Audit Logs', permission: 'audit:view' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: currentUser } = useCurrentUser();
  const permissions = currentUser?.permissions ?? [];

  const items = NAV_ITEMS.filter((item) => !item.permission || permissions.includes(item.permission));

  return (
    <nav className="hidden w-56 flex-shrink-0 border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:block">
      <div className="mb-6 px-3 text-lg font-semibold text-slate-900 dark:text-slate-50">
        Server Inventory
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm',
                  active
                    ? 'bg-slate-100 font-medium text-amber-600 dark:bg-slate-800 dark:text-amber-400'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
