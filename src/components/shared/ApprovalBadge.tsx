// src/components/shared/ApprovalBadge.tsx
// Shows approval status badge for maker-checker workflow items.

'use client';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';

const STATUS_CONFIG: Record<string, { variant: string; icon: React.ReactNode; label: string }> = {
  pending: { variant: 'bg-yellow-100 text-yellow-800', icon: <Clock className="h-3 w-3" />, label: 'Pending' },
  approved: { variant: 'bg-green-100 text-green-800', icon: <CheckCircle2 className="h-3 w-3" />, label: 'Approved' },
  rejected: { variant: 'bg-red-100 text-red-800', icon: <XCircle className="h-3 w-3" />, label: 'Rejected' },
  waived: { variant: 'bg-blue-100 text-blue-800', icon: <AlertCircle className="h-3 w-3" />, label: 'Waived' },
};

export function ApprovalBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <Badge className={config.variant}>
      {config.icon}
      <span className="ml-1">{config.label}</span>
    </Badge>
  );
}
