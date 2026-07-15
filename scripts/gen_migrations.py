#!/usr/bin/env python3
"""Generate migration files 0011-0017 from Prisma schema (v3)."""
import re
import json
import sys
import os

PARTITIONED_TABLES = {'journal_entries', 'payments', 'stock_movements'}

# Cross-migration forward references: (table, col) → target_table
# These FKs are skipped in the source migration and added via ALTER TABLE in the
# target migration once the parent table exists.
CROSS_MIGRATION_FK_SKIPS = {
    ('cashier_shifts', 'cash_account_id'): 'financial_accounts',
}

USER_BY_COLS = {
    'created_by','updated_by','approved_by','reviewed_by','posted_by','counted_by','received_by',
    'requested_by','rejected_by','cancelled_by','reversed_by','authorized_by','issued_by',
    'assigned_to','paid_by','collected_by','delivered_by','declared_by','resolved_by',
    'exported_by','changed_by','verified_by','submitted_by','prepared_by','initiated_by',
    'completed_by','closed_by','opened_by','waived_by','assigned_by','reverted_by',
    'granted_by','renewed_by','revoked_by','confirmed_by','acknowledged_by','processed_by',
    'transferred_by','recorded_by','cashier_id','approver_id','creator_id','salesperson_id',
    'uploaded_by','registered_by','counter_id','author_id','opener_id','handler_id',
}

MIGRATIONS = {
    '0011_m2_inventory_purchasing_tables.sql': [
        'stock_counts', 'stock_count_items', 'stock_count_serials',
        'stock_adjustments', 'stock_adjustment_items', 'stock_adjustment_item_serials',
        'stock_movement_batches', 'stock_budget_leases',
        'purchases', 'purchase_items', 'purchase_item_taxes',
        'purchase_receivings', 'purchase_receiving_items', 'purchase_receiving_item_serials',
        'purchase_returns', 'purchase_return_items', 'purchase_return_item_serials',
        'landed_cost_documents', 'landed_cost_allocations',
        'transfers', 'transfer_items', 'transfer_item_serials',
        'supplier_advance_ledger',
    ],
    '0012_m3_pos_payments_tables.sql': [
        # cashier_shifts first (sales depends on cashier_shifts)
        'cashier_shifts', 'cash_drawer_counts',
        'quotations', 'quotation_items',
        'sales', 'sale_items', 'sale_item_taxes', 'sale_item_serials',
        'sale_returns', 'sale_return_items', 'sale_return_item_serials',
        'payment_allocations', 'return_refund_allocations',
        'installments', 'installment_allocations',
        'gift_cards', 'gift_card_transactions',
        'coupons', 'coupon_redemptions',
        'reward_point_transactions', 'reward_point_consumptions',
        'customer_advance_ledger',
    ],
    '0013_m4_accounting_tables.sql': [
        'chart_of_accounts', 'financial_accounts',
        'fiscal_periods', 'journal_lines',
        'accounting_policies',
        'expense_categories',
        'expenses', 'expense_items', 'expense_item_taxes', 'expense_attachments',
        'account_transfers',
        'withholding_transactions',
    ],
    '0014_m5_delivery_service_tables.sql': [
        'delivery_orders', 'delivery_items', 'delivery_events',
        'courier_shipments',
        'courier_cod_settlements', 'courier_cod_settlement_items',
        'service_requests', 'service_request_parts', 'service_events',
        'warranty_claims',
    ],
    '0015_m6_crm_hr_tables.sql': [
        'lead_subjects', 'lead_sources', 'lead_statuses',
        'leads', 'lead_activities',
        'departments', 'designations', 'employees',
        'payroll_components', 'payroll_runs', 'payroll_items', 'payroll_item_components',
        'holidays', 'leave_types', 'leave_requests', 'attendance_records',
        'notifications',
        'communication_consents', 'communication_campaigns', 'communication_campaign_recipients',
        'data_subject_requests',
    ],
    '0016_m7_integration_tables.sql': [
        'outbox_events',
        'webhook_endpoints', 'webhook_deliveries',
        'import_jobs', 'import_job_errors',
        'offline_sync_batches', 'offline_commands',
        'outbound_messages',
        'print_jobs',
        'user_notifications',
        'legal_holds',
        'webauthn_credentials', 'webauthn_challenges',
    ],
    '0017_gap_addition_tables.sql': [
        'risk_threshold_changes', 'risk_assessments', 'risk_assessment_outcomes',
        'currency_revaluations',
    ],
}

