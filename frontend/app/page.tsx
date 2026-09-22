import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Server Inventory Platform</h1>
      <Button>Sign in</Button>
    </main>
  );
}
