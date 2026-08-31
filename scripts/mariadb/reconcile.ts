import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { verifiedDryRunUrl, verifiedSourceCopy, safeError } from './safety';

const sourceInfo = await verifiedSourceCopy();
const targetInfo = verifiedDryRunUrl();
const source = new SQL({ adapter: 'sqlite', filename: sourceInfo.path, readonly: true, create: false, safeIntegers: true });
const target = new SQL(targetInfo.url, { bigint: true, max: 2 });

const report = {
  source_sha256: sourceInfo.sha256,
  target_database: targetInfo.database,
  row_count_mismatches: 0,
  uuid_changes: 0,
  orphan_fks: 0,
  cross_tenant_leakage: 0,
  duplicate_document_numbers: 0,
  posted_debit: '0',
  posted_credit: '0',
  posted_balance_variance: '0',
  unexplained_financial_variance: 0,
  unexplained_inventory_variance: 0,
  failures: [] as Array<{ check: string; code?: string; message: string }>,
};

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const table = (model: any) => model.dbName ?? model.name;
const column = (model: any, fieldName: string) => {
  const field = model.fields.find((candidate: any) => candidate.name === fieldName);
  if (!field) throw new Error(`MISSING_FIELD:${model.name}.${fieldName}`);
  return field.dbName ?? field.name;
};

async function values(sql: SQL, dbTable: string, dbColumn: string): Promise<string[]> {
  const rows = await sql`SELECT ${sql(dbColumn)} AS value FROM ${sql(dbTable)} ORDER BY ${sql(dbColumn)}`;
  return rows.map((row: any) => String(row.value ?? ''));
}

function hash(valuesToHash: string[]): string {
  const digest = createHash('sha256');
  for (const value of valuesToHash) digest.update(value).update('\0');
  return digest.digest('hex');
}

async function decimalSum(sql: SQL, dbTable: string, dbColumn: string): Promise<Prisma.Decimal> {
  const rows = await sql`SELECT ${sql(dbColumn)} AS value FROM ${sql(dbTable)} WHERE ${sql(dbColumn)} IS NOT NULL`;
  return rows.reduce((sum: Prisma.Decimal, row: any) => sum.add(new Prisma.Decimal(String(row.value))), new Prisma.Decimal(0));
}

