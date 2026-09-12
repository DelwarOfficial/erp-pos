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
import { postJournalEntry, type JournalLineInput } from '@/domain/commands/m4/PostJournalEntry';
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

const SALE_READ_BATCH_SIZE = 500;

type SaleProduct = Prisma.ProductGetPayload<{
  include: { unit: true; defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } };
}>;

export async function postSale(
  tx: Prisma.TransactionClient,
  input: PostSaleInput,
  correlationId: string,
): Promise<PostSaleResult> {
  // Stored-value consumption is not implemented atomically in this command.
  // Reject at the domain boundary too (offline/import callers bypass HTTP Zod).
  if (input.payments.some(payment => ['gift_card', 'store_credit'].includes(payment.paymentMethod))) {
    throw new DomainError('FEATURE_NOT_ENABLED', 'Gift-card and store-credit POS tenders are unavailable until atomic redemption is enabled', {}, 409);
  }
  if (!Number.isFinite(input.exchangeRate) || input.exchangeRate <= 0) {
    throw new DomainError('VALIDATION_FAILED', 'Exchange rate must be positive and finite', {}, 400);
  }
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

  let subtotal = new Prisma.Decimal(0);
  let discountTotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);
  const saleItemsData: Array<{
    lineNo: number;
    productId: string;
    productNameSnapshot: string;
    productCodeSnapshot: string;
    unitCodeSnapshot: string;
    qty: number;
    unitCostSnapshot: Prisma.Decimal;
    unitPriceSnapshot: number;
    grossAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxableAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
    serials: string[];
    productType: string;
    warrantyPeriodMonths: number | null;
    taxComponents: Array<{
      taxComponentId: string;
      componentCode: string;
      rate: Prisma.Decimal;
      outputAccountId: string | null;
    }>;
  }> = [];

  const productIds = [...new Set(input.items.map(item => item.productId))];
  const products: SaleProduct[] = [];
  const stocks: Prisma.WarehouseStockGetPayload<object>[] = [];
  for (let offset = 0; offset < productIds.length; offset += SALE_READ_BATCH_SIZE) {
    const ids = productIds.slice(offset, offset + SALE_READ_BATCH_SIZE);
    products.push(...await tx.product.findMany({
      where: { id: { in: ids }, companyId: input.companyId, isActive: true, deletedAt: null },
      include: { unit: true, defaultTaxCode: { include: { components: { include: { taxComponent: true } } } } },
    }));
    stocks.push(...await tx.warehouseStock.findMany({
      where: { companyId: input.companyId, warehouseId: input.warehouseId, productId: { in: ids } },
    }));
  }
  const productById = new Map(products.map(product => [product.id, product]));
  const stockByProductId = new Map(stocks.map(stock => [stock.productId, stock]));

  const requestedSerialNumbers = [...new Set(input.items.flatMap(item => item.serials ?? []))];
  const availableSerials: Prisma.ProductSerialGetPayload<object>[] = [];
  for (let offset = 0; offset < requestedSerialNumbers.length; offset += SALE_READ_BATCH_SIZE) {
    availableSerials.push(...await tx.productSerial.findMany({
      where: {
        companyId: input.companyId,
        currentWarehouseId: input.warehouseId,
        serialNumber: { in: requestedSerialNumbers.slice(offset, offset + SALE_READ_BATCH_SIZE) },
      },
    }));
  }
  const serialByNumber = new Map(availableSerials.map(serial => [serial.serialNumber, serial]));
  const claimedSerialIds = new Set<string>();

  let lineNo = 1;
  for (const item of input.items) {
    if (!Number.isFinite(item.qty) || item.qty <= 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: quantity must be > 0`, {}, 400);
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new DomainError('VALIDATION_FAILED', `Line ${lineNo}: unit price must be >= 0`, {}, 400);
    }

    const product = productById.get(item.productId);
    if (!product) {
      throw new DomainError('RESOURCE_NOT_FOUND', `Product ${item.productId} not found or inactive`, {}, 404);
    }

    if (product.productType === 'combo' || product.trackBatches) {
      throw new DomainError('FEATURE_NOT_ENABLED', 'Combo and batch-tracked POS sales require component/batch allocation and are currently unavailable', {}, 409);
    }

    const isStockProduct = product.productType === 'standard' || product.productType === 'combo';

    const stock = stockByProductId.get(item.productId);
    const unitCost = new Prisma.Decimal(stock?.movingAverageCost.toString() ?? '0');

    const grossAmount = new Prisma.Decimal(item.qty).mul(item.unitPrice);
    const discountAmount = new Prisma.Decimal(item.discountAmount ?? 0);
    if (!discountAmount.isFinite() || discountAmount.lt(0) || discountAmount.gt(grossAmount)) {
      throw new DomainError('VALIDATION_FAILED', 'Discount must be between zero and line gross amount', {}, 400);
    }
    const taxableAmount = grossAmount.minus(discountAmount);

    let lineTaxAmount = new Prisma.Decimal(0);
    if (product.defaultTaxCode && taxableAmount.gt(0)) {
      for (const tc of product.defaultTaxCode.components) {
        lineTaxAmount = lineTaxAmount.plus(taxableAmount.mul(tc.taxComponent.rate).div(100));
      }
    }

    const lineTotal = taxableAmount.plus(lineTaxAmount);

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
        const serial = serialByNumber.get(serialNumber);
        if (!serial || serial.productId !== item.productId) {
          throw new DomainError('SERIAL_NOT_AVAILABLE', `Serial ${serialNumber} not found in this warehouse`, { serial: serialNumber }, 409);
        }
        if (serial.status !== 'in_stock') {
          throw new DomainError('SERIAL_NOT_AVAILABLE', `Serial ${serialNumber} is not in_stock (status: ${serial.status})`, { serial: serialNumber, status: serial.status }, 409);
        }
        if (claimedSerialIds.has(serial.id)) {
          throw new DomainError('SERIAL_NOT_AVAILABLE', 'A serial cannot be sold twice in the same sale', {}, 409);
        }
        claimedSerialIds.add(serial.id);
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
      productType: product.productType,
      warrantyPeriodMonths: product.warrantyPeriodMonths,
      taxComponents: product.defaultTaxCode?.components.map(tc => ({
        taxComponentId: tc.taxComponentId,
        componentCode: tc.taxComponent.componentCode,
        rate: tc.taxComponent.rate,
        outputAccountId: tc.taxComponent.outputAccountId,
      })) ?? [],
    });

    subtotal = subtotal.plus(grossAmount);
    discountTotal = discountTotal.plus(discountAmount);
    taxTotal = taxTotal.plus(lineTaxAmount);
    lineNo++;
  }

  const grandTotal = subtotal.minus(discountTotal).plus(taxTotal);
  const baseGrandTotal = grandTotal.mul(input.exchangeRate);

  // ── D05: Credit sale validation (§20.D05) ──
  // Credit sale = payments don't cover the full grand total.
  // Credit sales are disabled by default (feature flag credit_sales).
  // When enabled: customer must exist, have credit limit > 0, not be overdue,
  // and the new exposure (existing AR + this sale's unpaid amount) must not exceed credit limit.
  // Walk-in customers cannot make credit sales.
  const totalPaid = input.payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
  if (totalPaid.gt(grandTotal)) throw new DomainError('VALIDATION_FAILED', 'Record only the applied payment amount; return cash change separately', {}, 400);
  const isCreditSale = totalPaid.lt(grandTotal);
  const unpaidAmount = grandTotal.minus(totalPaid);

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
    const newExposure = unpaidAmount.plus(currentAR);
    if (newExposure.gt(creditLimit)) {
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
    const saleItem = await tx.saleItem.create({
      data: {
        companyId: input.companyId, saleId: sale.id, lineNo: itemData.lineNo,
        productId: itemData.productId,
        productNameSnapshot: itemData.productNameSnapshot, productCodeSnapshot: itemData.productCodeSnapshot,
        unitCodeSnapshot: itemData.unitCodeSnapshot,
        qty: itemData.qty, unitCostSnapshot: itemData.unitCostSnapshot, unitPriceSnapshot: itemData.unitPriceSnapshot,
        grossAmount: itemData.grossAmount, discountAmount: itemData.discountAmount,
        taxableAmount: itemData.taxableAmount, taxAmount: itemData.taxAmount, lineTotal: itemData.lineTotal,
        warrantyMonthsSnapshot: itemData.warrantyPeriodMonths,
        inventoryIssueSource: (itemData.productType === 'service' || itemData.productType === 'digital') ? 'none' : 'sale',
      },
    });

    if (itemData.taxComponents.length > 0 && itemData.taxAmount.gt(0)) {
      for (const tc of itemData.taxComponents) {
        const componentTax = itemData.taxableAmount.mul(tc.rate).div(100);
        await tx.saleItemTax.create({
          data: {
            companyId: input.companyId, saleItemId: saleItem.id, taxComponentId: tc.taxComponentId,
            componentCodeSnapshot: tc.componentCode, rateSnapshot: tc.rate,
            taxableBase: itemData.taxableAmount, taxAmount: componentTax,
          },
        });
      }
    }

    for (const serialId of itemData.serials) {
      await tx.saleItemSerial.create({ data: { saleItemId: saleItem.id, serialId } });
    }

    if (itemData.productType === 'standard' || itemData.productType === 'combo') {
      const movementResult = await postStockMovement(tx, {
        companyId: input.companyId, eventId, eventLineNo,
        warehouseId: input.warehouseId, productId: itemData.productId,
        movementType: 'sale_issue', qtyDelta: -itemData.qty,
        unitCost: itemData.unitCostSnapshot.toString(),
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
              warrantyExpiryDate: itemData.warrantyPeriodMonths
                ? new Date(input.businessDate.getTime() + itemData.warrantyPeriodMonths * 30 * 24 * 60 * 60 * 1000)
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
    if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
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
        amount: payment.amount, baseAmount: new Prisma.Decimal(payment.amount).mul(input.exchangeRate),
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
        allocatedAmount: payment.amount, allocatedBaseAmount: new Prisma.Decimal(payment.amount).mul(input.exchangeRate),
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
  if (!policies) {
    throw new DomainError('VALIDATION_FAILED', 'Accounting policies must be configured before completing a sale', {}, 409);
  }
  if (policies) {
    const financialAccountIds = [...new Set(input.payments.map(payment => payment.financialAccountId))];
    const financialAccounts: Prisma.FinancialAccountGetPayload<object>[] = [];
    for (let offset = 0; offset < financialAccountIds.length; offset += SALE_READ_BATCH_SIZE) {
      financialAccounts.push(...await tx.financialAccount.findMany({
        where: {
          companyId: input.companyId,
          id: { in: financialAccountIds.slice(offset, offset + SALE_READ_BATCH_SIZE) },
        },
      }));
    }
    const financialAccountById = new Map(financialAccounts.map(account => [account.id, account]));

    // Revenue journal
    const revenueJournalLines: JournalLineInput[] = [];

    // Dr AR or Cash for grand_total
    const totalPayments = totalPaid;
    const arAmount = grandTotal.minus(totalPayments);  // unpaid portion → AR
    if (arAmount.gt(0)) {
      revenueJournalLines.push({
        chartOfAccountId: policies.arAccountId,
        debit: arAmount, credit: 0,
        memo: `AR for ${referenceNo}`,
        branchId: input.branchId,
      });
    }
    // Dr Cash/Bank for payments received
    for (const payment of input.payments) {
      const fa = financialAccountById.get(payment.financialAccountId);
      if (!fa || !fa.isActive || fa.currencyCode !== input.currencyCode) {
        throw new DomainError('VALIDATION_FAILED', 'Payment account must be active, tenant-owned and in the sale currency', {}, 409);
      }
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
    const netRevenue = subtotal.minus(discountTotal);
    if (netRevenue.gt(0)) {
      revenueJournalLines.push({
        chartOfAccountId: policies.salesRevenueAccountId,
        debit: 0, credit: netRevenue,
        memo: `Sales revenue for ${referenceNo}`,
        branchId: input.branchId,
      });
    }
    // Each tax component posts to its own configured account.
    const taxByAccount = new Map<string, Prisma.Decimal>();
    for (const item of saleItemsData) {
      for (const component of item.taxComponents) {
        const amount = item.taxableAmount.mul(component.rate).div(100);
        if (amount.isZero()) continue;
        if (!component.outputAccountId) {
          throw new DomainError('VALIDATION_FAILED', 'Every charged tax component requires an output account', {}, 409);
        }
        taxByAccount.set(component.outputAccountId,
          (taxByAccount.get(component.outputAccountId) ?? new Prisma.Decimal(0)).plus(amount));
      }
    }
    for (const [chartOfAccountId, amount] of taxByAccount) {
      revenueJournalLines.push({ chartOfAccountId, debit: 0, credit: amount,
        branchId: input.branchId, memo: `Tax output for ${referenceNo}` });
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
          // Revenue/receipts originate in transaction currency. COGS below
          // already originates in base currency and MUST NOT be converted again.
          debit: new Prisma.Decimal(l.debit).mul(input.exchangeRate),
          credit: new Prisma.Decimal(l.credit).mul(input.exchangeRate),
          memo: l.memo,
        })),
      }, correlationId);
    }

    // COGS journal: Dr COGS, Cr Inventory (for each stock product line)
    const cogsJournalLines: JournalLineInput[] = [];
    let totalCogs = new Prisma.Decimal(0);
    for (const itemData of saleItemsData) {
      if (itemData.productType === 'standard' || itemData.productType === 'combo') {
        const cogs = itemData.unitCostSnapshot.mul(itemData.qty);
        totalCogs = totalCogs.plus(cogs);
      }
    }
    if (totalCogs.gt(0)) {
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
