'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Server,
  Terminal,
  MonitorSmartphone,
  Rocket,
  FlaskConical,
  Code2,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import type { DashboardStats } from '@/types/dashboard';

interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  tint: string;
}

function StatCard({ label, value, icon: Icon, tint }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={cn('mb-3 flex h-10 w-10 items-center justify-center rounded-xl', tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await apiFetch('/api/dashboard');
      if (!res.ok) throw new Error('Failed to load dashboard');
      return res.json();
    },
  });

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Dashboard</h1>

      {isLoading && <p className="text-slate-500">Loading dashboard...</p>}
      {isError && <p className="text-red-600">Failed to load dashboard.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard
              label="Total Servers"
              value={data.totalServers}
              icon={Server}
              tint="bg-indigo-100 text-indigo-600"
            />
            <StatCard
              label="Linux Servers"
              value={data.linuxServers}
              icon={Terminal}
              tint="bg-emerald-100 text-emerald-600"
            />
            <StatCard
              label="Windows Servers"
              value={data.windowsServers}
              icon={MonitorSmartphone}
              tint="bg-sky-100 text-sky-600"
            />
            <StatCard
              label="Production Servers"
              value={data.productionServers}
              icon={Rocket}
              tint="bg-purple-100 text-purple-600"
            />
            <StatCard
              label="UAT Servers"
              value={data.uatServers}
              icon={FlaskConical}
              tint="bg-amber-100 text-amber-600"
            />
            <StatCard
              label="Development Servers"
              value={data.developmentServers}
              icon={Code2}
              tint="bg-violet-100 text-violet-600"
            />
            <StatCard
              label="Total SSH Keys"
              value={data.totalKeys}
              icon={KeyRound}
              tint="bg-pink-100 text-pink-600"
            />
          </div>

          <section className="mt-8">
            <h2 className="mb-2 text-lg font-medium text-slate-900">Recent Activity</h2>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <ul className="divide-y divide-slate-100">
                {data.recentActivity.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between p-4 text-sm">
                    <span>
                      <span className="font-medium text-slate-900">
                        {entry.user?.email ?? 'Unknown'}
                      </span>{' '}
                      <span className="text-slate-500">— {entry.action}</span>
                    </span>
                    <span className="text-slate-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
