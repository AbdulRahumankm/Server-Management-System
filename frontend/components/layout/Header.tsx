'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/apiClient';
import { useCurrentUser } from '@/lib/useCurrentUser';

export function Header() {
  const router = useRouter();
  const { data: currentUser } = useCurrentUser();

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    toast.success('Signed out');
    router.push('/login');
  }

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div />
      <div className="flex items-center gap-4">
        {currentUser && (
          <span className="text-sm text-slate-600">
            {currentUser.name} <span className="text-slate-400">· {currentUser.role}</span>
          </span>
        )}
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