JUNCTION_TABLES = {
    'purchase_receiving_item_serials': ('purchase_receiving_items', 'purchase_receiving_item_id'),
    'purchase_return_item_serials': ('purchase_return_items', 'purchase_return_item_id'),
    'landed_cost_allocations': ('landed_cost_documents', 'landed_cost_document_id'),
    'transfer_item_serials': ('transfer_items', 'transfer_item_id'),
    'sale_item_serials': ('sale_items', 'sale_item_id'),
    'sale_return_item_serials': ('sale_return_items', 'sale_return_item_id'),
    'courier_cod_settlement_items': ('courier_cod_settlements', 'settlement_id'),
    'user_notifications': ('notifications', 'notification_id'),
}

APPEND_ONLY_TABLES = {
    'stock_movement_batches', 'gift_card_transactions',
    'reward_point_transactions', 'risk_assessments', 'risk_assessment_outcomes',
    'courier_cod_settlements', 'courier_cod_settlement_items', 'warranty_claims',
}

def parse_schema(path):
    with open(path) as f:
        text = f.read()
    models = {}
    i = 0
    while i < len(text):
        m = re.match(r'^model (\w+) \{', text[i:], re.MULTILINE)
        if m:
            name = m.group(1)
            start = i + m.end()
            depth = 1
            j = start
            while j < len(text) and depth > 0:
                if text[j] == '{':
                    depth += 1
                elif text[j] == '}':
                    depth -= 1
                j += 1
            body = text[i:j]
            models[name] = body
            i = j
        else:
            i += 1
    return models

def get_table_name(model_body):
    m = re.search(r'@@map\("([^"]+)"\)', model_body)
    return m.group(1) if m else None

def parse_fields(model_body):
    lines = model_body.split('\n')[1:-1]
    fields = []
    for ln in lines:
        ln = ln.rstrip()
        if not ln.strip():
            continue
        if ln.strip().startswith('//'):
            continue
        if ln.strip().startswith('@@'):
            continue
        m = re.match(r'\s+(\w+)\s+(\S+)(.*)$', ln)
        if not m:
            continue
        name = m.group(1)
        ftype = m.group(2)
        rest = m.group(3)
        comment = ''
        cidx = rest.find('//')
        if cidx >= 0:
            comment = rest[cidx+2:].strip()
            rest = rest[:cidx]
        scalar_types = {'String', 'Int', 'BigInt', 'Decimal', 'Boolean', 'DateTime', 'Bytes', 'Json', 'Float'}
        base_type = ftype.rstrip('?')
        if base_type not in scalar_types:
            continue
        if ftype.endswith('[]'):
            continue
        fields.append((name, ftype, rest.strip(), comment))
    return fields

def parse_relations(model_body):
    rels = []
    lines = model_body.split('\n')[1:-1]
    for ln in lines:
        m = re.match(r'\s+(\w+)\s+(\w+)\??\s+@relation\(([^)]*)\)', ln)
        if not m:
            continue
        local_name = m.group(1)
        target_model = m.group(2)
        args = m.group(3)
        fields_m = re.search(r'fields:\s*\[([^\]]+)\]', args)
        if not fields_m:
            continue
        local_field = fields_m.group(1).strip()
        refs_m = re.search(r'references:\s*\[([^\]]+)\]', args)
        if not refs_m:
            continue
        ref_field = refs_m.group(1).strip()
        od_m = re.search(r'onDelete:\s*(\w+)', args)
        on_delete = od_m.group(1).upper() if od_m else 'RESTRICT'
        rels.append({
            'local_name': local_name,
            'local_field': local_field,
            'ref_field': ref_field,
            'on_delete': on_delete,
            'target_model': target_model,
        })
    return rels

def parse_uniques(model_body):
    uniques = []
    for m in re.finditer(r'@@unique\(\[([^\]]+)\](?:[^)]*)?\)', model_body):
        cols = [c.strip() for c in m.group(1).split(',')]
        uniques.append(cols)
    return uniques

def parse_indexes(model_body):
    idxs = []
    for m in re.finditer(r'@@index\(\[([^\]]+)\](?:[^)]*)?\)', model_body):
        cols = [c.strip() for c in m.group(1).split(',')]
        idxs.append(cols)
    return idxs

def parse_id_field(model_body):
    lines = model_body.split('\n')[1:-1]
    for ln in lines:
        m = re.match(r'\s+(\w+)\s+\S+.*@id', ln)
        if m:
            return m.group(1)
    m = re.search(r'@@id\(\[([^\]]+)\]', model_body)
    if m:
        return [c.strip() for c in m.group(1).split(',')]
    return None

def to_snake(name):
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)
    s = re.sub(r'([a-z\d])([A-Z])', r'\1_\2', s)
    return s.lower()

