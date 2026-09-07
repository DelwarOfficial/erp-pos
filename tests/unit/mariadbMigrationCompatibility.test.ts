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
    // Phase 0: real NOT NULL columns (initial migration) + consistency CHECK +
    // UNIQUE in invariants. PERSISTENT generated columns failed on MariaDB 11.8
    // with ERROR 1901 and must not return.
    expect(invariants).not.toMatch(/ADD COLUMN.*AS \(.*\)\s*(PERSISTENT|VIRTUAL)/);
    expect(invariants).not.toMatch(/GENERATED\s+ALWAYS/);
    expect(initial).toContain('`branch_scope` VARCHAR(191) NOT NULL');
    expect(initial).toContain('`parent_scope` VARCHAR(191) NOT NULL');
    expect(initial).toContain('`customer_group_scope` VARCHAR(191) NOT NULL');
    expect(invariants).toContain('`document_sequences_branch_scope_chk`');
    expect(invariants).toContain("CHECK (`branch_scope` = IFNULL(`branch_id`, ''))");
    expect(invariants).toContain("CHECK (`parent_scope` = IFNULL(`parent_id`, ''))");
    expect(invariants).toContain("CHECK (`customer_group_scope` = IFNULL(`customer_group_id`, ''))");
    expect(invariants).toContain('UNIQUE INDEX `uq_document_sequences_scope`');
    expect(invariants).toContain('UNIQUE INDEX `uq_categories_parent_scope_name`');
    expect(invariants).toContain('UNIQUE INDEX `uq_product_prices_scope`');
    expect(schema).toContain('@@unique([companyId, branchScope, documentType, fiscalYear])');
    expect(schema).toContain('@@unique([companyId, parentScope, name])');
    expect(schema).toContain(
      '@@unique([companyId, productId, branchScope, customerGroupScope, currencyCode, validFrom])',
    );
  });

  it('does not retain ineffective nullable composite uniques in Prisma schema', () => {
    expect(schema).not.toContain('@@unique([companyId, parentId, name])');
    expect(schema).not.toContain(
      '@@unique([companyId, productId, branchId, customerGroupId, currencyCode, validFrom])',
    );
  });

  it('scopes idempotency identity per tenant with TEXT bodies', () => {
    expect(schema).toContain('@@unique([companyId, idempotencyKey])');
    expect(schema).not.toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(initial).toContain(
      'UNIQUE INDEX `idempotency_requests_company_id_idempotency_key_key`(`company_id`, `idempotency_key`)',
    );
    expect(initial).toContain('`response_body` TEXT NULL');
  });

  it('stores JSON payloads as TEXT instead of VARCHAR(191)', () => {
    for (const column of [
      '`metadata` TEXT NOT NULL',
      '`payload` TEXT NOT NULL',
      '`payload_snapshot` TEXT NOT NULL',
      '`sanitized_provider_data` TEXT NOT NULL',
      '`response_body_excerpt` TEXT NULL',
    ]) {
      expect(initial).toContain(column);
    }
    expect(initial).not.toContain('`response_body` VARCHAR');
  });

  it('enforces customer-advance XOR alongside supplier-advance XOR', () => {
    expect(invariants).toContain('customer_advance_exactly_one_source_chk');
    expect(invariants).toContain('(`payment_id` IS NOT NULL AND `sale_return_id` IS NULL)');
    expect(invariants).toContain('(`payment_id` IS NULL AND `sale_return_id` IS NOT NULL)');
  });

  it('keeps immutable-ledger FKs RESTRICT on delete in both layers', () => {
    for (const line of [
      '`customer_advance_ledger_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT',
      '`customer_advance_ledger_sale_return_id_fkey` FOREIGN KEY (`sale_return_id`) REFERENCES `sale_returns`(`id`) ON DELETE RESTRICT',
      '`journal_entries_reversal_of_entry_id_fkey` FOREIGN KEY (`reversal_of_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE RESTRICT',
      '`journal_lines_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT',
      '`journal_lines_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT',
      '`journal_lines_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT',
    ]) {
      expect(initial).toContain(line);
    }
    expect(initial).not.toContain('`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON DELETE SET NULL');
    expect(invariants).toContain("CHECK (`status` IN ('draft', 'posted', 'reversed'))");
  });
});