try {
  for (const model of Prisma.dmmf.datamodel.models) {
    const dbTable = table(model);
    const sourceCount = await source`SELECT COUNT(*) AS count FROM ${source(dbTable)}`;
    const targetCount = await target`SELECT COUNT(*) AS count FROM ${target(dbTable)}`;
    if (Number(sourceCount[0].count) !== Number(targetCount[0].count)) report.row_count_mismatches++;

    const idField = model.fields.find((field) => field.name === 'id' && field.type === 'String');
    if (idField) {
      const dbId = idField.dbName ?? idField.name;
      const [sourceIds, targetIds] = await Promise.all([values(source, dbTable, dbId), values(target, dbTable, dbId)]);
      if (hash(sourceIds) !== hash(targetIds)) {
        const sourceSet = new Set(sourceIds);
        const targetSet = new Set(targetIds);
        report.uuid_changes += sourceIds.filter((id) => !targetSet.has(id)).length;
        report.uuid_changes += targetIds.filter((id) => !sourceSet.has(id)).length;
      }
    }
  }

  const foreignKeys = await target`
    SELECT kcu.table_name, kcu.column_name, kcu.referenced_table_name, kcu.referenced_column_name
    FROM information_schema.key_column_usage kcu
    WHERE kcu.table_schema = ${targetInfo.database}
      AND kcu.referenced_table_name IS NOT NULL
      AND kcu.constraint_name NOT LIKE 'fk_tenant_%'
  `;
  for (const fk of foreignKeys as any[]) {
    const rows = await target`
      SELECT COUNT(*) AS count
      FROM ${target(fk.table_name)} AS c
      LEFT JOIN ${target(fk.referenced_table_name)} AS p
        ON ${target(`c.${fk.column_name}`)} = ${target(`p.${fk.referenced_column_name}`)}
      WHERE ${target(`c.${fk.column_name}`)} IS NOT NULL
        AND ${target(`p.${fk.referenced_column_name}`)} IS NULL
    `;
    report.orphan_fks += Number(rows[0].count);
  }

  const directTenant = new Set(
    Prisma.dmmf.datamodel.models
      .filter((model) => model.fields.some((field) => field.name === 'companyId'))
      .map((model) => model.name),
  );
  for (const child of Prisma.dmmf.datamodel.models) {
    if (!directTenant.has(child.name)) continue;
    for (const relation of child.fields.filter((field: any) => field.kind === 'object' && field.relationFromFields?.length === 1)) {
      const parent = models.get(relation.type);
      if (!parent || !directTenant.has(parent.name) || relation.relationToFields?.[0] !== 'id') continue;
      const childTable = table(child);
      const parentTable = table(parent);
      const fkColumn = column(child, relation.relationFromFields![0]);
      const rows = await target`
        SELECT COUNT(*) AS count FROM ${target(childTable)} AS c
        JOIN ${target(parentTable)} AS p ON ${target(`c.${fkColumn}`)} = ${target('p.id')}
        WHERE ${target('c.company_id')} <> ${target('p.company_id')}
      `;
      report.cross_tenant_leakage += Number(rows[0].count);
    }
  }

  const indirectChecks = [
    ['user_roles', 'user_id', 'users', 'role_id', 'roles'],
    ['user_branch_access', 'user_id', 'users', 'branch_id', 'branches'],
    ['tax_code_components', 'tax_code_id', 'tax_codes', 'tax_component_id', 'tax_components'],
    ['stock_adjustment_item_serials', 'stock_adjustment_item_id', 'stock_adjustment_items', 'serial_id', 'product_serials'],
    ['purchase_receiving_item_serials', 'purchase_receiving_item_id', 'purchase_receiving_items', 'serial_id', 'product_serials'],
    ['landed_cost_allocations', 'landed_cost_document_id', 'landed_cost_documents', 'purchase_item_id', 'purchase_items'],
    ['purchase_return_item_serials', 'purchase_return_item_id', 'purchase_return_items', 'serial_id', 'product_serials'],
    ['transfer_item_serials', 'transfer_item_id', 'transfer_items', 'serial_id', 'product_serials'],
    ['sale_item_serials', 'sale_item_id', 'sale_items', 'serial_id', 'product_serials'],
    ['sale_return_item_serials', 'sale_return_item_id', 'sale_return_items', 'serial_id', 'product_serials'],
    ['courier_cod_settlement_items', 'settlement_id', 'courier_cod_settlements', 'delivery_order_id', 'delivery_orders'],
    ['user_notifications', 'notification_id', 'notifications', 'user_id', 'users'],
  ];
  for (const [joinTable, leftId, leftTable, rightId, rightTable] of indirectChecks) {
    const rows = await target`
      SELECT COUNT(*) AS count FROM ${target(joinTable)} AS j
      JOIN ${target(leftTable)} AS a ON ${target(`j.${leftId}`)} = ${target('a.id')}
      JOIN ${target(rightTable)} AS b ON ${target(`j.${rightId}`)} = ${target('b.id')}
      WHERE ${target('a.company_id')} <> ${target('b.company_id')}
    `;
    report.cross_tenant_leakage += Number(rows[0].count);
  }

  for (const model of Prisma.dmmf.datamodel.models) {
    for (const fields of model.uniqueFields) {
      const documentField = fields.find((field) => field !== 'companyId' && /(No|Number)$/.test(field));
      if (!fields.includes('companyId') || !documentField || fields.length !== 2) continue;
      const dbTable = table(model);
      const dbField = column(model, documentField);
      const duplicates = await target`
        SELECT COUNT(*) AS count FROM (
          SELECT 1 FROM ${target(dbTable)}
          WHERE ${target(dbField)} IS NOT NULL
          GROUP BY ${target('company_id')}, ${target(dbField)} HAVING COUNT(*) > 1
        ) AS duplicate_groups
      `;
      report.duplicate_document_numbers += Number(duplicates[0].count);
    }
  }

  const balance = await target`
    SELECT COALESCE(SUM(jl.debit_base), 0) AS debit, COALESCE(SUM(jl.credit_base), 0) AS credit
    FROM journal_lines jl JOIN journal_entries je
      ON je.id = jl.journal_entry_id AND je.company_id = jl.company_id
    WHERE je.status = 'posted'
  `;
  const debit = new Prisma.Decimal(String(balance[0].debit));
  const credit = new Prisma.Decimal(String(balance[0].credit));
  report.posted_debit = debit.toFixed();
  report.posted_credit = credit.toFixed();
  report.posted_balance_variance = debit.sub(credit).toFixed();

  for (const model of Prisma.dmmf.datamodel.models) {
    const dbTable = table(model);
    for (const field of model.fields.filter((field) => field.kind === 'scalar' && field.type === 'Decimal')) {
      const dbColumn = field.dbName ?? field.name;
      const [sourceTotal, targetTotal] = await Promise.all([
        decimalSum(source, dbTable, dbColumn),
        decimalSum(target, dbTable, dbColumn),
      ]);
      if (sourceTotal.eq(targetTotal)) continue;
      if (/(qty|quantity|cost|stock|inventory|reserved|transit|damaged)/i.test(field.name)) {
        report.unexplained_inventory_variance++;
      } else if (/(amount|total|debit|credit|balance|tax|discount|price|value|rate)/i.test(field.name)) {
        report.unexplained_financial_variance++;
      }
    }
  }
} catch (error) {
  report.failures.push({ check: 'reconciliation', ...safeError(error) });
  process.exitCode = 1;
} finally {
  await source.close();
  await target.close();
  console.log(JSON.stringify(report, null, 2));
}
