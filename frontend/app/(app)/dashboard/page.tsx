'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiClient';
import type { DashboardStats } from '@/types/dashboard';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
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
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>

      {isLoading && <p>Loading dashboard...</p>}
      {isError && <p className="text-red-600">Failed to load dashboard.</p>}

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
            <h2 className="mb-2 text-lg font-medium">Recent Activity</h2>
            <ul className="flex flex-col gap-2">
              {data.recentActivity.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 p-2 text-sm">
                  <span className="font-medium">{entry.user?.email ?? 'Unknown'}</span> — {entry.action}{' '}
                  <span className="text-slate-400">
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
