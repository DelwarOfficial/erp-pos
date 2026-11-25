// src/lib/import-export/importProcessor.ts
// Import job processor — staged validation + commit.
// Per §9.5 + §20.D11.
//
// Flow:
//   1. Upload: compute SHA-256, create import_job row, validate every row
//      against the template (status validating → ready/invalid).
//   2. Commit: the same file is supplied again (SHA-256 must match), the job is
//      claimed ready → importing, and rows are written
//      (status → completed/partial/failed).
//
// A job uploaded with dry_run=true is validate-only: it can never be committed.
//
// Master data (product, customer, supplier, category, unit, brand) is written
// row by row. Documents (sale, purchase, transfer, opening stock) are written
// one group at a time — the rows that share the template's groupKey — through
// the same domain commands the API uses, each group in one transaction, so a
// document is imported whole or not at all. The group's key from the file is
// recorded in import_job_entities, which stops the same file or a retried
// commit from creating the same document twice.
//
// Serialized imports require one serial per row (per §9.5).

import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getTenantContext, withTenant, type TransactionClient } from '@/lib/db/transaction';
import { DomainError } from '@/lib/errors/codes';
import { postSale } from '@/domain/commands/m3/PostSale';
import { createPurchase } from '@/domain/commands/m2/CreatePurchase';
import { createTransfer } from '@/domain/commands/m2/Transfer';
import { postOpeningStock } from '@/domain/commands/m2/PostOpeningStock';
import { parseCsv, rowToObject } from './csv';
import { MAX_IMPORT_ROWS, type ImportTemplate } from './templates';

export interface ImportValidationResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: Array<{
    rowNumber: number;
    columnName?: string;
    errorCode: string;
    errorMessage: string;
    rawRow?: string;
  }>;
  controlTotals: {
    expectedRows: number;
    actualRows: number;
    amountSum?: number;
  };
}

export interface ImportCommitResult {
  committedRows: number;
  skippedRows: number;
  failedRows: number;
  /** For document imports: the file's reference (group key) → the document created. */
  documents?: Array<{ sourceKey: string; entityType: string; entityId: string; referenceNo: string | null }>;
}

/** import_job_errors.error_message and raw_row are VARCHAR(191). */
const ERROR_TEXT_MAX = 191;
const clip = (text: string) => (text.length > ERROR_TEXT_MAX ? `${text.slice(0, ERROR_TEXT_MAX - 1)}…` : text);

/** Rows written between progress updates of the job's committed_rows counter. */
const PROGRESS_EVERY_ROWS = 100;

/** Payment methods a sale import may use (gift cards and points need a code or a confirmation, so not here). */
const SALE_IMPORT_METHODS = ['cash', 'card', 'cheque', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'other'];

/**
 * Validates a CSV file against the import template.
 * Records all row-level errors in import_job_errors.
 * Does NOT commit any data — purely validation.
 */
export async function validateImport(
  jobId: string,
  companyId: string,
  csvContent: string,
  template: ImportTemplate,
): Promise<ImportValidationResult> {
  const rows = parseCsv(csvContent);
  const result: ImportValidationResult = {
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    errors: [],
    controlTotals: { expectedRows: 0, actualRows: 0 },
  };

  if (rows.length < 2) {
    // No data rows (only header or empty)
    result.errors.push({
      rowNumber: 0,
      errorCode: 'NO_DATA',
      errorMessage: 'File contains no data rows (only header or empty)',
    });
    result.invalidRows = 1;
    await updateJobStatus(jobId, 'invalid', result);
    return result;
  }

  // First row is header
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(1);
  result.totalRows = dataRows.length;
  result.controlTotals.expectedRows = dataRows.length;

  // A file is checked row by row in the request, so its size is bounded here,
  // not only in the dashboard's text.
  if (dataRows.length > MAX_IMPORT_ROWS) {
    result.errors.push({
      rowNumber: 0,
      errorCode: 'ROW_LIMIT_EXCEEDED',
      errorMessage: `The file has ${dataRows.length} rows. Split it into files of at most ${MAX_IMPORT_ROWS} rows and import each one.`,
    });
    result.invalidRows = dataRows.length;
    await updateJobStatus(jobId, 'invalid', result);
    return result;
  }

  // Validate required columns exist in header
  const missingColumns = template.requiredColumns.filter(
    col => !headers.includes(col.toLowerCase()),
  );
  if (missingColumns.length > 0) {
    result.errors.push({
      rowNumber: 0,
      errorCode: 'MISSING_COLUMNS',
      errorMessage: `Missing required columns: ${missingColumns.join(', ')}`,
    });
    result.invalidRows = dataRows.length;
    await updateJobStatus(jobId, 'invalid', result);
    return result;
  }

  // Validate each row
  let amountSum = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 2; // +2 because row 1 is header, row 2 is first data
    const obj = rowToObject(row, headers);
    const rowErrors: Array<{ columnName?: string; errorCode: string; errorMessage: string }> = [];

    // Check column count
    if (row.length !== headers.length) {
      rowErrors.push({
        errorCode: 'COLUMN_COUNT_MISMATCH',
        errorMessage: `Expected ${headers.length} columns, got ${row.length}`,
      });
    }

    // Check required fields
    for (const col of template.requiredColumns) {
      const value = obj[col];
      if (!value || value.trim() === '') {
        rowErrors.push({
          columnName: col,
          errorCode: 'REQUIRED_FIELD_MISSING',
          errorMessage: `Required field '${col}' is empty`,
        });
      }
    }

    // Serialized check: if template validatesSerial and product is serialized,
    // serial_number must be present
    if (template.validatesSerial && obj.is_serialized === 'true' && !obj.serial_number) {
      rowErrors.push({
        columnName: 'serial_number',
        errorCode: 'SERIAL_REQUIRED',
        errorMessage: 'Serialized product requires serial_number',
      });
    }

    // Numeric validation for qty/price/cost fields
    for (const numCol of ['qty', 'unit_price', 'unit_cost', 'quantity', 'amount']) {
      if (obj[numCol] && isNaN(parseFloat(obj[numCol]))) {
        rowErrors.push({
          columnName: numCol,
          errorCode: 'INVALID_NUMBER',
          errorMessage: `Field '${numCol}' must be a number, got '${obj[numCol]}'`,
        });
      }
    }

    // Sum amounts for control totals
    if (obj.unit_price && !isNaN(parseFloat(obj.unit_price))) {
      amountSum += parseFloat(obj.unit_price) * (parseFloat(obj.qty) || 1);
    } else if (obj.unit_cost && !isNaN(parseFloat(obj.unit_cost))) {
      amountSum += parseFloat(obj.unit_cost) * (parseFloat(obj.qty) || 1);
    }

    if (rowErrors.length > 0) {
      result.invalidRows++;
      for (const err of rowErrors) {
        result.errors.push({
          rowNumber,
          columnName: err.columnName,
          errorCode: err.errorCode,
          errorMessage: err.errorMessage,
          rawRow: JSON.stringify(obj),
        });
      }
    } else {
      result.validRows++;
    }
  }

  result.controlTotals.actualRows = result.validRows;
  result.controlTotals.amountSum = amountSum;

  // Update job status
  if (result.invalidRows === 0) {
    await updateJobStatus(jobId, 'ready', result);
  } else if (result.validRows === 0) {
    await updateJobStatus(jobId, 'invalid', result);
  } else {
    // Some valid, some invalid — still "ready" (partial commit possible)
    await updateJobStatus(jobId, 'ready', result);
  }

  return result;
}

