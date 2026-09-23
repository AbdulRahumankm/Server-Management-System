import { cn } from '@/lib/utils';

const ENVIRONMENT_COLORS: Record<string, string> = {
  PRODUCTION: 'text-sky-600 dark:text-sky-400',
  UAT: 'text-amber-600 dark:text-amber-400',
  DEVELOPMENT: 'text-violet-600 dark:text-violet-400',
  TEST: 'text-slate-500 dark:text-slate-400',
};

export function EnvironmentLabel({ environment }: { environment: string }) {
  return (
    <span className={cn('text-sm font-medium', ENVIRONMENT_COLORS[environment] ?? 'text-slate-500')}>
      {environment}
    </span>
  );
}
