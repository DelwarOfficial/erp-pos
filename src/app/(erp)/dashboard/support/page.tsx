// src/app/(erp)/dashboard/support/page.tsx
// Support ticket form (no backend yet — submissions are stored in localStorage).
// Lists previously submitted local tickets.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, LifeBuoy, Send, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingState, EmptyState } from '@/components/shared/StateList';

type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  priority: Priority;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  createdAt: string;
}

const STORAGE_KEY = 'support.tickets.local';

const EMPTY_FORM = {
  subject: '',
  description: '',
  priority: 'normal' as Priority,
};

function priorityBadgeVariant(p: Priority): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (p) {
    case 'urgent': return 'destructive';
    case 'high': return 'default';
    case 'normal': return 'secondary';
    default: return 'outline';
  }
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      // No backend yet — read from localStorage on the client.
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const parsed: SupportTicket[] = raw ? JSON.parse(raw) : [];
      setTickets(Array.isArray(parsed) ? parsed : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load local tickets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  function persist(updated: SupportTicket[]) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setTickets(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save ticket locally');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim() || !form.description.trim()) {
      toast.error('Subject and description are required');
      return;
    }
    setSubmitting(true);
    try {
      const ticket: SupportTicket = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subject: form.subject.trim(),
        description: form.description.trim(),
        priority: form.priority,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      const updated = [ticket, ...tickets];
      persist(updated);
      toast.success('Support ticket submitted (stored locally — no backend wired yet)');
      setForm(EMPTY_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose(id: string) {
    try {
      const updated = tickets.map(t => t.id === id ? { ...t, status: 'closed' as const } : t);
      persist(updated);
      toast.success('Ticket closed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to close ticket');
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LifeBuoy className="h-6 w-6" /> Support
        </h1>
        <p className="text-muted-foreground">
          Submit a support ticket. Tickets are stored locally in this browser until the support backend is wired up.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit a Ticket</CardTitle>
            <CardDescription>
              Describe the issue you are facing. A support engineer will follow up once tickets are routed to a backend queue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="subject" className="text-xs">Subject</Label>
                <Input
                  id="subject"
                  placeholder="Brief summary of the issue"
                  value={form.subject}
                  onChange={e => setForm({ ...form, subject: e.target.value })}
                  required
                  maxLength={200}
                  className="min-h-[40px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="priority" className="text-xs">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v: string) => setForm({ ...form, priority: v as Priority })}
                >
                  <SelectTrigger id="priority" className="min-h-[40px]">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-xs">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Steps to reproduce, expected vs actual behavior, screenshots reference, etc."
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  required
                  rows={6}
                  maxLength={4000}
                />
                <p className="text-xs text-muted-foreground">{form.description.length}/4000 characters</p>
              </div>
              <Button type="submit" disabled={submitting} className="min-h-[44px]">
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Submit Ticket
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Previous Tickets ({tickets.length})</CardTitle>
            <CardDescription>
              Tickets submitted from this browser. Cleared if browser storage is reset.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingState label="Loading tickets..." />
            ) : tickets.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-8 w-8 text-muted-foreground/50" />}
                message="No tickets submitted yet."
              />
            ) : (
              <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tickets.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(t.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm max-w-[260px] truncate" title={t.description}>
                          {t.subject}
                        </TableCell>
                        <TableCell>
                          <Badge variant={priorityBadgeVariant(t.priority)}>{t.priority}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.status === 'closed' ? 'secondary' : 'outline'}>{t.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {t.status !== 'closed' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleClose(t.id)}
                              className="min-h-[36px]"
                            >
                              Close
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
