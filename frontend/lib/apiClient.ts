const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const isFormData = init.body instanceof FormData;
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = rawFetch('/api/auth/refresh', { method: 'POST' })
      .then((res) => res.ok)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// inventory-service and audit-service verify JWTs locally and can't silently
// refresh an expired access token the way auth-service still can (it has
// direct DB access). When either returns 401, retry once after asking
// auth-service to mint a fresh access token from the still-valid refresh
// cookie.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await rawFetch(path, init);
  if (res.status !== 401 || path === '/api/auth/refresh' || path === '/api/auth/login') {
    return res;
  }
  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    return res;
  }
  return rawFetch(path, init);
}