def decimal_precision(name):
    n = name.lower()
    if 'rate' in n or 'exchange' in n:
        return 'DECIMAL(18,6)'
    if 'qty' in n or 'quantity' in n:
        return 'DECIMAL(18,4)'
    if 'unit_cost' in n or 'average_cost' in n or 'moving_average' in n:
        return 'DECIMAL(18,6)'
    if 'factor' in n or 'ratio' in n:
        return 'DECIMAL(18,6)'
    return 'DECIMAL(18,2)'

def is_currency_code_col(col):
    return col == 'currency_code' or col.endswith('_currency_code') or col == 'base_currency_code'

def should_be_uuid(col):
    if col == 'id':
        return True
    if col == 'company_id':
        return True
    if col in USER_BY_COLS:
        return True
    if col.endswith('_id'):
        return True
    if col in ('assigned_to', 'cashier_id', 'approver_id', 'creator_id', 'salesperson_id'):
        return True
    return False

def map_type(name, ftype, comment, col_name, is_fk, is_pk, fk_target_table=None):
    base = ftype.rstrip('?')
    nullable = ftype.endswith('?')
    pg_type = None
    if base == 'String':
        if is_currency_code_col(col_name):
            pg_type = 'CHAR(3)'
        elif is_pk or is_fk:
            if fk_target_table == 'currencies':
                pg_type = 'CHAR(3)'
            else:
                pg_type = 'UUID'
        elif should_be_uuid(col_name):
            pg_type = 'UUID'
        else:
            pg_type = 'VARCHAR'
    elif base == 'Int':
        pg_type = 'INTEGER'
    elif base == 'BigInt':
        pg_type = 'BIGINT'
    elif base == 'Decimal':
        pg_type = decimal_precision(name)
    elif base == 'Boolean':
        pg_type = 'BOOLEAN'
    elif base == 'DateTime':
        pg_type = 'TIMESTAMPTZ'
    elif base == 'Bytes':
        pg_type = 'BYTEA'
    elif base == 'Json':
        pg_type = 'JSONB'
    elif base == 'Float':
        pg_type = 'DOUBLE PRECISION'
    return pg_type, nullable

def parse_default(rest, is_pk):
    m = re.search(r'@default\(([^)]*)\)', rest)
    if not m:
        return None
    val = m.group(1).strip()
    if val == 'uuid()':
        return "gen_random_uuid()"
    if val == 'now()':
        return "now()"
    if val == 'true':
        return "true"
    if val == 'false':
        return "false"
    if val.startswith('"') and val.endswith('"'):
        return "'" + val[1:-1].replace("'", "''") + "'"
    if val.startswith('dbgenerated'):
        return None
    try:
        float(val)
        return val
    except ValueError:
        pass
    return None

def enum_check_from_comment(comment, col_name):
    if not comment:
        return None
    if 'JSONB' in comment or 'SQLite' in comment or 'http' in comment or 'HMAC' in comment:
        return None
    m = re.search(r'(?:^|\s)\s*((?:\w+)(?:[\/|,]\s*\w+){1,20})', comment)
    if not m:
        return None
    cand = m.group(1)
    parts = re.split(r'[\/|,]', cand)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) < 2:
        return None
    valid = []
    for p in parts:
        if re.match(r'^[A-Za-z][A-Za-z0-9_\-]*$', p):
            valid.append(p)
        else:
            return None
    if len(valid) < 2 or len(valid) > 25:
        return None
    return f"CHECK ({col_name} IN ({','.join(chr(39)+v+chr(39) for v in valid)}))"

ALL_MODELS = parse_schema('prisma/schema.prisma')

table_to_model = {}
model_to_table = {}
for mn, mb in ALL_MODELS.items():
    tn = get_table_name(mb)
    if tn:
        table_to_model[tn] = mn
        model_to_table[mn] = tn