/**
 * Commits a validated import job. Actually inserts/updates records.
 * Must run inside runInTenantContext (the route does this).
 */
export async function commitImport(
  jobId: string,
  companyId: string,
  userId: string,
  csvContent: string,
  template: ImportTemplate,
  duplicateStrategy: string,
): Promise<ImportCommitResult> {
  // The content is supplied again at commit time, so it must be proved to be
  // the content that was validated. Without this check validation was
  // decorative: a client could validate one file and commit another, and every
  // row of the second went in unchecked.
  const job = await db.importJob.findFirst({
    where: { id: jobId, companyId },
    select: { fileSha256: true, dryRun: true },
  });
  if (!job) throw new DomainError('RESOURCE_NOT_FOUND', 'Import job not found', {}, 404);
  const suppliedSha256 = createHash('sha256').update(csvContent).digest('hex');
  if (!job.fileSha256 || job.fileSha256 !== suppliedSha256) {
    throw new DomainError('VALIDATION_FAILED',
      'The file being committed is not the file that was validated; upload and validate it again',
      { job_id: jobId }, 409);
  }
  // dry_run=true means validate only. It was recorded but never enforced, so a
  // "dry run" could be committed like any other job.
  if (job.dryRun) {
    throw new DomainError('VALIDATION_FAILED',
      'This file was checked as a dry run, which never imports. Upload it again without dry run to import it.',
      { job_id: jobId, reason: 'dry_run' }, 409);
  }

  // Claim the job before touching any row. The route's status check was a
  // read-then-act with nothing between the read and the import, so two
  // concurrent commits both saw 'ready' and both imported, doubling every row.
  // Only one request can move the job out of 'ready'.
  const claimed = await db.importJob.updateMany({
    where: { id: jobId, companyId, status: 'ready' },
    data: { status: 'importing' },
  });
  if (claimed.count !== 1) {
    throw new DomainError('CONCURRENT_MODIFICATION',
      'This import job is already being committed or is no longer ready', { job_id: jobId }, 409);
  }

  try {
    const result = await commitClaimedJob(jobId, companyId, userId, csvContent, template, duplicateStrategy);
    const status = result.failedRows === 0 ? 'completed' : result.committedRows > 0 ? 'partial' : 'failed';
    await db.importJob.update({
      where: { id: jobId },
      data: { status, committedRows: result.committedRows, completedAt: new Date() },
    });
    // Who imported what: counts and the file's checksum only, never row contents.
    await db.auditLog.create({
      data: {
        companyId,
        userId,
        correlationId: randomUUID(),
        action: 'import.commit',
        entityType: 'import_job',
        entityId: jobId,
        afterValue: JSON.stringify({
          job_type: template.type, status, committed_rows: result.committedRows,
          skipped_rows: result.skippedRows, failed_rows: result.failedRows, file_sha256: suppliedSha256,
        }),
      },
    });
    return result;
  } catch (e) {
    // A job must not stay 'importing' forever when the commit itself broke.
    await db.importJob.update({
      where: { id: jobId },
      data: { status: 'failed', completedAt: new Date(), errorSummary: clip(e instanceof Error ? e.message : 'Unknown error') },
    }).catch(() => undefined);
    throw e;
  }
}

