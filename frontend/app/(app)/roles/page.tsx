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
      <h1 className="mb-6 text-2xl font-semibold">Roles & Permissions</h1>

      {isLoading && <p>Loading roles...</p>}
      {isError && <p className="text-red-600">Failed to load roles.</p>}

      <div className="flex flex-col gap-4">
        {roles?.map((role) => (
          <section key={role.id} className="rounded-lg border border-slate-200 p-4">
            <h2 className="text-lg font-medium">{role.name}</h2>
            {role.description && <p className="text-sm text-slate-500">{role.description}</p>}
            <ul className="mt-2 flex flex-wrap gap-2">
              {role.permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
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
