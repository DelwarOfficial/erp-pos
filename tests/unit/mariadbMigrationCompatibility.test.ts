import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, 'prisma', 'mariadb', 'schema.prisma'), 'utf8');
const initial = fs.readFileSync(
  path.join(root, 'prisma', 'mariadb', 'migrations', '20260831180000_initial', 'migration.sql'),
  'utf8',
);
const invariants = fs.readFileSync(
  path.join(root, 'prisma', 'mariadb', 'migrations', '20260831181000_critical_invariants', 'migration.sql'),
  'utf8',
);

describe('MariaDB 11.8 migration compatibility', () => {
  it.each([
    ['document_sequences', 'branch_id', 'branches'],
    ['categories', 'parent_id', 'categories'],
    ['product_prices', 'branch_id', 'branches'],
    ['product_prices', 'customer_group_id', 'customer_groups'],
    ['payment_allocations', 'sale_id', 'sales'],
    ['payment_allocations', 'purchase_id', 'purchases'],
    ['supplier_advance_ledger', 'payment_id', 'payments'],
    ['supplier_advance_ledger', 'purchase_return_id', 'purchase_returns'],
  ])('keeps %s.%s immutable for generated/check expressions', (table, column, parent) => {
    const foreignKey = initial
      .split('\n')
      .find(line => line.startsWith(`ALTER TABLE \`${table}\``) && line.includes(`FOREIGN KEY (\`${column}\`)`));

    expect(foreignKey).toContain(`REFERENCES \`${parent}\``);
    expect(foreignKey).toContain('ON DELETE RESTRICT ON UPDATE RESTRICT;');
  });

  it('uses explicit supplier-ledger XOR without boolean arithmetic', () => {
    expect(invariants).toContain('(`payment_id` IS NOT NULL AND `purchase_return_id` IS NULL)');
    expect(invariants).toContain('(`payment_id` IS NULL AND `purchase_return_id` IS NOT NULL)');
    expect(invariants).not.toMatch(/payment_id` IS NOT NULL\)\s*\+/);
  });

  it('uses explicit at-most-one payment-allocation target', () => {
    expect(invariants).toContain('CHECK (`sale_id` IS NULL OR `purchase_id` IS NULL)');
    expect(invariants).not.toMatch(/sale_id` IS NOT NULL\)\s*\+/);
  });

  it('normalizes nullable scopes before enforcing uniqueness', () => {
    expect(invariants).toContain("`branch_scope` VARCHAR(36) AS (IFNULL(`branch_id`, '')) PERSISTENT");
    expect(invariants).toContain("`parent_scope` VARCHAR(36) AS (IFNULL(`parent_id`, '')) PERSISTENT");
    expect(invariants).toContain("`customer_group_scope` VARCHAR(36) AS (IFNULL(`customer_group_id`, '')) PERSISTENT");
    expect(invariants).toContain('UNIQUE INDEX `uq_document_sequences_scope`');
    expect(invariants).toContain('UNIQUE INDEX `uq_categories_parent_scope_name`');
    expect(invariants).toContain('UNIQUE INDEX `uq_product_prices_scope`');
  });

  it('does not retain ineffective nullable composite uniques in Prisma schema', () => {
    expect(schema).not.toContain('@@unique([companyId, parentId, name])');
    expect(schema).not.toContain(
      '@@unique([companyId, productId, branchId, customerGroupId, currencyCode, validFrom])',
    );
  });
});
