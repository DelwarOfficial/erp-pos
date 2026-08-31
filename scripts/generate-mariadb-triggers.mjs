import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'prisma', 'mariadb', 'migrations', '20260831181500_critical_triggers', 'migration.sql');
const sql = [];

function trigger(name, timing, event, table, body) {
  sql.push(
    `CREATE TRIGGER \`${name}\` ${timing} ${event} ON \`${table}\``,
    'FOR EACH ROW',
    'BEGIN',
    body.trim(),
    'END;',
    '',
  );
}

trigger('trg_fiscal_periods_no_overlap_ins', 'BEFORE', 'INSERT', 'fiscal_periods', `
  IF EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.company_id = NEW.company_id
      AND NEW.period_start <= fp.period_end
      AND NEW.period_end >= fp.period_start
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FISCAL_PERIOD_OVERLAP';
  END IF;
`);

trigger('trg_fiscal_periods_no_overlap_upd', 'BEFORE', 'UPDATE', 'fiscal_periods', `
  IF EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.company_id = NEW.company_id AND fp.id <> OLD.id
      AND NEW.period_start <= fp.period_end
      AND NEW.period_end >= fp.period_start
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FISCAL_PERIOD_OVERLAP';
  END IF;
`);

trigger('trg_document_leases_no_overlap_ins', 'BEFORE', 'INSERT', 'document_number_leases', `
  IF EXISTS (
    SELECT 1 FROM document_number_leases dl
    WHERE dl.company_id = NEW.company_id
      AND dl.document_type = NEW.document_type
      AND dl.prefix = NEW.prefix
      AND NEW.range_start <= dl.range_end
      AND NEW.range_end >= dl.range_start
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DOCUMENT_LEASE_OVERLAP';
  END IF;
`);

trigger('trg_document_leases_no_overlap_upd', 'BEFORE', 'UPDATE', 'document_number_leases', `
  IF EXISTS (
    SELECT 1 FROM document_number_leases dl
    WHERE dl.company_id = NEW.company_id AND dl.id <> OLD.id
      AND dl.document_type = NEW.document_type
      AND dl.prefix = NEW.prefix
      AND NEW.range_start <= dl.range_end
      AND NEW.range_end >= dl.range_start
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DOCUMENT_LEASE_OVERLAP';
  END IF;
`);

trigger('trg_journal_entries_immutable_upd', 'BEFORE', 'UPDATE', 'journal_entries', `
  IF OLD.status = 'posted' AND NOT (
    NEW.status = 'reversed'
    AND OLD.company_id <=> NEW.company_id
    AND OLD.entry_no <=> NEW.entry_no
    AND OLD.event_id <=> NEW.event_id
    AND OLD.posting_kind <=> NEW.posting_kind
    AND OLD.entry_date <=> NEW.entry_date
    AND OLD.posting_date <=> NEW.posting_date
    AND OLD.source_type <=> NEW.source_type
    AND OLD.source_id <=> NEW.source_id
    AND OLD.currency_code <=> NEW.currency_code
    AND OLD.exchange_rate <=> NEW.exchange_rate
    AND OLD.description <=> NEW.description
    AND OLD.posted_by <=> NEW.posted_by
    AND OLD.posted_at <=> NEW.posted_at
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POSTED_JOURNAL_IMMUTABLE';
  END IF;
`);

trigger('trg_journal_entries_immutable_del', 'BEFORE', 'DELETE', 'journal_entries', `
  IF OLD.status = 'posted' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POSTED_JOURNAL_IMMUTABLE';
  END IF;
`);

const immutableTables = [
  'journal_lines',
  'payment_allocations',
  'stock_movements',
  'stock_movement_batches',
  'serial_events',
  'gift_card_transactions',
  'reward_point_transactions',
  'customer_advance_ledger',
  'supplier_advance_ledger',
  'fixed_asset_depreciation',
  'delivery_events',
  'service_events',
  'audit_logs',
];

for (const table of immutableTables) {
  const compact = table.replaceAll('_', '');
  trigger(`trg_${compact.slice(0, 42)}_immutable_upd`, 'BEFORE', 'UPDATE', table,
    `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';`);
  trigger(`trg_${compact.slice(0, 42)}_immutable_del`, 'BEFORE', 'DELETE', table,
    `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';`);
}

const joinChecks = [
  ['user_roles', 'EXISTS (SELECT 1 FROM users a JOIN roles b ON b.company_id = a.company_id WHERE a.id = NEW.user_id AND b.id = NEW.role_id)'],
  ['user_branch_access', 'EXISTS (SELECT 1 FROM users a JOIN branches b ON b.company_id = a.company_id WHERE a.id = NEW.user_id AND b.id = NEW.branch_id)'],
  ['tax_code_components', 'EXISTS (SELECT 1 FROM tax_codes a JOIN tax_components b ON b.company_id = a.company_id WHERE a.id = NEW.tax_code_id AND b.id = NEW.tax_component_id)'],
  ['stock_adjustment_item_serials', 'EXISTS (SELECT 1 FROM stock_adjustment_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.stock_adjustment_item_id AND b.id = NEW.serial_id)'],
  ['purchase_receiving_item_serials', 'EXISTS (SELECT 1 FROM purchase_receiving_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.purchase_receiving_item_id AND b.id = NEW.serial_id)'],
  ['landed_cost_allocations', 'EXISTS (SELECT 1 FROM landed_cost_documents a JOIN purchase_items b ON b.company_id = a.company_id WHERE a.id = NEW.landed_cost_document_id AND b.id = NEW.purchase_item_id)'],
  ['purchase_return_item_serials', 'EXISTS (SELECT 1 FROM purchase_return_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.purchase_return_item_id AND b.id = NEW.serial_id)'],
  ['transfer_item_serials', 'EXISTS (SELECT 1 FROM transfer_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.transfer_item_id AND b.id = NEW.serial_id)'],
  ['sale_item_serials', 'EXISTS (SELECT 1 FROM sale_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.sale_item_id AND b.id = NEW.serial_id)'],
  ['sale_return_item_serials', 'EXISTS (SELECT 1 FROM sale_return_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.sale_return_item_id AND b.id = NEW.serial_id)'],
  ['courier_cod_settlement_items', 'EXISTS (SELECT 1 FROM courier_cod_settlements a JOIN delivery_orders b ON b.company_id = a.company_id WHERE a.id = NEW.settlement_id AND b.id = NEW.delivery_order_id)'],
  ['user_notifications', 'EXISTS (SELECT 1 FROM notifications a JOIN users b ON b.company_id = a.company_id WHERE a.id = NEW.notification_id AND b.id = NEW.user_id)'],
];

for (const [table, predicate] of joinChecks) {
  const compact = table.replaceAll('_', '').slice(0, 36);
  for (const [event, suffix] of [['INSERT', 'ins'], ['UPDATE', 'upd']]) {
    trigger(`trg_${compact}_tenant_${suffix}`, 'BEFORE', event, table, `
  IF NOT ${predicate} THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
`);
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${sql.join('\n')}\n`);
console.log(JSON.stringify({ output, triggers: (sql.join('\n').match(/^CREATE TRIGGER/gm) ?? []).length }));
