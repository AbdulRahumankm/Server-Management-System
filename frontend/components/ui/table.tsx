import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900" {...props} />
  );
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y divide-slate-100 dark:divide-slate-800" {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-slate-50 dark:hover:bg-slate-900/60', className)} {...props} />;
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle font-medium text-slate-500 dark:text-slate-400',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('p-3 align-middle text-slate-700 dark:text-slate-200', className)} {...props} />
  );
}
