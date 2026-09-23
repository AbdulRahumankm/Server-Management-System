'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Database,
  Users,
  Shield,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/inventory', label: 'Dynamic Inventory', icon: Database },
  { href: '/users', label: 'Users', icon: Users, permission: 'user:manage' },
  { href: '/roles', label: 'Roles', icon: Shield, permission: 'role:manage' },
  { href: '/audit-logs', label: 'Audit Logs', icon: ScrollText, permission: 'audit:view' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: currentUser } = useCurrentUser();
  const permissions = currentUser?.permissions ?? [];

  const items = NAV_ITEMS.filter((item) => !item.permission || permissions.includes(item.permission));

  return (
    <nav className="hidden w-64 flex-shrink-0 border-r border-slate-200 bg-white p-4 sm:block">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 text-sm font-bold text-white">
          S
        </div>
        <span className="text-base font-semibold text-slate-900">Server Inventory</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-gradient-to-r from-indigo-50 to-purple-50 font-medium text-indigo-700'
                    : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                <Icon className={cn('h-4 w-4', active ? 'text-indigo-600' : 'text-slate-400')} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
