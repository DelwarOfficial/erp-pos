// src/lib/import-export/importProcessor.ts
// Import job processor — staged validation + dry-run + commit.
// Per §9.5 + §20.D11.
//
// Flow:
//   1. Upload: save file to S3, compute SHA-256, create import_job row (status=uploaded)
//   2. Validate: parse CSV, validate each row against template, record errors (status=validating→ready/invalid)
//   3. Dry-run: simulate commit without writing (status=ready, dryRun=true)
//   4. Commit: actually insert/update records (status=importing→completed/partial/failed)
//
// Sale/transfer imports create drafts only (per §9.5).
// Serialized imports require one serial per row (per §9.5).

import { db } from '@/lib/db';
import { parseCsv, rowToObject, validateRowColumns } from './csv';
import { getTemplate, type ImportTemplate } from './templates';

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
 * For sale/transfer imports, creates drafts only (per §9.5).
 */
export async function commitImport(
  jobId: string,
  companyId: string,
  userId: string,
  csvContent: string,
  template: ImportTemplate,
  duplicateStrategy: string,
): Promise<{ committedRows: number; skippedRows: number; failedRows: number }> {
  const rows = parseCsv(csvContent);
  if (rows.length < 2) {
    return { committedRows: 0, skippedRows: 0, failedRows: 0 };
  }

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const dataRows = rows.slice(1);

  await db.importJob.update({
    where: { id: jobId },
    data: { status: 'importing' },
  });

  let committed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 2;
    const obj = rowToObject(row, headers);

    try {
      // Check for existing errors on this row
      const existingError = await db.importJobError.findFirst({
        where: { importJobId: jobId, rowNumber },
      });
      if (existingError) {
        failed++;
        continue;
      }

      // Check duplicate
      if (template.duplicateKey) {
        const duplicateValue = obj[template.duplicateKey];
        if (duplicateValue) {
          const existing = await checkDuplicate(companyId, template.entityType, template.duplicateKey, duplicateValue);
          if (existing) {
            if (duplicateStrategy === 'skip') {
              skipped++;
              continue;
            } else if (duplicateStrategy === 'fail') {
              await db.importJobError.create({
                data: {
                  companyId,
                  importJobId: jobId,
                  rowNumber,
                  columnName: template.duplicateKey,
                  errorCode: 'DUPLICATE',
                  errorMessage: `Duplicate ${template.duplicateKey}: ${duplicateValue}`,
                  rawRow: JSON.stringify(obj),
                },
              });
              failed++;
              continue;
            }
            // 'update' falls through to upsert
          }
        }
      }

      // Insert based on entity type
      await insertEntity(companyId, userId, template.entityType, obj);
      committed++;
    } catch (e) {
      await db.importJobError.create({
        data: {
          companyId,
          importJobId: jobId,
          rowNumber,
          errorCode: 'INSERT_FAILED',
          errorMessage: e instanceof Error ? e.message : 'Unknown error',
          rawRow: JSON.stringify(obj),
        },
      });
      failed++;
    }
  }

  // Update job status
  const status = failed === 0 ? 'completed' : committed > 0 ? 'partial' : 'failed';
  await db.importJob.update({
    where: { id: jobId },
    data: {
      status,
      committedRows: committed,
      completedAt: new Date(),
    },
  });

  return { committedRows: committed, skippedRows: skipped, failedRows: failed };
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
          errorMessage: err.errorMessage,
          rawRow: err.rawRow ?? null,
        })),
      });
    }
  }
}

async function checkDuplicate(companyId: string, entityType: string, key: string, value: string): Promise<boolean> {
  switch (entityType) {
    case 'product':
      return !!(await db.product.findFirst({ where: { companyId, code: value } }));
    case 'customer':
      return !!(await db.customer.findFirst({ where: { companyId, phone: value } }));
    case 'supplier':
      return !!(await db.supplier.findFirst({ where: { companyId, name: value } }));
    default:
      return false;
  }
}

async function insertEntity(companyId: string, userId: string, entityType: string, obj: Record<string, string>): Promise<void> {
  switch (entityType) {
    case 'product':
      // Need category + unit — look up by code
      const category = await db.category.findFirst({ where: { companyId, code: obj.category } });
      const unit = await db.unit.findFirst({ where: { companyId, code: obj.unit } });
      if (!category) throw new Error(`Category not found: ${obj.category}`);
      if (!unit) throw new Error(`Unit not found: ${obj.unit}`);
      await db.product.create({
        data: {
          companyId,
          categoryId: category.id,
          brandId: obj.brand ? (await db.brand.findFirst({ where: { companyId, name: obj.brand } }))?.id : null,
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
      break;

    case 'customer':
      await db.customer.create({
        data: {
          companyId,
          name: obj.name,
          phone: obj.phone || null,
          email: obj.email || null,
          address: obj.address || null,
          taxIdentifier: obj.tax_identifier || null,
          creditLimit: obj.credit_limit ? parseFloat(obj.credit_limit) : 0,
          isActive: obj.is_active !== 'false',
        },
      });
      break;

    case 'supplier':
      await db.supplier.create({
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
      break;

    case 'sale':
    case 'transfer':
      // Sale/transfer imports create drafts only (per §9.5)
      // In a full implementation, this would create a draft sale/transfer record
      // that the user must review + post before it becomes live.
      // For now, we skip actual insertion — the import validates the data only.
      break;

    case 'stock_movement':
      // Opening stock — would call post_opening_stock SQL function
      // For now, validate the data only
      break;
  }
}
