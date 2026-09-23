'use client';

import { useQuery } from '@tanstack/react-query';
import { Shield } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';
import type { AppRole } from '@/types/user';

const ROLE_TINTS: Record<string, string> = {
  Admin: 'bg-purple-100 text-purple-600',
  Operator: 'bg-indigo-100 text-indigo-600',
  Viewer: 'bg-sky-100 text-sky-600',
};

export default function RolesPage() {
  const { data: roles, isLoading, isError } = useQuery<AppRole[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await apiFetch('/api/roles');
      if (!res.ok) throw new Error('Failed to load roles');
      return res.json();
    },
  });

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Roles & Permissions</h1>

      {isLoading && <p className="text-slate-500">Loading roles...</p>}
      {isError && <p className="text-red-600">Failed to load roles.</p>}

      <div className="flex flex-col gap-4">
        {roles?.map((role) => (
          <section key={role.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-3">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${ROLE_TINTS[role.name] ?? 'bg-slate-100 text-slate-600'}`}
              >
                <Shield className="h-4 w-4" />
              </div>
              <h2 className="text-lg font-medium text-slate-900">{role.name}</h2>
            </div>
            {role.description && <p className="text-sm text-slate-500">{role.description}</p>}
            <ul className="mt-3 flex flex-wrap gap-2">
              {role.permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs text-slate-600"
                >
                  {permission}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
