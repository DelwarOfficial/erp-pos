// src/components/shared/PageHeader.tsx
// One page-title anatomy for every dashboard screen: the h1, one sentence
// saying what the page is for, and the page's primary actions on the right.

import type { ReactNode } from 'react';

export function PageHeader({ title, description, icon, actions }: {
  title: ReactNode; description?: ReactNode; icon?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
          {icon}{title}
        </h1>
        {description && <p className="text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
