import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground">This address may have changed or the page may no longer exist.</p>
        <Button asChild><Link href="/dashboard">Go to dashboard</Link></Button>
      </div>
    </main>
  );
}
