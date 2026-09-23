'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-6 py-2 text-sm text-slate-500">
      <Link href="/dashboard" className="hover:underline">
        Home
      </Link>
      {segments.map((segment, index) => {
        const href = `/${segments.slice(0, index + 1).join('/')}`;
        const label = decodeURIComponent(segment).replace(/-/g, ' ');
        return (
          <span key={href}>
            {' / '}
            <Link href={href} className="capitalize hover:underline">
              {label}
            </Link>
          </span>
        );
      })}
    </div>
  );
}
