// src/domain/commands/m6/ConvertLead.ts
// ConvertLead per §7.15 — atomically creates/links customer + optional quotation.

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '@/lib/errors/codes';

export interface ConvertLeadInput {
  leadId: string;
  companyId: string;
  convertedBy: string;
  customerName?: string;  // override lead name for customer
  customerPhone?: string;
  customerEmail?: string;
}

export async function convertLead(
  tx: Prisma.TransactionClient, input: ConvertLeadInput, correlationId: string,
): Promise<{ leadId: string; customerId: string; status: string }> {
  const lead = await tx.lead.findFirst({
    where: { id: input.leadId, companyId: input.companyId },
    include: { status: true },
  });
  if (!lead) throw new DomainError('RESOURCE_NOT_FOUND', 'Lead not found', {}, 404);
  if (lead.convertedCustomerId) {
    throw new DomainError('VALIDATION_FAILED', 'Lead already converted', {}, 409);
  }

  // Find or create a 'won' status
  let wonStatus = lead.status;
  if (!wonStatus.isWon) {
    wonStatus = await tx.leadStatus.findFirst({
      where: { companyId: input.companyId, isWon: true, isActive: true },
    });
    if (!wonStatus) {
      // Create a won status
      wonStatus = await tx.leadStatus.create({
        data: { companyId: input.companyId, name: 'Won', position: 99, isWon: true, isActive: true },
      });
    }
  }

  // Create or link customer
  let customer = null;
  if (lead.phone) {
    customer = await tx.customer.findFirst({
      where: { companyId: input.companyId, phone: lead.phone, deletedAt: null },
    });
  }
  if (!customer && lead.email) {
    customer = await tx.customer.findFirst({
      where: { companyId: input.companyId, email: lead.email, deletedAt: null },
    });
  }
  if (!customer) {
    customer = await tx.customer.create({
      data: {
        companyId: input.companyId,
        name: input.customerName || lead.name,
        phone: input.customerPhone || lead.phone || null,
        email: input.customerEmail || lead.email || null,
      },
    });
  }

  // Update lead: set status to won, link converted customer
  await tx.lead.update({
    where: { id: lead.id },
    data: { statusId: wonStatus.id, convertedCustomerId: customer.id, updatedAt: new Date() },
  });

  // Create lead activity
  await tx.leadActivity.create({
    data: {
      companyId: input.companyId, leadId: lead.id,
      activityType: 'status_change',
      summary: `Lead converted to customer: ${customer.name}`,
      createdBy: input.convertedBy,
    },
  });

  await tx.auditLog.create({
    data: { companyId: input.companyId, userId: input.convertedBy, correlationId,
      action: 'lead.convert', entityType: 'lead', entityId: lead.id,
      afterValue: JSON.stringify({ customer_id: customer.id, customer_name: customer.name }) },
  });

  return { leadId: lead.id, customerId: customer.id, status: 'converted' };
}