def gen_table_ddl(model_name):
    mb = ALL_MODELS[model_name]
    table_name = get_table_name(mb)
    fields = parse_fields(mb)
    rels = parse_relations(mb)
    uniques = parse_uniques(mb)
    idxs = parse_indexes(mb)
    id_field = parse_id_field(mb)

    fk_cols = {}
    skipped_partitioned_fks = []
    skipped_cross_migration_fks = []
    for r in rels:
        col = to_snake(r['local_field'])
        target_table = model_to_table.get(r['target_model'])
        if not target_table:
            continue
        ref_col = to_snake(r['ref_field'])
        if target_table in PARTITIONED_TABLES:
            skipped_partitioned_fks.append((col, target_table, ref_col))
            continue
        if (table_name, col) in CROSS_MIGRATION_FK_SKIPS:
            skipped_cross_migration_fks.append((col, target_table, ref_col, r['on_delete']))
            continue
        fk_cols[col] = (target_table, ref_col, r['on_delete'])

    col_defs = []
    pk_cols = []
    composite_pk = None
    if isinstance(id_field, list):
        composite_pk = [to_snake(c) for c in id_field]

    for fname, ftype, rest, comment in fields:
        col = to_snake(fname)
        is_pk = '@id' in rest
        is_fk = col in fk_cols
        fk_target = fk_cols.get(col, (None,))[0] if is_fk else None

        pg_type, nullable = map_type(fname, ftype, comment, col, is_fk, is_pk, fk_target)
        if not pg_type:
            continue

        parts = [f"{col} {pg_type}"]

        if is_pk:
            pk_cols.append(col)
            if pg_type == 'UUID':
                parts.append("DEFAULT gen_random_uuid()")
            parts.append("NOT NULL")
        else:
            default = parse_default(rest, is_pk)
            if default:
                parts.append(f"DEFAULT {default}")
            if not nullable:
                parts.append("NOT NULL")

        col_def = ' '.join(parts)
        chk = enum_check_from_comment(comment, col)
        if chk:
            col_def += f" {chk}"
        col_defs.append(col_def)

    fk_constraints = []
    for col, (target_table, ref_col, on_delete) in fk_cols.items():
        if on_delete == 'CASCADE':
            od = "ON DELETE CASCADE"
        else:
            od = "ON DELETE RESTRICT"
        fk_name = f"fk_{table_name}_{col}"
        if len(fk_name) > 60:
            fk_name = fk_name[:60]
        fk_constraints.append(
            f"CONSTRAINT {fk_name} FOREIGN KEY ({col}) REFERENCES {target_table}({ref_col}) {od}"
        )

    unique_constraints = []
    seen_unique_keys = set()
    for u_cols in uniques:
        u_cols_db = [to_snake(c) for c in u_cols]
        key = tuple(u_cols_db)
        if key in seen_unique_keys:
            continue
        seen_unique_keys.add(key)
        u_name = f"uq_{table_name}_" + "_".join(u_cols_db)
        if len(u_name) > 60:
            u_name = f"uq_{table_name}_{abs(hash(key)) % 100000}"
        unique_constraints.append(f"CONSTRAINT {u_name} UNIQUE ({', '.join(u_cols_db)})")

    for fname, ftype, rest, comment in fields:
        if '@unique' in rest and '@id' not in rest:
            col = to_snake(fname)
            key = (col,)
            if key in seen_unique_keys:
                continue
            seen_unique_keys.add(key)
            u_name = f"uq_{table_name}_{col}"
            unique_constraints.append(f"CONSTRAINT {u_name} UNIQUE ({col})")

    all_defs = []
    if composite_pk:
        all_defs.append(f"PRIMARY KEY ({', '.join(composite_pk)})")
    elif pk_cols:
        all_defs.append(f"PRIMARY KEY ({', '.join(pk_cols)})")
    all_defs.extend(col_defs)
    all_defs.extend(fk_constraints)
    all_defs.extend(unique_constraints)

    create_sql = f"CREATE TABLE IF NOT EXISTS {table_name} (\n  " + ",\n  ".join(all_defs) + "\n);"

    index_sqls = []
    seen_idx_names = set()
    for i, idx_cols in enumerate(idxs):
        idx_cols_db = [to_snake(c) for c in idx_cols]
        idx_name = f"idx_{table_name}_" + "_".join(idx_cols_db)
        if len(idx_name) > 60 or idx_name in seen_idx_names:
            idx_name = f"idx_{table_name}_{i}"
        seen_idx_names.add(idx_name)
        index_sqls.append(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table_name}({', '.join(idx_cols_db)});")

    has_company = any(to_snake(f[0]) == 'company_id' for f in fields)
    has_updated_at = any(to_snake(f[0]) == 'updated_at' for f in fields)

    return {
        'table_name': table_name,
        'create_sql': create_sql,
        'indexes': index_sqls,
        'has_company': has_company,
        'has_updated_at': has_updated_at,
        'skipped_partitioned_fks': skipped_partitioned_fks,
        'skipped_cross_migration_fks': skipped_cross_migration_fks,
    }

all_migrations = {}
for mf, table_list in MIGRATIONS.items():
    tables_data = []
    for tbl in table_list:
        mn = table_to_model.get(tbl)
        if not mn:
            print(f"WARNING: Model not found for table {tbl}", file=sys.stderr)
            continue
        try:
            d = gen_table_ddl(mn)
            tables_data.append(d)
        except Exception as e:
            print(f"ERROR generating {mn}: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
    all_migrations[mf] = tables_data

with open('/tmp/all_migrations.json', 'w') as f:
    json.dump(all_migrations, f, indent=2, default=str)

total = sum(len(v) for v in all_migrations.values())
print(f"Total tables: {total}", file=sys.stderr)