async function commitClaimedJob(
  jobId: string,
  companyId: string,
  userId: string,
  csvContent: string,
  template: ImportTemplate,
  duplicateStrategy: string,
): Promise<ImportCommitResult> {
  const rows = parseCsv(csvContent);
  if (rows.length < 2) return { committedRows: 0, skippedRows: 0, failedRows: 0 };
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new DomainError('VALIDATION_FAILED', `A file may hold at most ${MAX_IMPORT_ROWS} rows`, {}, 400);
  }

  // Rows that failed validation, read once (was one query per row).
  const invalid = new Set((await db.importJobError.findMany({
    where: { importJobId: jobId, companyId, rowNumber: { gt: 0 } },
    select: { rowNumber: true },
  })).map(error => error.rowNumber));

  const lines = dataRows.map((row, i) => ({ rowNumber: i + 2, obj: rowToObject(row, headers) }));
  const ctx = getTenantContext();
  if (!ctx) throw new DomainError('INTERNAL_ERROR', 'Import commit needs a tenant context', {}, 500);
  const progress = new Progress(jobId);
  const out = template.groupKey
    ? await commitDocuments(jobId, companyId, userId, template, duplicateStrategy, lines, invalid, ctx, progress)
    : await commitMasterRows(jobId, companyId, template, duplicateStrategy, lines, invalid, ctx, progress);
  return out;
}

/** Updates the job's committed_rows counter as the commit goes, so its progress can be watched. */
class Progress {
  private sinceUpdate = 0;
  committed = 0;
  constructor(private readonly jobId: string) {}
  async add(rows: number) {
    this.committed += rows;
    this.sinceUpdate += rows;
    if (this.sinceUpdate >= PROGRESS_EVERY_ROWS) {
      this.sinceUpdate = 0;
      await db.importJob.update({ where: { id: this.jobId }, data: { committedRows: this.committed } });
    }
  }
}

type Line = { rowNumber: number; obj: Record<string, string> };
type Ctx = NonNullable<ReturnType<typeof getTenantContext>>;

async function recordError(companyId: string, jobId: string, line: Line, errorCode: string, message: string, columnName?: string) {
  await db.importJobError.create({
    data: {
      companyId,
      importJobId: jobId,
      rowNumber: line.rowNumber,
      columnName: columnName ?? null,
      errorCode,
      errorMessage: clip(message),
      rawRow: clip(JSON.stringify(line.obj)),
    },
  });
}

// ── Master data: one row at a time ──

async function commitMasterRows(
  jobId: string, companyId: string, template: ImportTemplate, duplicateStrategy: string,
  lines: Line[], invalid: Set<number>, ctx: Ctx, progress: Progress,
): Promise<ImportCommitResult> {
  let skipped = 0;
  let failed = 0;
  for (const line of lines) {
    if (invalid.has(line.rowNumber)) { failed++; continue; }
    const { obj } = line;
    try {
      let existingId: string | null = null;
      if (template.duplicateKey) {
        const duplicateValue = obj[template.duplicateKey];
        if (duplicateValue) {
          const matches = await findExisting(companyId, template.entityType, duplicateValue);
          if (matches.length > 0) {
            if (duplicateStrategy === 'skip') { skipped++; continue; }
            if (duplicateStrategy === 'fail') {
              await recordError(companyId, jobId, line, 'DUPLICATE', `Duplicate ${template.duplicateKey}: ${duplicateValue}`, template.duplicateKey);
              failed++;
              continue;
            }
            // 'update': change the existing record in place. With more than
            // one match there is no safe choice of which one to change.
            if (matches.length > 1) {
              await recordError(companyId, jobId, line, 'AMBIGUOUS_MATCH',
                `${matches.length} ${template.entityType}s share ${template.duplicateKey} ${duplicateValue}; make it unique, then import again`, template.duplicateKey);
              failed++;
              continue;
            }
            existingId = matches[0];
          }
        }
      }
      await withTenant(ctx, tx => (existingId
        ? updateEntity(tx, companyId, template.entityType, existingId, obj)
        : insertEntity(tx, companyId, template.entityType, obj)));
      await progress.add(1);
    } catch (e) {
      await recordError(companyId, jobId, line, 'INSERT_FAILED', e instanceof Error ? e.message : 'Unknown error');
      failed++;
    }
  }
  return { committedRows: progress.committed, skippedRows: skipped, failedRows: failed };
}

/** Ids of the records the duplicate key matches (customer phone and supplier name are not unique). */
async function findExisting(companyId: string, entityType: string, value: string): Promise<string[]> {
  const take = 2;
  const select = { id: true } as const;
  switch (entityType) {
    case 'product':
      return (await db.product.findMany({ where: { companyId, code: value }, select, take })).map(r => r.id);
    case 'customer':
      return (await db.customer.findMany({ where: { companyId, phone: value }, select, take })).map(r => r.id);
    case 'supplier':
      return (await db.supplier.findMany({ where: { companyId, name: value }, select, take })).map(r => r.id);
    case 'category':
      return (await db.category.findMany({ where: { companyId, code: value }, select, take })).map(r => r.id);
    case 'unit':
      return (await db.unit.findMany({ where: { companyId, code: value }, select, take })).map(r => r.id);
    case 'brand':
      return (await db.brand.findMany({ where: { companyId, name: value }, select, take })).map(r => r.id);
    default:
      return [];
  }
}

const has = (obj: Record<string, string>, key: string) => obj[key] !== undefined && obj[key].trim() !== '';
const bool = (value: string) => value.trim().toLowerCase() === 'true';

