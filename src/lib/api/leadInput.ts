import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { DomainError } from '@/lib/errors/codes';

export const LeadInput = z.object({
  branch_id: z.string().uuid().optional(), status_id: z.string().uuid().optional(),
  subject_id: z.string().uuid().nullable().optional(), source_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(200),
  company_name: z.string().trim().max(200).optional(), phone: z.string().trim().max(30).optional(),
  email: z.union([z.string().email().max(150), z.literal('')]).optional(),
  estimated_value: z.number().finite().min(0).nullable().optional(),
  next_action_at: z.string().datetime().nullable().optional(), notes: z.string().max(10000).optional(),
  lost_reason: z.string().trim().max(2000).optional(),
}).refine(value => value.phone || value.email, { message: 'Enter a phone number or email address' });

export async function validateLeadReferences(tx: Prisma.TransactionClient, companyId: string, body: z.infer<typeof LeadInput>) {
  if (body.branch_id && !await tx.branch.findFirst({ where: { id: body.branch_id, companyId, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an available branch', {}, 400);
  if (body.subject_id && !await tx.leadSubject.findFirst({ where: { id: body.subject_id, companyId, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an available subject', {}, 400);
  if (body.source_id && !await tx.leadSource.findFirst({ where: { id: body.source_id, companyId, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an available lead source', {}, 400);
  if (body.assigned_to && !await tx.user.findFirst({ where: { id: body.assigned_to, companyId, isActive: true } })) throw new DomainError('VALIDATION_FAILED', 'Select an active assignee from this company', {}, 400);
  let status = body.status_id ? await tx.leadStatus.findFirst({ where: { id: body.status_id, companyId, isActive: true } })
    : await tx.leadStatus.findFirst({ where: { companyId, isActive: true, isWon: false, isLost: false }, orderBy: { position: 'asc' } });
  if (!status && !body.status_id) {
    const last = await tx.leadStatus.aggregate({ where: { companyId }, _max: { position: true } });
    const existing = await tx.leadStatus.findFirst({ where: { companyId, name: 'New' } });
    if (existing) throw new DomainError('VALIDATION_FAILED', 'The New lead status is inactive; activate a starting status before creating leads', {}, 409);
    status = await tx.leadStatus.create({ data: { companyId, name: 'New', position: (last._max.position ?? -1) + 1 } });
  }
  if (!status) throw new DomainError('VALIDATION_FAILED', 'Select an active lead status from this company', {}, 400);
  if (status.isLost && !body.lost_reason) throw new DomainError('VALIDATION_FAILED', 'Explain why this lead was lost', {}, 400);
  return status;
}

export function leadFields(body: z.infer<typeof LeadInput>, statusId: string) {
  return { branchId: body.branch_id, statusId, subjectId: body.subject_id, sourceId: body.source_id, assignedTo: body.assigned_to,
    name: body.name, companyName: body.company_name || null, phone: body.phone || null, email: body.email || null,
    estimatedValue: body.estimated_value ?? null, nextActionAt: body.next_action_at ? new Date(body.next_action_at) : null,
    notes: body.notes || null, lostReason: body.lost_reason || null };
}
