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
import { priceSaleItem } from '@/domain/tax/priceSaleItem';
import { DomainError } from '@/lib/errors/codes';
import { nextDocumentNumber } from '@/lib/numbering';
import { buildSchedule, type PaymentArrangement } from '@/domain/receivables/schedule';
import { installmentBalances } from '@/domain/receivables/balances';
import { getApprovalThresholds } from '@/lib/approval/thresholds';
import { tenderGiftCard } from '@/domain/commands/m6/Loyalty';
import { couponDiscount } from '@/domain/loyalty/coupons';
import { earnPointsForSale, loyaltyAccounts, spendPointsForSale, TAKA_PER_POINT_SPENT } from '@/domain/loyalty/points';
import { localDate, isoFromDate } from '@/domain/receivables/calendar';
import { normalizeBdMobile } from '@/domain/receivables/phone';

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
  /** When the unpaid part of a credit sale falls due. Default: all of it after DEFAULT_CREDIT_DAYS. */
  paymentArrangement?: PaymentArrangement;
  /** Mobile number for this sale's due reminders; defaults to the customer's. */
  reminderPhone?: string;
  /** Send SMS due reminders for this sale (default true; the company policy must also be on). */
  dueRemindersEnabled?: boolean;
  /**
   * The caller may approve a price reduction above the company's
   * sale_discount_threshold (route: holds approval.resolve for the branch).
   * Without it, selling below the products' default prices by more than the
   * threshold, in total, is refused.
   */
  discountApproved?: boolean;
  /** A coupon code to apply to the whole sale. */
  couponCode?: string;
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
  /** Reward points the customer earned on this sale. */
  pointsEarned?: number;
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
  // Store credit has no tender yet. A gift card is spent in this same
  // transaction (tenderGiftCard below), so it needs the card's code and the
  // gift-card module switched on.
  if (input.payments.some(payment => payment.paymentMethod === 'store_credit')) {
    throw new DomainError('FEATURE_NOT_ENABLED', 'Store credit is not available as a POS tender yet', {}, 409);
  }
  const giftCardPayments = input.payments.filter(payment => payment.paymentMethod === 'gift_card');
  if (giftCardPayments.length) {
    if (giftCardPayments.some(payment => !payment.methodReference)) {
      throw new DomainError('VALIDATION_FAILED', 'Enter the gift card code for the gift card payment', {}, 400);
    }
    const flag = await tx.featureFlag.findFirst({ where: { companyId: input.companyId, flagKey: 'loyalty_enabled' } });
    if (!flag?.enabled) throw new DomainError('FEATURE_NOT_ENABLED', 'Gift cards are switched off for this company', { flag: 'loyalty_enabled' }, 403);
    if (input.currencyCode !== 'BDT') throw new DomainError('VALIDATION_FAILED', 'Gift cards pay for BDT sales only', {}, 400);
  }
  // Reward points: spent as a tender (৳1 a point) and earned on what is paid.
  const loyaltyOn = Boolean((await tx.featureFlag.findFirst({ where: { companyId: input.companyId, flagKey: 'loyalty_enabled' } }))?.enabled);
  const pointPayments = input.payments.filter(payment => payment.paymentMethod === 'reward_points');
  if (pointPayments.length) {
    if (!loyaltyOn) throw new DomainError('FEATURE_NOT_ENABLED', 'Reward points are switched off for this company', { flag: 'loyalty_enabled' }, 403);
    if (!input.customerId) throw new DomainError('VALIDATION_FAILED', 'Choose the customer whose points pay for this', {}, 400);
    if (input.currencyCode !== 'BDT') throw new DomainError('VALIDATION_FAILED', 'Points pay for BDT sales only', {}, 400);
    if (pointPayments.some(p => !Number.isInteger(p.amount / TAKA_PER_POINT_SPENT))) throw new DomainError('VALIDATION_FAILED', 'Points are spent in whole points', {}, 400);
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
    // The cash belongs in the drawer of the cashier making the sale, at this
    // branch. Any open shift of the company used to be accepted, so a sale
    // could be counted in someone else's drawer, or another branch's.
    if (shift.branchId !== input.branchId) {
      throw new DomainError('NO_OPEN_SHIFT', 'That shift is open at another branch', { shift_id: cashierShiftId }, 409);
    }
    if (shift.cashierId !== input.cashierId) {
      throw new DomainError('NO_OPEN_SHIFT', 'That shift belongs to another cashier; open your own shift', { shift_id: cashierShiftId }, 409);
    }
  }

  const warehouse = await tx.warehouse.findFirst({
    where: { id: input.warehouseId, companyId: input.companyId, branchId: input.branchId },
  });
  if (!warehouse) {
    throw new DomainError('VALIDATION_FAILED', 'Warehouse not found in this branch', {}, 404);
  }

  let subtotal = new Prisma.Decimal(0);
  let discountTotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);
  let priceReduction = new Prisma.Decimal(0);
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
      /** The base this component was charged on — larger than the line's taxable amount when compounded. */
      taxableBase: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      outputAccountId: string | null;
    }>;
  }> = [];

  // A coupon is a discount on the sale, spread over the lines before tax
  // (src/domain/loyalty/coupons.ts). It is authorised marketing, so it does
  // not count towards the price-reduction limit below.
  const coupon = input.couponCode ? await couponDiscount(tx, input.companyId, input.couponCode, input.items, input.businessDate) : null;
  const lines = input.items.map((item, i) => ({ ...item,
    discountAmount: coupon ? new Prisma.Decimal(item.discountAmount ?? 0).plus(coupon.perLine[i]).toNumber() : item.discountAmount }));
  const couponPart = (i: number) => coupon?.perLine[i] ?? new Prisma.Decimal(0);

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
  for (const [lineIndex, item] of lines.entries()) {
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

    const lineTax = priceSaleItem(product, item, input.businessDate);
    const { grossAmount, discountAmount } = lineTax;

    const taxableAmount = lineTax.taxableAmount;
    const lineTaxAmount = lineTax.taxAmount;
    const lineTotal = lineTax.lineTotal;

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
      // Per-component amounts come from the computation, so the stored
      // breakdown always sums to the line's tax — including the compounded
      // bases and the inclusive-price residual.
      taxComponents: lineTax.components.map(component => ({
        taxComponentId: component.taxComponentId,
        componentCode: component.componentCode,
        rate: component.rate,
        taxableBase: component.taxableBase,
        taxAmount: component.taxAmount,
        outputAccountId: component.outputAccountId,
      })),
    });

    // Price reduction against the catalogue: default price × qty minus what
    // the line actually charges (before tax). A price above default is fine.
    if (product.defaultPrice != null) {
      const listAmount = new Prisma.Decimal(product.defaultPrice).mul(item.qty);
      const reduction = listAmount.minus(grossAmount.minus(discountAmount.minus(couponPart(lineIndex))));
      if (reduction.gt(0)) priceReduction = priceReduction.plus(reduction);
    }

    subtotal = subtotal.plus(grossAmount);
    discountTotal = discountTotal.plus(discountAmount);
    taxTotal = taxTotal.plus(lineTaxAmount);
    lineNo++;
  }

  // Prices and discounts arrive from the till; the catalogue is the authority.
  // A reduction above the company threshold needs someone who can approve it.
  if (priceReduction.gt(0) && !input.discountApproved) {
    const { sale_discount_threshold: threshold } = await getApprovalThresholds(input.companyId);
    if (priceReduction.gt(threshold)) {
      throw new DomainError('APPROVAL_REQUIRED',
        `This sale is ৳${priceReduction.toFixed(2)} below list price, above the ৳${new Prisma.Decimal(threshold).toFixed(2)} a cashier may give. Ask a manager to post it.`,
        { price_reduction: priceReduction.toFixed(2), threshold }, 403);
    }
  }

  const grandTotal = subtotal.minus(discountTotal).plus(taxTotal);
  const baseGrandTotal = grandTotal.mul(input.exchangeRate);

  // ── D05: Credit sale validation (§20.D05) ──
  // Credit sale = payments don't cover the full grand total.
  // Credit sales are disabled by default (feature flag credit_sales).
  // When enabled: customer must exist, have credit limit > 0, not be overdue,
  // and the new exposure (existing AR + this sale's unpaid amount) must not exceed credit limit.
  // Walk-in customers cannot make credit sales.
  const company = await tx.company.findFirst({ where: { id: input.companyId }, select: { timezone: true } });
  const companyTimezone = company?.timezone ?? 'Asia/Dhaka';
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

    const creditLimit = new Prisma.Decimal(customer.creditLimit ?? 0);
    if (creditLimit.lte(0)) {
      throw new DomainError(
        'CREDIT_LIMIT_EXCEEDED',
        `Customer ${customer.name} has no credit limit set (credit limit = 0)`,
        { customer_id: input.customerId, credit_limit: 0 },
        409,
      );
    }

    // Current exposure and overdue status, from what the customer's
    // installments still owe (src/domain/receivables/balances.ts). This used to
    // be all sales minus all payments in floating point, and blocked any
    // customer with a sale older than 30 days -- even one paid in full at the
    // till -- which barred every returning customer from credit.
    const today = localDate(companyTimezone);
    const balances = await installmentBalances(tx, input.companyId, { customerId: input.customerId });
    const currentAR = balances.reduce((sum, b) => sum.plus(b.outstanding), new Prisma.Decimal(0));
    const overdue = balances.find(b => b.outstanding.gt(0) && isoFromDate(b.dueDate) < today);
    if (overdue) {
      throw new DomainError(
        'CUSTOMER_OVERDUE',
        `Customer ${customer.name} has an overdue installment (${overdue.saleReferenceNo} #${overdue.installmentNo}, due ${isoFromDate(overdue.dueDate)}). Credit sale blocked until it is paid.`,
        { customer_id: input.customerId, sale_id: overdue.saleId, installment_id: overdue.installmentId, due_date: isoFromDate(overdue.dueDate) },
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
          current_ar: currentAR.toFixed(2),
          unpaid_amount: unpaidAmount.toFixed(2),
          new_exposure: newExposure.toFixed(2),
          credit_limit: creditLimit.toFixed(2),
        },
        409,
      );
    }
  }

  // The unpaid part's schedule, validated before anything is written: it must
  // equal the unpaid amount exactly (src/domain/receivables/schedule.ts).
  const schedule = buildSchedule(unpaidAmount, localDate(companyTimezone, input.businessDate), input.paymentArrangement);

  // The number this sale's reminders go to, kept on the sale as sold. A number
  // given at the till must be valid; the customer record is not changed here.
  let reminderPhone: string | null = null;
  if (input.reminderPhone !== undefined && input.reminderPhone !== '') {
    reminderPhone = normalizeBdMobile(input.reminderPhone);
    if (!reminderPhone) throw new DomainError('VALIDATION_FAILED', 'The reminder mobile number is not a valid Bangladesh mobile number', {}, 400);
  } else if (input.customerId) {
    const customerPhone = await tx.customer.findFirst({ where: { id: input.customerId, companyId: input.companyId }, select: { phone: true } });
    reminderPhone = normalizeBdMobile(customerPhone?.phone);
  }

  // F-46: the branch's sale number row stays locked until this transaction
  // commits, so it is taken only now, after every lookup and check above;
  // sales in the branch no longer wait on each other through them.
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
      customerPhoneSnapshot: reminderPhone,
      dueRemindersEnabled: input.dueRemindersEnabled ?? true,
      businessDate: input.businessDate, postedAt: new Date(),
    },
  });

  if (coupon) {
    // Counted against the coupon's limit now, under a lock, so two sales cannot both take its last use.
    const [row] = await tx.$queryRaw<Array<{ usage_count: number; usage_limit: number | null }>>`SELECT usage_count, usage_limit FROM coupons WHERE id = ${coupon.couponId} FOR UPDATE`;
    if (row && row.usage_limit !== null && Number(row.usage_count) >= Number(row.usage_limit)) throw new DomainError('VALIDATION_FAILED', 'That coupon has just been used up', {}, 409);
    await tx.coupon.update({ where: { id: coupon.couponId }, data: { usageCount: { increment: 1 } } });
    await tx.couponRedemption.create({ data: { companyId: input.companyId, couponId: coupon.couponId, saleId: sale.id, discountAmount: coupon.discount } });
  }

  for (const installment of schedule) {
    await tx.installment.create({
      data: { companyId: input.companyId, saleId: sale.id, installmentNo: installment.installmentNo,
        dueDate: installment.dueDate, amount: installment.amount, status: 'scheduled' },
    });
  }

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
        await tx.saleItemTax.create({
          data: {
            companyId: input.companyId, saleItemId: saleItem.id, taxComponentId: tc.taxComponentId,
            componentCodeSnapshot: tc.componentCode, rateSnapshot: tc.rate,
            taxableBase: tc.taxableBase, taxAmount: tc.taxAmount,
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
    if (payment.paymentMethod === 'reward_points') {
      await spendPointsForSale(tx, { companyId: input.companyId, saleId: sale.id, customerId: input.customerId!, points: payment.amount / TAKA_PER_POINT_SPENT });
    }
    if (payment.paymentMethod === 'gift_card') {
      await tenderGiftCard(tx, { companyId: input.companyId, code: payment.methodReference!, amount: payment.amount,
        redeemedBy: input.cashierId, saleReferenceNo: referenceNo }, correlationId);
    }
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
        customerId: input.customerId,
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
        // A gift card pays by using up the liability its sale created, not cash.
        const giftCard = payment.paymentMethod === 'gift_card';
        const points = payment.paymentMethod === 'reward_points';
        revenueJournalLines.push({
          // Points spent use up the points liability, like a gift card.
          chartOfAccountId: points ? (await loyaltyAccounts(tx, input.companyId)).liability : giftCard ? policies.giftCardLiabilityAccountId : fa.chartOfAccountId,
          debit: payment.amount, credit: 0,
          memo: points ? `Reward points for ${referenceNo}` : giftCard ? `Gift card ${payment.methodReference} for ${referenceNo}` : `Cash received for ${referenceNo}`,
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
        // The computed per-component amount, not a re-derivation: compounded
        // components sit on a larger base than the line's taxable amount.
        const amount = component.taxAmount;
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

    // F-34: a sale with a value must reach the ledger. Too few revenue lines
    // used to skip the posting silently; only a zero-value sale has none.
    if (revenueJournalLines.length < 2 && grandTotal.gt(0)) {
      throw new DomainError('INTERNAL_ERROR', `Revenue posting for ${referenceNo} could not be assembled`, { lines: revenueJournalLines.length }, 500);
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
          // The AR line names the customer, so the customer ledger shows the sale.
          customerId: l.customerId,
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

  // Points earned on what was actually paid (not what is owed, not points spent).
  let pointsEarned = 0;
  if (loyaltyOn && input.customerId) {
    const paidWithMoney = input.payments.filter(p => p.paymentMethod !== 'reward_points').reduce((t, p) => t.plus(p.amount), new Prisma.Decimal(0)).mul(input.exchangeRate);
    pointsEarned = await earnPointsForSale(tx, { companyId: input.companyId, saleId: sale.id, referenceNo, customerId: input.customerId,
      paidAmount: paidWithMoney, createdBy: input.cashierId, branchId: input.branchId }, correlationId);
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
    eventId, pointsEarned,
  };
}