function parseNumber(obj: Record<string, string>, key: string): number {
  const value = Number(obj[key]);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number, got '${obj[key]}'`);
  return value;
}

function parseDate(obj: Record<string, string>, key: string): Date {
  const value = obj[key].trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new Error(`${key} must be a date like 2026-11-25, got '${value}'`);
  return date;
}

async function categoryByCode(tx: TransactionClient, companyId: string, code: string) {
  const category = await tx.category.findFirst({ where: { companyId, code, deletedAt: null } });
  if (!category) throw new Error(`Category not found: ${code}. Add it under Products > Categories (or import categories first).`);
  return category;
}

async function unitByCode(tx: TransactionClient, companyId: string, code: string) {
  const unit = await tx.unit.findFirst({ where: { companyId, code } });
  if (!unit) throw new Error(`Unit not found: ${code}. Add it under Products > Units (or import units first).`);
  return unit;
}

async function brandByName(tx: TransactionClient, companyId: string, name: string) {
  const brand = await tx.brand.findFirst({ where: { companyId, name, deletedAt: null } });
  if (!brand) throw new Error(`Brand not found: ${name}. Add it under Products > Brands (or import brands first).`);
  return brand;
}

async function customerGroupByName(tx: TransactionClient, companyId: string, name: string) {
  const group = await tx.customerGroup.findFirst({ where: { companyId, name } });
  if (!group) throw new Error(`Customer group not found: ${name}. Add the group under Customers first.`);
  return group;
}

/** Adds the file's barcode to the product, unless it already has it. A barcode on another product fails the row. */
async function attachBarcode(tx: TransactionClient, companyId: string, productId: string, code: string) {
  const existing = await tx.productBarcode.findUnique({ where: { companyId_code: { companyId, code } } });
  if (existing) {
    if (existing.productId !== productId) throw new Error(`Barcode ${code} already belongs to another product`);
    return;
  }
  const others = await tx.productBarcode.count({ where: { companyId, productId } });
  await tx.productBarcode.create({ data: { companyId, productId, code, symbology: 'CODE128', isPrimary: others === 0 } });
}

async function insertEntity(tx: TransactionClient, companyId: string, entityType: string, obj: Record<string, string>): Promise<void> {
  switch (entityType) {
    case 'product': {
      // Need category + unit — look up by code
      const category = await categoryByCode(tx, companyId, obj.category);
      const unit = await unitByCode(tx, companyId, obj.unit);
      const product = await tx.product.create({
        data: {
          companyId,
          categoryId: category.id,
          // Unchanged from before: an unknown brand leaves the product without one.
          brandId: obj.brand ? (await tx.brand.findFirst({ where: { companyId, name: obj.brand } }))?.id : null,
          unitId: unit.id,
          name: obj.name,
          code: obj.code,
          productType: obj.product_type || 'standard',
          isSerialized: obj.is_serialized === 'true',
          trackBatches: obj.track_batches === 'true',
          warrantyPeriodMonths: obj.warranty_months ? parseInt(obj.warranty_months) : null,
          referenceCost: obj.reference_cost ? parseFloat(obj.reference_cost) : 0,
          defaultPrice: obj.default_price ? parseFloat(obj.default_price) : 0,
          alertQuantity: obj.alert_quantity ? parseFloat(obj.alert_quantity) : 0,
          description: obj.description || null,
          isActive: obj.is_active !== 'false',
        },
      });
      if (has(obj, 'barcode')) await attachBarcode(tx, companyId, product.id, obj.barcode.trim());
      return;
    }

    case 'customer':
      await tx.customer.create({
        data: {
          companyId,
          name: obj.name,
          phone: obj.phone || null,
          email: obj.email || null,
          address: obj.address || null,
          taxIdentifier: obj.tax_identifier || null,
          creditLimit: obj.credit_limit ? parseFloat(obj.credit_limit) : 0,
          customerGroupId: has(obj, 'customer_group') ? (await customerGroupByName(tx, companyId, obj.customer_group.trim())).id : null,
          isActive: obj.is_active !== 'false',
        },
      });
      return;

    case 'supplier':
      await tx.supplier.create({
        data: {
          companyId,
          name: obj.name,
          phone: obj.phone || null,
          email: obj.email || null,
          address: obj.address || null,
          taxIdentifier: obj.tax_identifier || null,
          paymentTermsDays: obj.payment_terms_days ? parseInt(obj.payment_terms_days) : 0,
          currencyCode: obj.currency_code || 'BDT',
          isActive: obj.is_active !== 'false',
        },
      });
      return;

    case 'category': {
      const parent = has(obj, 'parent_code') ? await categoryByCode(tx, companyId, obj.parent_code.trim()) : null;
      await tx.category.create({
        data: { companyId, code: obj.code, name: obj.name, parentId: parent?.id ?? null, parentScope: parent?.id ?? '', isActive: obj.is_active !== 'false' },
      });
      return;
    }

    case 'unit':
      await tx.unit.create({ data: { companyId, code: obj.code, name: obj.name, allowFractional: obj.allow_fractional === 'true' } });
      return;

    case 'brand':
      await tx.brand.create({ data: { companyId, name: obj.name, isActive: obj.is_active !== 'false' } });
      return;

    default:
      throw new Error(`Rows of type ${entityType} are imported as documents, not one by one`);
  }
}

/**
 * duplicate_strategy=update: changes the record the key matched. Only the
 * columns the file fills in are changed; an empty cell keeps the stored value.
 * The key itself, and a product's type, serial and batch tracking (which stock
 * already depends on), are never changed by an import.
 */
async function updateEntity(tx: TransactionClient, companyId: string, entityType: string, id: string, obj: Record<string, string>): Promise<void> {
  switch (entityType) {
    case 'product': {
      const current = await tx.product.findFirstOrThrow({ where: { id, companyId } });
      for (const [column, stored] of [['product_type', current.productType], ['is_serialized', String(current.isSerialized)], ['track_batches', String(current.trackBatches)]] as const) {
        if (has(obj, column) && obj[column].trim() !== stored) {
          throw new Error(`${column} cannot be changed by an import (stored: ${stored}). Change it on the product page.`);
        }
      }
      const data: Prisma.ProductUncheckedUpdateInput = {};
      if (has(obj, 'name')) data.name = obj.name;
      if (has(obj, 'category')) data.categoryId = (await categoryByCode(tx, companyId, obj.category)).id;
      if (has(obj, 'unit')) data.unitId = (await unitByCode(tx, companyId, obj.unit)).id;
      if (has(obj, 'brand')) data.brandId = (await brandByName(tx, companyId, obj.brand)).id;
      if (has(obj, 'warranty_months')) data.warrantyPeriodMonths = parseInt(obj.warranty_months);
      if (has(obj, 'reference_cost')) data.referenceCost = parseNumber(obj, 'reference_cost');
      if (has(obj, 'default_price')) data.defaultPrice = parseNumber(obj, 'default_price');
      if (has(obj, 'alert_quantity')) data.alertQuantity = parseNumber(obj, 'alert_quantity');
      if (has(obj, 'description')) data.description = obj.description;
      if (has(obj, 'is_active')) data.isActive = bool(obj.is_active);
      await tx.product.update({ where: { id }, data });
      if (has(obj, 'barcode')) await attachBarcode(tx, companyId, id, obj.barcode.trim());
      return;
    }

    case 'customer': {
      const data: Prisma.CustomerUncheckedUpdateInput = {};
      if (has(obj, 'name')) data.name = obj.name;
      if (has(obj, 'email')) data.email = obj.email;
      if (has(obj, 'address')) data.address = obj.address;
      if (has(obj, 'tax_identifier')) data.taxIdentifier = obj.tax_identifier;
      if (has(obj, 'credit_limit')) data.creditLimit = parseNumber(obj, 'credit_limit');
      if (has(obj, 'customer_group')) data.customerGroupId = (await customerGroupByName(tx, companyId, obj.customer_group.trim())).id;
      if (has(obj, 'is_active')) data.isActive = bool(obj.is_active);
      await tx.customer.update({ where: { id }, data });
      return;
    }

    case 'supplier': {
      const data: Prisma.SupplierUncheckedUpdateInput = {};
      if (has(obj, 'phone')) data.phone = obj.phone;
      if (has(obj, 'email')) data.email = obj.email;
      if (has(obj, 'address')) data.address = obj.address;
      if (has(obj, 'tax_identifier')) data.taxIdentifier = obj.tax_identifier;
      if (has(obj, 'payment_terms_days')) data.paymentTermsDays = parseInt(obj.payment_terms_days);
      if (has(obj, 'currency_code')) data.currencyCode = obj.currency_code;
      if (has(obj, 'is_active')) data.isActive = bool(obj.is_active);
      await tx.supplier.update({ where: { id }, data });
      return;
    }

    case 'category': {
      const data: Prisma.CategoryUncheckedUpdateInput = {};
      if (has(obj, 'name')) data.name = obj.name;
      if (has(obj, 'parent_code')) {
        const parent = await categoryByCode(tx, companyId, obj.parent_code.trim());
        if (parent.id === id) throw new Error('A category cannot be its own parent');
        data.parentId = parent.id;
        data.parentScope = parent.id;
      }
      if (has(obj, 'is_active')) data.isActive = bool(obj.is_active);
      await tx.category.update({ where: { id }, data });
      return;
    }

    case 'unit': {
      const data: Prisma.UnitUncheckedUpdateInput = {};
      if (has(obj, 'name')) data.name = obj.name;
      if (has(obj, 'allow_fractional')) data.allowFractional = bool(obj.allow_fractional);
      await tx.unit.update({ where: { id }, data });
      return;
    }

    case 'brand': {
      if (has(obj, 'is_active')) await tx.brand.update({ where: { id }, data: { isActive: bool(obj.is_active) } });
      return;
    }

    default:
      throw new Error(`Rows of type ${entityType} cannot be updated by an import`);
  }
}

// ── Documents: one group of rows = one sale / purchase / transfer / opening stock ──

type Created = { entityType: string; entityId: string; referenceNo: string | null };

async function commitDocuments(
  jobId: string, companyId: string, userId: string, template: ImportTemplate, duplicateStrategy: string,
  lines: Line[], invalid: Set<number>, ctx: Ctx, progress: Progress,
): Promise<ImportCommitResult> {
  // Group in file order. Rows with no group key each make their own document.
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const value = line.obj[template.groupKey!]?.trim();
    const key = value ? value : `${jobId}:row:${line.rowNumber}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  let skipped = 0;
  let failed = 0;
  const documents: NonNullable<ImportCommitResult['documents']> = [];
  for (const [sourceKey, group] of groups) {
    // A document is imported whole or not at all.
    const bad = group.filter(line => invalid.has(line.rowNumber));
    if (bad.length) {
      for (const line of group.filter(l => !invalid.has(l.rowNumber))) {
        await recordError(companyId, jobId, line, 'GROUP_INVALID',
          `Not imported: row ${bad[0].rowNumber} of the same ${template.groupKey} ${sourceKey} has errors. Fix it and import again.`);
      }
      failed += group.length;
      continue;
    }

    const already = await db.importJobEntity.findUnique({
      where: { companyId_jobType_sourceKey: { companyId, jobType: template.type, sourceKey } },
    });
    if (already) {
      if (duplicateStrategy === 'fail') {
        await recordError(companyId, jobId, group[0], 'DUPLICATE',
          `Duplicate ${template.groupKey}: ${sourceKey} was already imported as ${already.referenceNo ?? already.entityId}`, template.groupKey);
        failed += group.length;
      } else {
        skipped += group.length;
      }
      continue;
    }

    try {
      const created = await withTenant(ctx, async tx => {
        const correlationId = randomUUID();
        const doc = await createDocument(tx, companyId, userId, template.type, group, correlationId);
        // Unique on (company, job type, source key): a retried or concurrent
        // commit of the same group rolls back here instead of writing twice.
        await tx.importJobEntity.create({
          data: { companyId, importJobId: jobId, jobType: template.type, sourceKey, ...doc },
        });
        return doc;
      });
      documents.push({ sourceKey, ...created });
      await progress.add(group.length);
    } catch (e) {
      const duplicate = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
        && String(e.meta?.target ?? '').includes('source_key');
      if (duplicate && duplicateStrategy !== 'fail') { skipped += group.length; continue; }
      const message = duplicate ? `Duplicate ${template.groupKey}: ${sourceKey} was imported by another commit` : e instanceof Error ? e.message : 'Unknown error';
      await recordError(companyId, jobId, group[0], duplicate ? 'DUPLICATE' : 'INSERT_FAILED', message);
      for (const line of group.slice(1)) {
        await recordError(companyId, jobId, line, 'INSERT_FAILED', `Not imported: ${template.groupKey} ${sourceKey} failed at row ${group[0].rowNumber}`);
      }
      failed += group.length;
    }
  }
  return { committedRows: progress.committed, skippedRows: skipped, failedRows: failed, documents };
}

