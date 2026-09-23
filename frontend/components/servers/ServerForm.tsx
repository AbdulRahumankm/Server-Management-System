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

const selectClassName =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const textareaClassName = selectClassName;
const errorClassName = 'text-sm text-red-600';

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
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex max-w-xl flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <Label htmlFor="hostname">Hostname</Label>
        <Input id="hostname" className="font-mono" {...register('hostname')} />
        {errors.hostname && <p className={errorClassName}>{errors.hostname.message}</p>}
      </div>
      <div>
        <Label htmlFor="ipAddress">IP Address</Label>
        <Input id="ipAddress" className="font-mono" {...register('ipAddress')} />
        {errors.ipAddress && <p className={errorClassName}>{errors.ipAddress.message}</p>}
      </div>
      <div>
        <Label htmlFor="os">Operating System</Label>
        <select id="os" className={selectClassName} {...register('os')}>
          <option value="LINUX">Linux</option>
          <option value="WINDOWS">Windows</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div>
        <Label htmlFor="environment">Environment</Label>
        <select id="environment" className={selectClassName} {...register('environment')}>
          <option value="PRODUCTION">Production</option>
          <option value="UAT">UAT</option>
          <option value="DEVELOPMENT">Development</option>
          <option value="TEST">Test</option>
        </select>
      </div>
      <div>
        <Label htmlFor="application">Application</Label>
        <Input id="application" {...register('application')} />
        {errors.application && <p className={errorClassName}>{errors.application.message}</p>}
      </div>
      <div>
        <Label htmlFor="owner">Owner</Label>
        <Input id="owner" {...register('owner')} />
        {errors.owner && <p className={errorClassName}>{errors.owner.message}</p>}
      </div>
      <div>
        <Label htmlFor="location">Location</Label>
        <Input id="location" {...register('location')} />
      </div>
      <div>
        <Label htmlFor="username">Username</Label>
        <Input id="username" className="font-mono" {...register('username')} />
        {errors.username && <p className={errorClassName}>{errors.username.message}</p>}
      </div>
      <div>
        <Label htmlFor="sshPort">SSH Port</Label>
        <Input id="sshPort" type="number" className="font-mono" {...register('sshPort')} />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          className={textareaClassName}
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
