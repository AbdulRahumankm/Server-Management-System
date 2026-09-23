'use client';

import { useQuery } from '@tanstack/react-query';
import { Database, Rows3, Users, type LucideIcon } from 'lucide-react';
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard
            label="Inventory Tables"
            value={data.totalEntities}
            icon={Database}
            tint="bg-indigo-100 text-indigo-600"
          />
          <StatCard
            label="Total Records"
            value={data.totalRecords}
            icon={Rows3}
            tint="bg-emerald-100 text-emerald-600"
          />
          <StatCard
            label="Total Users"
            value={data.totalUsers}
            icon={Users}
            tint="bg-purple-100 text-purple-600"
          />
        </div>
      )}
    </main>
  );
}