async function createDocument(tx: TransactionClient, companyId: string, userId: string, jobType: string, group: Line[], correlationId: string): Promise<Created> {
  switch (jobType) {
    case 'sale_draft': return importSale(tx, companyId, userId, group, correlationId);
    case 'purchase': return importPurchase(tx, companyId, userId, group, correlationId);
    case 'transfer_draft': return importTransfer(tx, companyId, userId, group, correlationId);
    case 'opening_stock': return importOpeningStock(tx, companyId, userId, group, correlationId);
    default: throw new Error(`Unknown document import: ${jobType}`);
  }
}

async function branchByCode(tx: TransactionClient, companyId: string, code: string) {
  const branch = await tx.branch.findFirst({ where: { companyId, code } });
  if (!branch) throw new Error(`Branch not found: ${code}. Check the branch code under Settings > Branches.`);
  return branch;
}

/** The warehouse a branch sells and buys from: its first active retail warehouse, else its first active one. */
async function branchWarehouse(tx: TransactionClient, companyId: string, branch: { id: string; code: string }) {
  const warehouses = await tx.warehouse.findMany({
    where: { companyId, branchId: branch.id, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, warehouseType: true },
  });
  const warehouse = warehouses.find(w => w.warehouseType === 'retail') ?? warehouses[0];
  if (!warehouse) throw new Error(`Branch ${branch.code} has no active warehouse. Add one under Inventory > Warehouses.`);
  return warehouse;
}

