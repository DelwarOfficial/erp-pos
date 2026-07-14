// src/domain/commands/m3/PostSale.ts
// PostSale domain command per §7.2 — the online POS sale workflow.
//
// Full flow (double-entry from sale to ledger):
//   1. Validate cashier shift + warehouse + products
//   2. Server computes totals (subtotal, tax, grand_total)
//   3. Generate reference number
//   4. Create business event + sale header
//   5. Create sale items + tax snapshots + serial links
//   6. Post stock movements (sale_issue, outbound, uses pre-movement MAC)
//   7. Update serials to 'sold' + serial events
//   8. Post payments + payment allocations
//   9. Post revenue/COGS/inventory journals (Dr AR/Cash, Cr Revenue + Tax;
//      Dr COGS, Cr Inventory) — using accounting policies
//  10. Audit log

import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { postStockMovement, validateSerialTransition } from '@/domain/inventory/stockMovement';
import { postJournalEntry } from '@/domain/commands/m4/PostJournalEntry';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';

export interface PostSaleInput {
  companyId: string;
  branchId: string;
  warehouseId: string;
  cashierId: string;
  cashierShiftId?: string;
  customerId?: string;
  currencyCode: string;
  exchangeRate: number;
  businessDate: Date;
  saleNote?: string;
  items: Array<{
    productId: string;
    qty: number;
    unitPrice: number;
    discountAmount?: number;
    serials?: string[];
  }>;
  payments: Array<{
    paymentMethod: string;
    amount: number;
    financialAccountId: string;
    methodReference?: string;
  }>;
}

export interface PostSaleResult {
  saleId: string;
  referenceNo: string;
  saleStatus: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  baseGrandTotal: string;
  paymentCount: number;
  itemCount: number;
  eventId: string; // business_event.id — used by risk assessment hook
}

