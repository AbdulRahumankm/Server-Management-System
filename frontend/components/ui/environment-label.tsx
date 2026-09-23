import { cn } from '@/lib/utils';

const ENVIRONMENT_STYLES: Record<string, string> = {
  PRODUCTION: 'bg-sky-100 text-sky-700',
  UAT: 'bg-amber-100 text-amber-700',
  DEVELOPMENT: 'bg-violet-100 text-violet-700',
  TEST: 'bg-slate-100 text-slate-600',
};

export function EnvironmentLabel({ environment }: { environment: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        ENVIRONMENT_STYLES[environment] ?? 'bg-slate-100 text-slate-600',
      )}
    >
      {environment}
    </span>
  );
}