async function warehouseByCode(tx: TransactionClient, companyId: string, code: string) {
  const warehouse = await tx.warehouse.findFirst({ where: { companyId, code } });
  if (!warehouse) throw new Error(`Warehouse not found: ${code}. Check the code under Inventory > Warehouses.`);
  return warehouse;
}

async function productsByCode(tx: TransactionClient, companyId: string, group: Line[]) {
  const codes = [...new Set(group.map(line => line.obj.product_code.trim()))];
  const products = await tx.product.findMany({ where: { companyId, code: { in: codes }, deletedAt: null } });
  const byCode = new Map(products.map(product => [product.code, product]));
  return (line: Line) => {
    const product = byCode.get(line.obj.product_code.trim());
    if (!product) throw new Error(`Row ${line.rowNumber}: product not found: ${line.obj.product_code}. Import or add it first.`);
    if (product.isSerialized && !has(line.obj, 'serial_number')) {
      throw new Error(`Row ${line.rowNumber}: ${product.code} is serialized; give one serial_number per row (qty 1).`);
    }
    return product;
  };
}

function serialsOf(line: Line, isSerialized: boolean, qty: number): string[] | undefined {
  if (!isSerialized) return undefined;
  if (qty !== 1) throw new Error(`Row ${line.rowNumber}: serialized rows must have qty 1, one serial each`);
  return [line.obj.serial_number.trim()];
}

