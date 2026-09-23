import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white dark:bg-slate-950">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header />
        <Breadcrumbs />
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
