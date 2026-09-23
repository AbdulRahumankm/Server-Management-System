'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/apiClient';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginFormValues) {
    setServerError(null);
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      setServerError('Invalid email or password');
      return;
    }

    router.push('/dashboard');
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white dark:bg-slate-950">
      <form onSubmit={handleSubmit(onSubmit)} className="flex w-80 flex-col gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
          Server Inventory
        </h1>
        <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="Email" {...register('email')} />
          {errors.email && <p className="text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>}
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" placeholder="Password" {...register('password')} />
          {errors.password && (
            <p className="text-sm text-red-600 dark:text-red-400">{errors.password.message}</p>
          )}
        </div>
        {serverError && <p className="text-sm text-red-600 dark:text-red-400">{serverError}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
