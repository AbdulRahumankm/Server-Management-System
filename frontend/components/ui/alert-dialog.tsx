'use client';

import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 bg-slate-950/60" />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export const AlertDialogTitle = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    className={cn('text-lg font-semibold text-slate-900 dark:text-slate-50', className)}
    {...props}
  />
);

export const AlertDialogDescription = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    className={cn('mt-2 text-sm text-slate-500 dark:text-slate-400', className)}
    {...props}
  />
);

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4 flex justify-end gap-2', className)} {...props} />;
}

export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;
