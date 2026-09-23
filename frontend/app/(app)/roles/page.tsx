'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiClient';
import type { AppRole } from '@/types/user';

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
      <h1 className="mb-6 text-2xl font-semibold text-slate-900 dark:text-slate-50">
        Roles & Permissions
      </h1>

      {isLoading && <p className="text-slate-500 dark:text-slate-400">Loading roles...</p>}
      {isError && <p className="text-red-600 dark:text-red-400">Failed to load roles.</p>}

      <div className="flex flex-col gap-4">
        {roles?.map((role) => (
          <section
            key={role.id}
            className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="text-lg font-medium text-slate-900 dark:text-slate-50">{role.name}</h2>
            {role.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400">{role.description}</p>
            )}
            <ul className="mt-2 flex flex-wrap gap-2">
              {role.permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded border border-slate-200 px-2 py-1 font-mono text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
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
