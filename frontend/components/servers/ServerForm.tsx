'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const serverFormSchema = z.object({
  hostname: z.string().min(1, 'Hostname is required'),
  ipAddress: z.string().min(1, 'IP address is required'),
  os: z.enum(['LINUX', 'WINDOWS', 'OTHER']),
  environment: z.enum(['PRODUCTION', 'UAT', 'DEVELOPMENT', 'TEST']),
  application: z.string().min(1, 'Application is required'),
  owner: z.string().min(1, 'Owner is required'),
  location: z.string().optional(),
  username: z.string().min(1, 'Username is required'),
  sshPort: z.coerce.number().int().min(1).max(65535),
  description: z.string().optional(),
});

export type ServerFormValues = z.infer<typeof serverFormSchema>;

interface ServerFormProps {
  defaultValues?: Partial<ServerFormValues>;
  onSubmit: (values: ServerFormValues) => void;
  submitLabel: string;
}

export function ServerForm({ defaultValues, onSubmit, submitLabel }: ServerFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServerFormValues>({
    resolver: zodResolver(serverFormSchema),
    defaultValues: {
      os: 'LINUX',
      environment: 'PRODUCTION',
      sshPort: 22,
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-xl flex-col gap-4">
      <div>
        <Label htmlFor="hostname">Hostname</Label>
        <Input id="hostname" {...register('hostname')} />
        {errors.hostname && <p className="text-sm text-red-600">{errors.hostname.message}</p>}
      </div>
      <div>
        <Label htmlFor="ipAddress">IP Address</Label>
        <Input id="ipAddress" {...register('ipAddress')} />
        {errors.ipAddress && <p className="text-sm text-red-600">{errors.ipAddress.message}</p>}
      </div>
      <div>
        <Label htmlFor="os">Operating System</Label>
        <select
          id="os"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          {...register('os')}
        >
          <option value="LINUX">Linux</option>
          <option value="WINDOWS">Windows</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div>
        <Label htmlFor="environment">Environment</Label>
        <select
          id="environment"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          {...register('environment')}
        >
          <option value="PRODUCTION">Production</option>
          <option value="UAT">UAT</option>
          <option value="DEVELOPMENT">Development</option>
          <option value="TEST">Test</option>
        </select>
      </div>
      <div>
        <Label htmlFor="application">Application</Label>
        <Input id="application" {...register('application')} />
        {errors.application && <p className="text-sm text-red-600">{errors.application.message}</p>}
      </div>
      <div>
        <Label htmlFor="owner">Owner</Label>
        <Input id="owner" {...register('owner')} />
        {errors.owner && <p className="text-sm text-red-600">{errors.owner.message}</p>}
      </div>
      <div>
        <Label htmlFor="location">Location</Label>
        <Input id="location" {...register('location')} />
      </div>
      <div>
        <Label htmlFor="username">Username</Label>
        <Input id="username" {...register('username')} />
        {errors.username && <p className="text-sm text-red-600">{errors.username.message}</p>}
      </div>
      <div>
        <Label htmlFor="sshPort">SSH Port</Label>
        <Input id="sshPort" type="number" {...register('sshPort')} />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          {...register('description')}
        />
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
