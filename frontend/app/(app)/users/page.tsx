'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/apiClient';
import type { AppUser, AppRole } from '@/types/user';

const createUserSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleId: z.string().uuid('Select a role'),
});
type CreateUserValues = z.infer<typeof createUserSchema>;

function AddUserDialog({ roles }: { roles: AppRole[] }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserValues>({ resolver: zodResolver(createUserSchema) });

  async function onSubmit(values: CreateUserValues) {
    const res = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(values) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to create user');
      return;
    }
    toast.success('User created');
    reset();
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add User</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add User</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register('email')} />
            {errors.email && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.email.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register('name')} />
            {errors.name && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.name.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="password">Initial Password</Label>
            <Input id="password" type="password" {...register('password')} />
            {errors.password && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.password.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="roleId">Role</Label>
            <select
              id="roleId"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
              {...register('roleId')}
            >
              <option value="">Select a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            {errors.roleId && (
              <p className="text-sm text-red-600 dark:text-red-400">{errors.roleId.message}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({ user, roles }: { user: AppUser; roles: AppRole[] }) {
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState(user.role.id);
  const queryClient = useQueryClient();

  async function handleSave() {
    const res = await apiFetch(`/api/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ roleId }),
    });
    if (!res.ok) {
      toast.error('Failed to update role');
      return;
    }
    toast.success('Role updated');
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-sm text-slate-600 underline hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
          Edit Role
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Change role for {user.email}</DialogTitle>
        <div className="mt-4">
          <Label htmlFor={`role-${user.id}`}>Role</Label>
          <select
            id={`role-${user.id}`}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();

  const { data: users } = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiFetch('/api/users');
      if (!res.ok) throw new Error('Failed to load users');
      return res.json();
    },
  });

  const { data: roles } = useQuery<AppRole[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await apiFetch('/api/roles');
      if (!res.ok) throw new Error('Failed to load roles');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete user');
    },
    onSuccess: () => {
      toast.success('User deleted');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Failed to delete user'),
  });

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Users</h1>
        {roles && <AddUserDialog roles={roles} />}
      </div>

      {users && users.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.role.name}</TableCell>
                <TableCell className="flex gap-3">
                  {roles && <EditRoleDialog user={user} roles={roles} />}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="text-sm text-red-600 underline hover:text-red-500 dark:text-red-400">
                        Delete
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Delete {user.email}?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button variant="destructive" onClick={() => deleteMutation.mutate(user.id)}>
                            Delete
                          </Button>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