export async function postSale(
  tx: Prisma.TransactionClient,
  input: PostSaleInput,
  correlationId: string,
): Promise<PostSaleResult> {
  let cashierShiftId: string | null = input.cashierShiftId ?? null;
  if (cashierShiftId) {
    const shift = await tx.cashierShift.findFirst({
      where: { id: cashierShiftId, companyId: input.companyId, status: 'open' },
    });
    if (!shift) {
      throw new DomainError('NO_OPEN_SHIFT', 'Cashier shift is not open', { shift_id: cashierShiftId }, 409);
    }
  }

  const warehouse = await tx.warehouse.findFirst({
    where: { id: input.warehouseId, companyId: input.companyId, branchId: input.branchId },
  });
  if (!warehouse) {
    throw new DomainError('VALIDATION_FAILED', 'Warehouse not found in this branch', {}, 404);
  }

  const { documentNumber: referenceNo } = await nextDocumentNumber(tx, {
    companyId: input.companyId,
    branchId: input.branchId,
    documentType: 'SALE',
    fiscalYear: new Date(input.businessDate).getFullYear(),
    prefix: 'INV-',
  });

  const eventId = randomUUID();
  await tx.businessEvent.create({
    data: {
      id: eventId,
      companyId: input.companyId,
      eventType: 'sale.posted',
      sourceType: 'sale',
      sourceId: referenceNo,
      correlationId,
      occurredAt: new Date(),
    },
  });

  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  const saleItemsData: Array<{
    lineNo: number;
    productId: string;
    productNameSnapshot: string;
    productCodeSnapshot: string;
    unitCodeSnapshot: string;
    qty: number;
    unitCostSnapshot: number;
    unitPriceSnapshot: number;
    grossAmount: number;
    discountAmount: number;
    taxableAmount: number;
    taxAmount: number;
    lineTotal: number;
    serials: string[];
  }> = [];

  let lineNo = 1;
  for (const item of input.items) {
    if (item.qty <= 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: quantity must be > 0`, {}, 400);
    }
    if (item.unitPrice < 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: unit price must be >= 0`, {}, 400);
    }

    const product = await tx.product.findFirst({
      where: { id: item.productId, companyId: input.companyId, isActive: true, deletedAt: null },
      include: { unit: true, defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } },
    });
    if (!product) {
      throw new DomainError('RESOURCE_NOT_FOUND', `Product ${item.productId} not found or inactive`, {}, 404);
    }

    const isStockProduct = product.productType === 'standard' || product.productType === 'combo';

    const stock = await tx.warehouseStock.findUnique({
      where: {
        companyId_warehouseId_productId: {
          companyId: input.companyId,
          warehouseId: input.warehouseId,
          productId: item.productId,
        },
      },
    });
    const unitCost = stock ? parseFloat(stock.movingAverageCost.toString()) : 0;

    const grossAmount = item.qty * item.unitPrice;
    const discountAmount = item.discountAmount ?? 0;
    const taxableAmount = grossAmount - discountAmount;

    let lineTaxAmount = 0;
    if (product.defaultTaxCode && taxableAmount > 0) {
      for (const tc of product.defaultTaxCode.components) {
        const rate = parseFloat(tc.taxComponent.rate.toString());
        lineTaxAmount += taxableAmount * rate / 100;
      }
    }

    const lineTotal = taxableAmount + lineTaxAmount;

    let serialIds: string[] = [];
    if (product.isSerialized && isStockProduct) {
      if (!item.serials || item.serials.length !== item.qty) {
        throw new DomainError(
          'VALIDATION_FAILED',
          `Line ${lineNo}: serialized product requires exactly ${item.qty} serial(s), got ${item.serials?.length ?? 0}`,
          { line_no: lineNo, qty: item.qty, serials_provided: item.serials?.length ?? 0 },
          400,
        );
      }
      for (const serialNumber of item.serials) {
        const serial = await tx.productSerial.findFirst({
          where: { serialNumber, companyId: input.companyId, currentWarehouseId: input.warehouseId },
        });
        if (!serial) {
          throw new DomainError('SERIAL_NOT_AVAILABLE', `Serial ${serialNumber} not found in this warehouse`, { serial: serialNumber }, 409);
        }
        if (serial.status !== 'in_stock') {
          throw new DomainError('SERIAL_NOT_AVAILABLE', `Serial ${serialNumber} is not in_stock (status: ${serial.status})`, { serial: serialNumber, status: serial.status }, 409);
        }
        serialIds.push(serial.id);
      }
    }

    saleItemsData.push({
      lineNo, productId: item.productId,
      productNameSnapshot: product.name, productCodeSnapshot: product.code,
      unitCodeSnapshot: product.unit.code,
      qty: item.qty, unitCostSnapshot: unitCost, unitPriceSnapshot: item.unitPrice,
      grossAmount, discountAmount, taxableAmount, taxAmount: lineTaxAmount, lineTotal,
      serials: serialIds,
    });

    subtotal += grossAmount;
    discountTotal += discountAmount;
    taxTotal += lineTaxAmount;
    lineNo++;
  }

  const grandTotal = subtotal - discountTotal + taxTotal;
  const baseGrandTotal = grandTotal * input.exchangeRate;

  // ── D05: Credit sale validation (§20.D05) ──
  // Credit sale = payments don't cover the full grand total.
  // Credit sales are disabled by default (feature flag credit_sales).
  // When enabled: customer must exist, have credit limit > 0, not be overdue,
  // and the new exposure (existing AR + this sale's unpaid amount) must not exceed credit limit.
  // Walk-in customers cannot make credit sales.
  const totalPaid = input.payments.reduce((sum, p) => sum + p.amount, 0);
  const isCreditSale = totalPaid < grandTotal;
  const unpaidAmount = grandTotal - totalPaid;

  if (isCreditSale) {
    // Check feature flag
    const creditFlag = await tx.featureFlag.findFirst({
      where: { companyId: input.companyId, flagKey: 'credit_sales' },
    });
    if (!creditFlag?.enabled) {
      throw new DomainError(
        'FEATURE_NOT_ENABLED',
        'Credit sales are not enabled for this company. Enable the credit_sales feature flag or pay the full amount.',
        { flag: 'credit_sales' },
        403,
      );
    }

    // Walk-in customers cannot make credit sales
    if (!input.customerId) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Credit sales require a registered customer (walk-in customers cannot buy on credit)',
        {},
        400,
      );
    }

    // Load customer with credit info
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, companyId: input.companyId, isActive: true, deletedAt: null },
    });
    if (!customer) {
      throw new DomainError('RESOURCE_NOT_FOUND', 'Customer not found or inactive', {}, 404);
    }

    const creditLimit = parseFloat(customer.creditLimit?.toString() ?? '0');
    if (creditLimit <= 0) {
      throw new DomainError(
        'CREDIT_LIMIT_EXCEEDED',
        `Customer ${customer.name} has no credit limit set (credit limit = 0)`,
        { customer_id: input.customerId, credit_limit: 0 },
        409,
      );
    }

    // Calculate current AR exposure (outstanding sales - payments allocated)
    const outstandingSales = await tx.sale.aggregate({
      where: {
        companyId: input.companyId,
        customerId: input.customerId,
        saleStatus: { in: ['completed', 'partially_paid'] },
      },
      _sum: { grandTotal: true },
    });
    const outstandingPayments = await tx.payment.aggregate({
      where: {
        companyId: input.companyId,
        customerId: input.customerId,
        paymentStatus: { in: ['posted', 'completed'] },
      },
      _sum: { amount: true },
    });
    const currentAR = parseFloat(String(outstandingSales._sum.grandTotal ?? '0'))
      - parseFloat(String(outstandingPayments._sum.amount ?? '0'));

    // Check if customer is overdue (has sales older than credit period with unpaid balance)
    // Default credit period: 30 days (configurable via configuration_definitions)
    const creditPeriodDays = 30; // TODO: load from configuration_definitions
    const overdueDate = new Date();
    overdueDate.setDate(overdueDate.getDate() - creditPeriodDays);
    const overdueSales = await tx.sale.findFirst({
      where: {
        companyId: input.companyId,
        customerId: input.customerId,
        saleStatus: { in: ['completed', 'partially_paid'] },
        businessDate: { lt: overdueDate },
      },
      select: { id: true },
    });
    if (overdueSales) {
      throw new DomainError(
        'CUSTOMER_OVERDUE',
        `Customer ${customer.name} has overdue sales older than ${creditPeriodDays} days. Credit sale blocked until overdue balance is cleared.`,
        { customer_id: input.customerId, credit_period_days: creditPeriodDays },
        409,
      );
    }

    // Check credit limit: current AR + new unpaid amount must not exceed credit limit
    const newExposure = currentAR + unpaidAmount;
    if (newExposure > creditLimit) {
      throw new DomainError(
        'CREDIT_LIMIT_EXCEEDED',
        `Credit limit exceeded for customer ${customer.name}: current AR = ৳${currentAR.toFixed(2)}, this sale unpaid = ৳${unpaidAmount.toFixed(2)}, total exposure = ৳${newExposure.toFixed(2)}, credit limit = ৳${creditLimit.toFixed(2)}`,
        {
          customer_id: input.customerId,
          current_ar: currentAR,
          unpaid_amount: unpaidAmount,
          new_exposure: newExposure,
          credit_limit: creditLimit,
        },
        409,
      );
    }
  }

  const sale = await tx.sale.create({
    data: {
      companyId: input.companyId, branchId: input.branchId, warehouseId: input.warehouseId,
      referenceNo, clientTxnId: randomUUID(),
      customerId: input.customerId ?? null,
      billerId: input.cashierId, cashierShiftId,
      saleStatus: 'completed',
      currencyCode: input.currencyCode, exchangeRate: input.exchangeRate,
      subtotal, discountTotal, taxTotal, grandTotal, baseGrandTotal,
      saleNote: input.saleNote ?? null,
      businessDate: input.businessDate, postedAt: new Date(),
    },
  });

  let eventLineNo = 1;
  for (const itemData of saleItemsData) {
    const product = await tx.product.findFirst({
      where: { id: itemData.productId },
      include: { defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } },
    });

    const saleItem = await tx.saleItem.create({
      data: {
        companyId: input.companyId, saleId: sale.id, lineNo: itemData.lineNo,
        productId: itemData.productId,
        productNameSnapshot: itemData.productNameSnapshot, productCodeSnapshot: itemData.productCodeSnapshot,
        unitCodeSnapshot: itemData.unitCodeSnapshot,
        qty: itemData.qty, unitCostSnapshot: itemData.unitCostSnapshot, unitPriceSnapshot: itemData.unitPriceSnapshot,
        grossAmount: itemData.grossAmount, discountAmount: itemData.discountAmount,
        taxableAmount: itemData.taxableAmount, taxAmount: itemData.taxAmount, lineTotal: itemData.lineTotal,
        warrantyMonthsSnapshot: product?.warrantyPeriodMonths ?? null,
        inventoryIssueSource: (product?.productType === 'service' || product?.productType === 'digital') ? 'none' : 'sale',
      },
    });

    if (product?.defaultTaxCode && itemData.taxAmount > 0) {
      for (const tc of product.defaultTaxCode.components) {
        const rate = parseFloat(tc.taxComponent.rate.toString());
        const componentTax = itemData.taxableAmount * rate / 100;
        await tx.saleItemTax.create({
          data: {
            companyId: input.companyId, saleItemId: saleItem.id, taxComponentId: tc.taxComponentId,
            componentCodeSnapshot: tc.taxComponent.componentCode, rateSnapshot: tc.taxComponent.rate,
            taxableBase: itemData.taxableAmount, taxAmount: componentTax,
          },
        });
      }
    }

    for (const serialId of itemData.serials) {
      await tx.saleItemSerial.create({ data: { saleItemId: saleItem.id, serialId } });
    }

    if (product && (product.productType === 'standard' || product.productType === 'combo')) {
      const movementResult = await postStockMovement(tx, {
        companyId: input.companyId, eventId, eventLineNo,
        warehouseId: input.warehouseId, productId: itemData.productId,
        movementType: 'sale_issue', qtyDelta: -itemData.qty,
        unitCost: itemData.unitCostSnapshot,
        referenceType: 'sale', referenceId: sale.id, sourceLineId: saleItem.id,
        effectiveAt: input.businessDate, createdBy: input.cashierId,
        metadata: { sale_reference: referenceNo, sale_item_id: saleItem.id },
      });
      eventLineNo++;

      for (const serialId of itemData.serials) {
        const serial = await tx.productSerial.findUnique({ where: { id: serialId } });
        if (serial) {
          validateSerialTransition(serial.status, 'sold');
          await tx.productSerial.update({
            where: { id: serialId },
            data: {
              status: 'sold', currentWarehouseId: null, soldSaleItemId: saleItem.id,
              version: { increment: 1 }, updatedAt: new Date(),
              warrantyStartDate: input.businessDate,
              warrantyExpiryDate: product.warrantyPeriodMonths
                ? new Date(input.businessDate.getTime() + product.warrantyPeriodMonths * 30 * 24 * 60 * 60 * 1000)
                : null,
            },
          });
          await tx.serialEvent.create({
            data: {
              companyId: input.companyId, serialId, eventId, eventLineNo,
              eventType: 'sold', fromStatus: 'in_stock', toStatus: 'sold',
              fromWarehouseId: input.warehouseId, toWarehouseId: null,
              stockMovementId: movementResult.movementId,
              referenceType: 'sale', referenceId: sale.id, createdBy: input.cashierId,
            },
          });
          eventLineNo++;
        }
      }
    }
  }

  let paymentCount = 0;
  for (const payment of input.payments) {
    if (payment.amount <= 0) {
      throw new DomainError('VALIDATION_FAILED', 'Payment amount must be > 0', {}, 400);
    }
    const paymentRef = await nextDocumentNumber(tx, {
      companyId: input.companyId, branchId: input.branchId,
      documentType: 'PAYMENT', fiscalYear: new Date(input.businessDate).getFullYear(), prefix: 'PMT-',
    });
    const paymentRecord = await tx.payment.create({
      data: {
        companyId: input.companyId, branchId: input.branchId,
        referenceNo: paymentRef.documentNumber, clientTxnId: randomUUID(),
        paymentType: 'sale_receipt', direction: 'incoming',
        customerId: input.customerId ?? null,
        financialAccountId: payment.financialAccountId, cashierShiftId,
        currencyCode: input.currencyCode, exchangeRate: input.exchangeRate,
        amount: payment.amount, baseAmount: payment.amount * input.exchangeRate,
        paymentMethod: payment.paymentMethod, methodReference: payment.methodReference ?? null,
        chequeStatus: payment.paymentMethod === 'cheque' ? 'pending_clearance' : 'not_applicable',
        paymentStatus: 'posted', businessDate: input.businessDate,
        receivedOrPaidAt: new Date(), postedAt: new Date(), createdBy: input.cashierId,
      },
    });
    await tx.paymentAllocation.create({
      data: {
        companyId: input.companyId, paymentId: paymentRecord.id, eventId, eventLineNo,
        saleId: sale.id, allocationSource: 'direct',
        allocatedAmount: payment.amount, allocatedBaseAmount: payment.amount * input.exchangeRate,
        createdBy: input.cashierId,
      },
    });
    eventLineNo++;
    paymentCount++;
  }

  // 9. Post revenue + COGS + inventory journals using accounting policies
  //    Revenue JE: Dr AR/Cash (grand_total), Cr Sales Revenue (subtotal - discount), Cr Tax Payable (tax_total)
  //    COGS JE: Dr COGS (qty × unit_cost_snapshot), Cr Inventory (qty × unit_cost_snapshot)
  const policies = await tx.accountingPolicy.findUnique({ where: { companyId: input.companyId } });
  if (policies) {
    // Revenue journal
    const revenueJournalLines: Array<{ chartOfAccountId: string; debit: number; credit: number; memo?: string; branchId?: string }> = [];

    // Dr AR or Cash for grand_total
    const totalPayments = input.payments.reduce((s, p) => s + p.amount, 0);
    const arAmount = grandTotal - totalPayments;  // unpaid portion → AR
    if (arAmount > 0.01) {
      revenueJournalLines.push({
        chartOfAccountId: policies.arAccountId,
        debit: arAmount, credit: 0,
        memo: `AR for ${referenceNo}`,
        branchId: input.branchId,
      });
    }
    // Dr Cash/Bank for payments received
    for (const payment of input.payments) {
      const fa = await tx.financialAccount.findFirst({
        where: { id: payment.financialAccountId, companyId: input.companyId },
      });
      if (fa) {
        revenueJournalLines.push({
          chartOfAccountId: fa.chartOfAccountId,
          debit: payment.amount, credit: 0,
          memo: `Cash received for ${referenceNo}`,
          branchId: input.branchId,
        });
      }
    }
    // Cr Sales Revenue (subtotal - discount = taxable + non-taxable)
    const netRevenue = subtotal - discountTotal;
    if (netRevenue > 0) {
      revenueJournalLines.push({
        chartOfAccountId: policies.salesRevenueAccountId,
        debit: 0, credit: netRevenue,
        memo: `Sales revenue for ${referenceNo}`,
        branchId: input.branchId,
      });
    }
    // Cr Tax Payable (use the first tax component's output account, or skip if not configured)
    if (taxTotal > 0) {
      // Find the VAT output account from tax components
      const firstTaxLine = saleItemsData.find(si => si.taxAmount > 0);
      if (firstTaxLine) {
        const product = await tx.product.findFirst({
          where: { id: firstTaxLine.productId },
          include: { defaultTaxCode: { include: { components: { include: { taxComponent: { include: { outputAccount: true } } } } } } },
        });
        const vatAccount = product?.defaultTaxCode?.components?.[0]?.taxComponent?.outputAccountId;
        if (vatAccount) {
          revenueJournalLines.push({
            chartOfAccountId: vatAccount,
            debit: 0, credit: taxTotal,
            memo: `VAT output for ${referenceNo}`,
            branchId: input.branchId,
          });
        }
      }
    }

    if (revenueJournalLines.length >= 2) {
      await postJournalEntry(tx, {
        companyId: input.companyId,
        entryDate: input.businessDate,
        postingKind: 'sale_revenue',
        sourceType: 'sale', sourceId: `${sale.id}:revenue`,
        description: `Revenue: ${referenceNo}`,
        currencyCode: input.currencyCode,
        exchangeRate: input.exchangeRate,
        createdBy: input.cashierId,
        lines: revenueJournalLines.map(l => ({
          chartOfAccountId: l.chartOfAccountId,
          branchId: l.branchId,
          debit: l.debit, credit: l.credit,
          memo: l.memo,
        })),
      }, correlationId);
    }

    // COGS journal: Dr COGS, Cr Inventory (for each stock product line)
    const cogsJournalLines: Array<{ chartOfAccountId: string; debit: number; credit: number; memo?: string; branchId?: string }> = [];
    let totalCogs = 0;
    for (const itemData of saleItemsData) {
      const product = await tx.product.findFirst({ where: { id: itemData.productId } });
      if (product && (product.productType === 'standard' || product.productType === 'combo')) {
        const cogs = itemData.qty * itemData.unitCostSnapshot;
        totalCogs += cogs;
      }
    }
    if (totalCogs > 0) {
      cogsJournalLines.push({
        chartOfAccountId: policies.cogsAccountId,
        debit: totalCogs, credit: 0,
        memo: `COGS for ${referenceNo}`,
        branchId: input.branchId,
      });
      cogsJournalLines.push({
        chartOfAccountId: policies.inventoryAccountId,
        debit: 0, credit: totalCogs,
        memo: `Inventory issued for ${referenceNo}`,
        branchId: input.branchId,
      });

      await postJournalEntry(tx, {
        companyId: input.companyId,
        entryDate: input.businessDate,
        postingKind: 'sale_cogs',
        sourceType: 'sale', sourceId: `${sale.id}:cogs`,
        description: `COGS: ${referenceNo}`,
        currencyCode: input.currencyCode,
        exchangeRate: input.exchangeRate,
        createdBy: input.cashierId,
        lines: cogsJournalLines.map(l => ({
          chartOfAccountId: l.chartOfAccountId,
          branchId: l.branchId,
          debit: l.debit, credit: l.credit,
          memo: l.memo,
        })),
      }, correlationId);
    }
  }

  // 10. Audit
  await tx.auditLog.create({
    data: {
      companyId: input.companyId, userId: input.cashierId, correlationId,
      action: 'sale.post', entityType: 'sale', entityId: sale.id,
      afterValue: JSON.stringify({
        reference_no: referenceNo, grand_total: grandTotal,
        item_count: saleItemsData.length, payment_count: paymentCount,
      }),
    },
  });

  return {
    saleId: sale.id, referenceNo, saleStatus: 'completed',
    subtotal: subtotal.toString(), discountTotal: discountTotal.toString(),
    taxTotal: taxTotal.toString(), grandTotal: grandTotal.toString(),
    baseGrandTotal: baseGrandTotal.toString(), paymentCount, itemCount: saleItemsData.length,
    eventId,
  };
}
