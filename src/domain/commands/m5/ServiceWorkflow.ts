import { Prisma } from '@prisma/client';
import { validateServiceTransition } from './Service';
import { validateSerialTransition } from '@/domain/inventory/stockMovement';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';

export interface ServiceActionInput {
  companyId: string; id: string; userId: string; action: 'transition' | 'diagnosis' | 'estimate' | 'note' | 'link_sale';
  status?: string; note: string; estimatedAmount?: number; depositRequiredAmount?: number; serviceSaleId?: string;
}

export async function updateServiceRequest(tx: Prisma.TransactionClient, input: ServiceActionInput, correlationId: string) {
  const request = await tx.serviceRequest.findFirst({ where: { id: input.id, companyId: input.companyId }, include: { parts: true, serial: true } });
  if (!request) throw new DomainError('RESOURCE_NOT_FOUND', 'Service request not found', {}, 404);
  if (!input.note.trim()) throw new DomainError('VALIDATION_FAILED', 'Record an explanation or customer approval evidence', {}, 400);
  if (['delivered', 'cancelled'].includes(request.status) && input.action !== 'note') throw new DomainError('SERVICE_TRANSITION_INVALID', 'Closed service requests cannot be changed', {}, 409);
  const data: Prisma.ServiceRequestUpdateInput = {};
  let eventType: string = input.action;
  const values = await tx.configurationValue.findMany({ where: { companyId: input.companyId, definitionKey: 'service.deposit_required_threshold', OR: [{ scopeType: 'company', scopeId: input.companyId }, { scopeType: 'branch', scopeId: request.branchId }] } });
  const setting = values.find(value => value.scopeType === 'branch') ?? values.find(value => value.scopeType === 'company');
  const threshold = setting ? Number(JSON.parse(setting.value)) : 5000;
  if (!Number.isFinite(threshold) || threshold < 0) throw new DomainError('VALIDATION_FAILED', 'Service deposit threshold configuration is invalid', {}, 409);
  if (input.action === 'estimate') {
    if (!['received', 'diagnosing', 'awaiting_customer_approval'].includes(request.status)) throw new DomainError('SERVICE_TRANSITION_INVALID', 'Estimate changes require diagnosis before customer approval', {}, 409);
    if (input.estimatedAmount === undefined || !Number.isFinite(input.estimatedAmount) || input.estimatedAmount < 0 || !Number.isFinite(input.depositRequiredAmount ?? 0) || (input.depositRequiredAmount ?? 0) < 0 || (input.depositRequiredAmount ?? 0) > input.estimatedAmount) throw new DomainError('VALIDATION_FAILED', 'Enter a valid estimate and a deposit no larger than the estimate', {}, 400);
    data.estimatedAmount = input.estimatedAmount; data.depositRequiredAmount = input.depositRequiredAmount ?? 0; data.approvedAmount = null; data.status = 'diagnosing';
    await tx.approvalRequest.updateMany({ where: { companyId: input.companyId, referenceType: 'service_request', referenceId: request.id, requestType: 'service_estimate', status: { in: ['pending', 'approved'] } }, data: { status: 'cancelled' } });
  }
  if (input.action === 'diagnosis' && !['received', 'diagnosing'].includes(request.status)) throw new DomainError('SERVICE_TRANSITION_INVALID', 'Diagnosis can only be recorded during intake or diagnosis', {}, 409);
  if (input.action === 'diagnosis') data.status = 'diagnosing';
  if (input.action === 'link_sale') {
    if (!input.serviceSaleId) throw new DomainError('VALIDATION_FAILED', 'Select a service invoice', {}, 400);
    await validateServiceInvoice(tx, request, input.serviceSaleId);
    data.serviceSale = { connect: { id: input.serviceSaleId } };
  }
  if (input.action === 'transition') {
    if (!input.status || input.status === request.status) throw new DomainError('SERVICE_TRANSITION_INVALID', 'Select a different service state', {}, 400);
    validateServiceTransition(request.status, input.status); data.status = input.status; eventType = 'status_change';
    if (input.status === 'approved') {
      if (request.serviceType !== 'warranty' && request.status !== 'awaiting_customer_approval') throw new DomainError('APPROVAL_REQUIRED', 'Paid service must go through customer approval', {}, 409);
      if (request.serviceType !== 'warranty' && request.estimatedAmount.gt(threshold) && request.depositRequiredAmount.lte(0)) throw new DomainError('VALIDATION_FAILED', 'Set a positive required deposit on this estimate before requesting approval', {}, 400);
      data.approvedAmount = request.estimatedAmount;
      if (request.serviceType !== 'warranty' && request.estimatedAmount.gt(threshold)) await tx.approvalRequest.create({ data: { companyId: input.companyId, branchId: request.branchId, requestType: 'service_estimate', referenceType: 'service_request', referenceId: request.id, requestedBy: input.userId, reason: input.note, status: 'pending', payload: JSON.stringify({ estimated_amount: request.estimatedAmount.toString() }) } });
    }
    if (input.status === 'in_repair' && request.serviceType !== 'warranty') {
      if (request.approvedAmount === null) throw new DomainError('APPROVAL_REQUIRED', 'Record customer approval before repair', {}, 409);
      if (request.estimatedAmount.gt(threshold)) {
        const approval = await tx.approvalRequest.findFirst({ where: { companyId: input.companyId, referenceType: 'service_request', referenceId: request.id, requestType: 'service_estimate', status: 'approved' }, orderBy: { resolvedAt: 'desc' } });
        if (!approval || approval.requestedBy === approval.approvedBy) throw new DomainError('APPROVAL_REQUIRED', 'This estimate requires independent internal approval', {}, 409);
        if (request.depositRequiredAmount.lte(0)) throw new DomainError('VALIDATION_FAILED', 'This estimate requires a positive deposit; revise the estimate before approval', {}, 409);
      }
      if (request.depositRequiredAmount.gt(0)) {
        if (!request.serviceSaleId) throw new DomainError('VALIDATION_FAILED', 'Link the service invoice with its collected deposit before repair', {}, 409);
        const sale = await validateServiceInvoice(tx, request, request.serviceSaleId);
        const paid = sale.payments.filter(payment => payment.payment.paymentStatus === 'posted').reduce((sum, payment) => sum.plus(payment.allocatedAmount), new Prisma.Decimal(0));
        if (paid.mul(sale.exchangeRate).lt(request.depositRequiredAmount)) throw new DomainError('VALIDATION_FAILED', 'Collect the required deposit on the linked invoice before repair', {}, 409);
      }
    }
    if (input.status === 'delivered') {
      const billableParts = request.parts.filter(part => !part.warrantyCovered).reduce((sum, part) => sum.plus(part.quantity.mul(part.unitPrice)), new Prisma.Decimal(0));
      const minimumCharge = Prisma.Decimal.max(request.approvedAmount ?? 0, billableParts);
      if (minimumCharge.gt(0)) {
        if (!request.serviceSaleId) throw new DomainError('VALIDATION_FAILED', 'Post the billable service through POS and link its invoice before delivery', {}, 409);
        const sale = await validateServiceInvoice(tx, request, request.serviceSaleId);
        if (sale.baseGrandTotal.lt(minimumCharge)) throw new DomainError('VALIDATION_FAILED', 'Linked invoice does not cover the approved service and billable parts', {}, 409);
      }
      data.deliveredAt = new Date();
    }
    if (['delivered', 'cancelled'].includes(input.status)) {
      const cost = request.parts.reduce((sum, part) => sum.plus(part.quantity.mul(part.unitCostSnapshot)), new Prisma.Decimal(0));
      if (cost.gt(0)) {
        const policy = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
        if (!policy?.repairWipAccountId || !policy.serviceCogsAccountId) throw new DomainError('VALIDATION_FAILED', 'Configure service cost and repair WIP accounts before closing this request', {}, 409);
        const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { baseCurrencyCode: true } });
        await postJournalEntry(tx, { companyId: input.companyId, entryDate: new Date(), postingKind: request.serviceType === 'warranty' ? 'warranty_repair' : 'service_completion', sourceType: 'service_request', sourceId: request.id,
          description: `Service cost settlement ${request.referenceNo}`, currencyCode: company.baseCurrencyCode, exchangeRate: 1, createdBy: input.userId,
          lines: [{ chartOfAccountId: policy.serviceCogsAccountId, branchId: request.branchId, debit: cost, credit: 0 }, { chartOfAccountId: policy.repairWipAccountId, branchId: request.branchId, debit: 0, credit: cost }] }, correlationId);
      }
      if (request.serial) {
        if (request.serial.status !== 'repair') throw new DomainError('SERIAL_NOT_AVAILABLE', 'Device custody changed during service; reconcile before delivery', {}, 409);
        const intake = await tx.serviceEvent.findFirst({ where: { serviceRequestId: request.id, eventType: 'status_change' }, orderBy: { createdAt: 'asc' } });
        const initial = intake ? JSON.parse(intake.eventData) as { original_serial_status?: string; original_warehouse_id?: string | null } : {};
        const status = initial.original_serial_status ?? (request.serial.soldSaleItemId ? 'sold' : 'in_stock');
        validateSerialTransition('repair', status);
        await tx.productSerial.update({ where: { id: request.serial.id }, data: { status, currentWarehouseId: initial.original_warehouse_id ?? (status === 'sold' ? null : request.serial.currentWarehouseId), version: { increment: 1 } } });
        const event = await tx.businessEvent.create({ data: { companyId: input.companyId, eventType: 'service.device_returned', sourceType: 'service_request', sourceId: request.id, correlationId, occurredAt: new Date() } });
        await tx.serialEvent.create({ data: { companyId: input.companyId, serialId: request.serial.id, eventId: event.id, eventLineNo: 1, eventType: 'service.device_returned', fromStatus: 'repair', toStatus: status, fromWarehouseId: request.serial.currentWarehouseId, toWarehouseId: initial.original_warehouse_id ?? null, referenceType: 'service_request', referenceId: request.id, createdBy: input.userId } });
      }
    }
  }
  await tx.serviceRequest.update({ where: { id: request.id }, data });
  await tx.serviceEvent.create({ data: { companyId: input.companyId, serviceRequestId: request.id, eventType, createdBy: input.userId, eventData: JSON.stringify({ note: input.note.trim(), from: request.status, to: data.status ?? request.status, estimated_amount: input.estimatedAmount, deposit_required_amount: input.depositRequiredAmount, service_sale_id: input.serviceSaleId }) } });
  await tx.auditLog.create({ data: { companyId: input.companyId, userId: input.userId, correlationId, action: `service_request.${input.action}`, entityType: 'service_request', entityId: request.id, beforeValue: JSON.stringify({ status: request.status }), afterValue: JSON.stringify({ status: data.status ?? request.status, note: input.note }) } });
  return { id: request.id, status: data.status ?? request.status };
}

async function validateServiceInvoice(tx: Prisma.TransactionClient, request: { id: string; companyId: string; branchId: string; customerId: string | null }, id: string) {
  const sale = await tx.sale.findFirst({ where: { id, companyId: request.companyId, branchId: request.branchId, customerId: request.customerId, saleStatus: 'completed' }, include: { items: { include: { product: { select: { productType: true } } } }, payments: { include: { payment: true } } } });
  if (!sale || !sale.items.length || sale.items.some(item => item.product.productType !== 'service')) throw new DomainError('VALIDATION_FAILED', 'Select a completed service-only invoice for this customer and branch; parts already consumed must not be issued again by POS', {}, 400);
  if (await tx.serviceRequest.findFirst({ where: { companyId: request.companyId, serviceSaleId: sale.id, id: { not: request.id } } })) throw new DomainError('VALIDATION_FAILED', 'Invoice already belongs to another service request', {}, 409);
  return sale;
}
