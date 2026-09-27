// scripts/audit-production-db.mjs compares a deployed database with
// prisma/mariadb/schema-fingerprint.json. A fingerprint that falls behind the
// schema would report every new table or column as drift, or miss what a new
// migration was meant to create, so it must describe the same schema.
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';

const fingerprint = JSON.parse(readFileSync('prisma/mariadb/schema-fingerprint.json', 'utf8')) as {
  tables: Record<string, { columns: Record<string, unknown>; foreignKeys: Record<string, { columns: string; references: string }> }>;
  triggers: Record<string, unknown>;
};

describe('schema fingerprint', () => {
  it('has exactly the tables and columns the Prisma schema maps', () => {
    const models = Prisma.dmmf.datamodel.models;
    expect(Object.keys(fingerprint.tables).sort()).toEqual(models.map(m => m.dbName ?? m.name).sort());
    for (const model of models) {
      const columns = model.fields.filter(f => f.kind === 'scalar' || f.kind === 'enum').map(f => f.dbName ?? f.name).sort();
      expect(Object.keys(fingerprint.tables[model.dbName ?? model.name].columns).sort(), model.name).toEqual(columns);
    }
  });

  it('was generated after the newest migration', () => {
    // The latest migration adds the company keys of cashier_device_pins; a
    // fingerprint from before it would not have them.
    const newest = readdirSync('prisma/mariadb/migrations').filter(n => /^\d{14}_/.test(n)).sort().at(-1);
    expect(newest).toBe('20260927000100_tenant_parent_keys');
    const pins = Object.values(fingerprint.tables.cashier_device_pins.foreignKeys);
    expect(pins.map(fk => `${fk.columns}->${fk.references}`).sort()).toEqual([
      'company_id,device_id->devices(company_id,id)',
      'company_id,user_id->users(company_id,id)',
      'company_id->companies(id)',
      'device_id->devices(id)',
      'user_id->users(id)',
    ]);
  });

  it('keeps every company-owned reference paired with a composite company key', () => {
    const tenant = (table: string) => 'company_id' in (fingerprint.tables[table]?.columns ?? {});
    const unpaired: string[] = [];
    for (const [table, t] of Object.entries(fingerprint.tables)) {
      if (!tenant(table)) continue;
      const fks = Object.values(t.foreignKeys);
      for (const fk of fks) {
        const target = fk.references.split('(')[0];
        if (fk.columns.includes(',') || fk.columns === 'company_id' || target === 'companies' || !tenant(target)) continue;
        if (!fks.some(o => o.columns === `company_id,${fk.columns}` && o.references.startsWith(`${target}(`))) unpaired.push(`${table}.${fk.columns}`);
      }
      if (!fks.some(f => f.columns === 'company_id' && f.references === 'companies(id)')) unpaired.push(`${table}.company_id -> companies`);
    }
    expect(unpaired).toEqual([]);
  });
});
