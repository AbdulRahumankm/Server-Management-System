'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './apiClient';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const res = await apiFetch('/api/auth/me');
      if (!res.ok) throw new Error('Not authenticated');
      return res.json();
    },
    retry: false,
  });
}
