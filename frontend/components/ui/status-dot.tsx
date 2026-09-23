import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500',
  INACTIVE: 'bg-slate-400',
  DECOMMISSIONED: 'bg-red-500',
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
      <span className={cn('h-2 w-2 rounded-full', STATUS_COLORS[status] ?? 'bg-slate-400')} />
      {status}
    </span>
  );
}
