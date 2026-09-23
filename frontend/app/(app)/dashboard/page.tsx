'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiClient';
import type { DashboardStats } from '@/types/dashboard';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{value}</p>
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
      <h1 className="mb-6 text-2xl font-semibold text-slate-900 dark:text-slate-50">Dashboard</h1>

      {isLoading && <p className="text-slate-500 dark:text-slate-400">Loading dashboard...</p>}
      {isError && <p className="text-red-600 dark:text-red-400">Failed to load dashboard.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Total Servers" value={data.totalServers} />
            <StatCard label="Linux Servers" value={data.linuxServers} />
            <StatCard label="Windows Servers" value={data.windowsServers} />
            <StatCard label="Production Servers" value={data.productionServers} />
            <StatCard label="UAT Servers" value={data.uatServers} />
            <StatCard label="Development Servers" value={data.developmentServers} />
            <StatCard label="Total SSH Keys" value={data.totalKeys} />
          </div>

          <section className="mt-8">
            <h2 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-50">
              Recent Activity
            </h2>
            <ul className="flex flex-col gap-2">
              {data.recentActivity.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-md border border-slate-100 p-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300"
                >
                  <span className="font-medium text-slate-900 dark:text-slate-50">
                    {entry.user?.email ?? 'Unknown'}
                  </span>{' '}
                  — {entry.action}{' '}
                  <span className="text-slate-400 dark:text-slate-500">
                    ({new Date(entry.createdAt).toLocaleString()})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