/** The account a sale payment of this method is paid into: the branch's own, else a company-wide one. */
async function paymentAccount(tx: TransactionClient, companyId: string, branch: { id: string; code: string }, method: string, currencyCode: string) {
  const accountType = method === 'cash' ? 'cash' : ['bkash', 'nagad', 'rocket'].includes(method) ? 'mobile_wallet' : 'bank';
  const accounts = await tx.financialAccount.findMany({
    where: { companyId, accountType, currencyCode, isActive: true, OR: [{ branchId: branch.id }, { branchId: null }] },
    orderBy: { name: 'asc' },
    select: { id: true, branchId: true },
  });
  const account = accounts.find(a => a.branchId === branch.id) ?? accounts[0];
  if (!account) throw new Error(`No active ${accountType.replace('_', ' ')} account for branch ${branch.code}. Add one under Financial accounts.`);
  return account.id;
}

async function importSale(tx: TransactionClient, companyId: string, userId: string, group: Line[], correlationId: string): Promise<Created> {
  const first = group[0].obj;
  for (const line of group) {
    if (line.obj.branch_code.trim() !== first.branch_code.trim()) throw new Error(`Row ${line.rowNumber}: all lines of sale ${first.reference_no} must have the same branch_code`);
  }
  const branch = await branchByCode(tx, companyId, first.branch_code.trim());
  const warehouse = await branchWarehouse(tx, companyId, branch);
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { baseCurrencyCode: true } });

  const phone = group.map(line => line.obj.customer_phone?.trim()).find(Boolean);
  let customerId: string | undefined;
  if (phone) {
    const customers = await tx.customer.findMany({ where: { companyId, phone, deletedAt: null }, select: { id: true }, take: 2 });
    if (customers.length === 0) throw new Error(`Customer not found with phone ${phone}. Import or add the customer first.`);
    if (customers.length > 1) throw new Error(`More than one customer has phone ${phone}; make it unique first.`);
    customerId = customers[0].id;
  }

  const product = await productsByCode(tx, companyId, group);
  const items = group.map(line => {
    const p = product(line);
    const qty = parseNumber(line.obj, 'qty');
    return {
      productId: p.id, qty, unitPrice: parseNumber(line.obj, 'unit_price'),
      discountAmount: has(line.obj, 'discount_amount') ? parseNumber(line.obj, 'discount_amount') : 0,
      serials: serialsOf(line, p.isSerialized, qty),
    };
  });

  // Payments: the amounts of each method across the sale's rows.
  const byMethod = new Map<string, number>();
  for (const line of group) {
    if (!has(line.obj, 'payment_amount')) continue;
    const method = (line.obj.payment_method?.trim() || 'cash').toLowerCase();
    if (!SALE_IMPORT_METHODS.includes(method)) throw new Error(`Row ${line.rowNumber}: payment_method must be one of ${SALE_IMPORT_METHODS.join(', ')}`);
    byMethod.set(method, (byMethod.get(method) ?? 0) + parseNumber(line.obj, 'payment_amount'));
  }
  const payments: Array<{ paymentMethod: string; amount: number; financialAccountId: string }> = [];
  for (const [paymentMethod, amount] of byMethod) {
    if (amount <= 0) continue;
    payments.push({ paymentMethod, amount, financialAccountId: await paymentAccount(tx, companyId, branch, paymentMethod, company.baseCurrencyCode) });
  }

  const businessDateLine = group.find(line => has(line.obj, 'business_date'));
  const result = await postSale(tx, {
    companyId, branchId: branch.id, warehouseId: warehouse.id, cashierId: userId, customerId,
    currencyCode: company.baseCurrencyCode, exchangeRate: 1,
    businessDate: businessDateLine ? parseDate(businessDateLine.obj, 'business_date') : new Date(),
    saleNote: `Imported from CSV (file reference ${first.reference_no})`,
    items, payments,
  }, correlationId);
  return { entityType: 'sale', entityId: result.saleId, referenceNo: result.referenceNo };
}

async function importPurchase(tx: TransactionClient, companyId: string, userId: string, group: Line[], correlationId: string): Promise<Created> {
  const first = group[0].obj;
  for (const line of group) {
    if (line.obj.supplier_name.trim() !== first.supplier_name.trim() || line.obj.branch_code.trim() !== first.branch_code.trim()) {
      throw new Error(`Row ${line.rowNumber}: all lines of purchase ${first.reference_no || ''} must have the same supplier_name and branch_code`);
    }
  }
  const suppliers = await tx.supplier.findMany({ where: { companyId, name: first.supplier_name.trim(), deletedAt: null }, select: { id: true }, take: 2 });
  if (suppliers.length === 0) throw new Error(`Supplier not found: ${first.supplier_name}. Import or add the supplier first.`);
  if (suppliers.length > 1) throw new Error(`More than one supplier is named ${first.supplier_name}; make the name unique first.`);
  const branch = await branchByCode(tx, companyId, first.branch_code.trim());
  const warehouse = await branchWarehouse(tx, companyId, branch);
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { baseCurrencyCode: true } });

  const product = await productsByCode(tx, companyId, group);
  const items: Array<{ productId: string; qtyOrdered: number; unitCost: number; discountAmount: number; taxAmount: number }> = [];
  for (const line of group) {
    const p = product(line);
    const qtyOrdered = parseNumber(line.obj, 'qty');
    const unitCost = parseNumber(line.obj, 'unit_cost');
    if (qtyOrdered <= 0) throw new Error(`Row ${line.rowNumber}: qty must be more than 0`);
    if (unitCost < 0) throw new Error(`Row ${line.rowNumber}: unit_cost cannot be negative`);
    if (has(line.obj, 'tax_code')) {
      const taxCode = await tx.taxCode.findFirst({ where: { companyId, code: line.obj.tax_code.trim() }, select: { id: true } });
      if (!taxCode) throw new Error(`Row ${line.rowNumber}: tax code not found: ${line.obj.tax_code}. Check it under Tax codes.`);
    }
    // Tax on a purchase is worked out on its supplier invoice; the order line carries none.
    items.push({ productId: p.id, qtyOrdered, unitCost, discountAmount: 0, taxAmount: 0 });
  }
  const expectedLine = group.find(line => has(line.obj, 'expected_delivery_date'));
  const purchase = await createPurchase(tx, {
    companyId, branchId: branch.id, warehouseId: warehouse.id, supplierId: suppliers[0].id,
    currencyCode: company.baseCurrencyCode, exchangeRate: 1, orderDate: new Date(),
    expectedDate: expectedLine ? parseDate(expectedLine.obj, 'expected_delivery_date') : undefined,
    notes: first.reference_no ? `Imported from CSV (file reference ${first.reference_no})` : 'Imported from CSV',
    createdBy: userId, orderStatus: 'draft', items,
  }, correlationId);
  return { entityType: 'purchase', entityId: purchase.id, referenceNo: purchase.referenceNo };
}

