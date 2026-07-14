// tests/unit/importExport.test.ts
// Tests for import/export utilities — CSV parsing, formula escaping,
// template validation, and export scope controls.

import { describe, it, expect } from 'vitest';
import { escapeFormulaCell, parseCsv, generateCsv, validateRowColumns, rowToObject } from '@/lib/import-export/csv';
import { IMPORT_TEMPLATES, getTemplate, getTemplateColumns } from '@/lib/import-export/templates';

describe('CSV Formula Escaping (§6 rule 8)', () => {
  it('escapes cells starting with =', () => {
    expect(escapeFormulaCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
  });

  it('escapes cells starting with +', () => {
    expect(escapeFormulaCell('+1234')).toBe("'+1234");
  });

  it('escapes cells starting with -', () => {
    expect(escapeFormulaCell('-1+1')).toBe("'-1+1");
  });

  it('escapes cells starting with @', () => {
    expect(escapeFormulaCell('@import("evil.css")')).toBe("'@import(\"evil.css\")");
  });

  it('escapes cells starting with tab', () => {
    expect(escapeFormulaCell('\t=cmd')).toBe("'\t=cmd");
  });

  it('does not escape normal text', () => {
    expect(escapeFormulaCell('Hello World')).toBe('Hello World');
    expect(escapeFormulaCell('123')).toBe('123');
    expect(escapeFormulaCell('Product A')).toBe('Product A');
  });

  it('handles null/undefined', () => {
    expect(escapeFormulaCell(null)).toBe('');
    expect(escapeFormulaCell(undefined)).toBe('');
  });

  it('handles numbers', () => {
    expect(escapeFormulaCell(123)).toBe('123');
    expect(escapeFormulaCell(-45.67)).toBe("'-45.67"); // negative number starts with -
  });
});

describe('CSV Parsing', () => {
  it('parses simple CSV', () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('parses quoted fields with commas', () => {
    const csv = '"Hello, World",b\n"Foo, Bar",c';
    const rows = parseCsv(csv);
    expect(rows[0][0]).toBe('Hello, World');
    expect(rows[1][0]).toBe('Foo, Bar');
  });

  it('parses escaped quotes', () => {
    const csv = '"She said ""hello""",b';
    const rows = parseCsv(csv);
    expect(rows[0][0]).toBe('She said "hello"');
  });

  it('parses newlines in quoted fields', () => {
    const csv = '"Line 1\nLine 2",b';
    const rows = parseCsv(csv);
    expect(rows[0][0]).toBe('Line 1\nLine 2');
  });

  it('handles empty CSV', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('handles single row', () => {
    const rows = parseCsv('a,b,c');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
  });
});

describe('CSV Generation', () => {
  it('generates simple CSV', () => {
    const csv = generateCsv([['a', 'b'], ['1', '2']]);
    expect(csv).toBe('a,b\n1,2');
  });

  it('escapes formula cells by default', () => {
    const csv = generateCsv([['name', 'formula'], ['test', '=SUM(A1)']]);
    expect(csv).toContain("'=SUM(A1)");
  });

  it('can disable formula escaping', () => {
    const csv = generateCsv([['=cmd']], { escapeFormulas: false });
    expect(csv).toBe('=cmd');
  });

  it('quotes fields with commas', () => {
    const csv = generateCsv([['Hello, World', 'b']]);
    expect(csv).toContain('"Hello, World"');
  });

  it('quotes fields with newlines', () => {
    const csv = generateCsv([['Line 1\nLine 2', 'b']]);
    expect(csv).toContain('"Line 1\nLine 2"');
  });
});

describe('Row Validation', () => {
  it('validates correct column count', () => {
    const errors = validateRowColumns(['a', 'b', 'c'], 3, 1);
    expect(errors).toHaveLength(0);
  });

  it('detects too few columns', () => {
    const errors = validateRowColumns(['a', 'b'], 3, 1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('expected 3');
  });

  it('detects too many columns', () => {
    const errors = validateRowColumns(['a', 'b', 'c', 'd'], 3, 1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('got 4');
  });
});

describe('Row to Object Mapping', () => {
  it('maps row values to object keys', () => {
    const obj = rowToObject(['Alice', '30', 'alice@example.com'], ['name', 'age', 'email']);
    expect(obj.name).toBe('Alice');
    expect(obj.age).toBe('30');
    expect(obj.email).toBe('alice@example.com');
  });

  it('handles fewer values than headers', () => {
    const obj = rowToObject(['Alice'], ['name', 'age', 'email']);
    expect(obj.name).toBe('Alice');
    expect(obj.age).toBeUndefined();
  });
});

describe('Import Templates (§9.5)', () => {
  it('has all required templates', () => {
    const requiredTypes = ['product', 'customer', 'supplier', 'sale_draft', 'transfer_draft', 'purchase', 'opening_stock'];
    for (const type of requiredTypes) {
      expect(IMPORT_TEMPLATES[type]).toBeDefined();
      expect(IMPORT_TEMPLATES[type].requiredColumns.length).toBeGreaterThan(0);
    }
  });

  it('product template has required columns', () => {
    const template = getTemplate('product')!;
    expect(template.requiredColumns).toContain('code');
    expect(template.requiredColumns).toContain('name');
    expect(template.requiredColumns).toContain('category');
    expect(template.duplicateKey).toBe('code');
    expect(template.entityType).toBe('product');
  });

  it('sale_draft template validates serials', () => {
    const template = getTemplate('sale_draft')!;
    expect(template.validatesSerial).toBe(true);
    expect(template.entityType).toBe('sale');
  });

  it('opening_stock template has no duplicate key', () => {
    const template = getTemplate('opening_stock')!;
    expect(template.duplicateKey).toBeUndefined();
  });

  it('all templates have allowed duplicate strategies', () => {
    for (const template of Object.values(IMPORT_TEMPLATES)) {
      expect(template.allowedDuplicateStrategies.length).toBeGreaterThan(0);
      expect(template.allowedDuplicateStrategies).toContain('skip');
    }
  });

  it('getTemplateColumns returns required + optional', () => {
    const cols = getTemplateColumns('product')!;
    expect(cols.required).toContain('code');
    expect(cols.optional).toContain('barcode');
  });

  it('returns undefined for unknown template type', () => {
    expect(getTemplate('unknown')).toBeUndefined();
    expect(getTemplateColumns('unknown')).toBeUndefined();
  });
});
