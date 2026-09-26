'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function DashboardError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <section className="mx-auto max-w-lg space-y-4 rounded-lg border bg-card p-6" aria-labelledby="page-error-title">
      <div role="alert" className="space-y-2">
        <h1 id="page-error-title" className="text-xl font-semibold">This page could not be displayed</h1>
        <p className="text-sm text-muted-foreground">Try loading it again. If you were saving a transaction, check its status before submitting it again.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => unstable_retry()}>Try again</Button>
        <Button asChild variant="outline"><Link href="/dashboard">Go to dashboard</Link></Button>
      </div>
    </section>
  );
}