async function importTransfer(tx: TransactionClient, companyId: string, userId: string, group: Line[], correlationId: string): Promise<Created> {
  const first = group[0].obj;
  for (const line of group) {
    if (line.obj.from_warehouse_code.trim() !== first.from_warehouse_code.trim() || line.obj.to_warehouse_code.trim() !== first.to_warehouse_code.trim()) {
      throw new Error(`Row ${line.rowNumber}: all lines of one transfer must have the same from_warehouse_code and to_warehouse_code`);
    }
  }
  const from = await warehouseByCode(tx, companyId, first.from_warehouse_code.trim());
  const to = await warehouseByCode(tx, companyId, first.to_warehouse_code.trim());
  const product = await productsByCode(tx, companyId, group);
  // A transfer takes one line per product: rows of the same product are added up.
  const byProduct = new Map<string, { productId: string; qtyRequested: number; serialNumbers?: string[] }>();
  for (const line of group) {
    const p = product(line);
    const qty = parseNumber(line.obj, 'qty');
    const serials = serialsOf(line, p.isSerialized, qty);
    const entry = byProduct.get(p.id) ?? { productId: p.id, qtyRequested: 0, serialNumbers: p.isSerialized ? [] : undefined };
    entry.qtyRequested += qty;
    if (serials) entry.serialNumbers!.push(...serials);
    byProduct.set(p.id, entry);
  }
  // Created as a pending transfer, exactly as the API does; it is dispatched
  // and received from the Transfers page, which moves the stock.
  const transfer = await createTransfer(tx, {
    companyId, fromWarehouseId: from.id, toWarehouseId: to.id, requestedBy: userId,
    notes: first.reference_no ? `Imported from CSV (file reference ${first.reference_no})` : 'Imported from CSV',
    items: [...byProduct.values()],
  }, correlationId);
  return { entityType: 'transfer', entityId: transfer.transferId, referenceNo: transfer.referenceNo };
}

async function importOpeningStock(tx: TransactionClient, companyId: string, userId: string, group: Line[], correlationId: string): Promise<Created> {
  const warehouse = await warehouseByCode(tx, companyId, group[0].obj.warehouse_code.trim());
  const product = await productsByCode(tx, companyId, group);
  const items = group.map(line => {
    const p = product(line);
    const quantity = parseNumber(line.obj, 'qty');
    if (p.trackBatches && !has(line.obj, 'batch_number')) throw new Error(`Row ${line.rowNumber}: ${p.code} tracks batches; give its batch_number`);
    return {
      productId: p.id, quantity, unitCost: parseNumber(line.obj, 'unit_cost'),
      batchNo: has(line.obj, 'batch_number') ? line.obj.batch_number.trim() : undefined,
      expiryDate: has(line.obj, 'expiry_date') ? parseDate(line.obj, 'expiry_date') : undefined,
      serials: serialsOf(line, p.isSerialized, quantity),
    };
  });
  const referenceNo = `IMPORT-${warehouse.code}`;
  const result = await postOpeningStock(tx, {
    companyId, warehouseId: warehouse.id, postedBy: userId, businessDate: new Date(), referenceNo,
    notes: 'Imported from CSV', items,
  }, correlationId);
  return { entityType: 'opening_stock', entityId: result.event_id, referenceNo };
}

async function updateJobStatus(jobId: string, status: string, result: ImportValidationResult): Promise<void> {
  await db.importJob.update({
    where: { id: jobId },
    data: {
      status,
      totalRows: result.totalRows,
      validRows: result.validRows,
      invalidRows: result.invalidRows,
      controlTotals: JSON.stringify(result.controlTotals),
    },
  });

  // Record errors
  if (result.errors.length > 0) {
    // Get companyId from job
    const job = await db.importJob.findUnique({ where: { id: jobId }, select: { companyId: true } });
    if (job) {
      await db.importJobError.createMany({
        data: result.errors.map(err => ({
          companyId: job.companyId,
          importJobId: jobId,
          rowNumber: err.rowNumber,
          columnName: err.columnName ?? null,
          errorCode: err.errorCode,
          errorMessage: clip(err.errorMessage),
          rawRow: err.rawRow ? clip(err.rawRow) : null,
        })),
      });
    }
  }
}
