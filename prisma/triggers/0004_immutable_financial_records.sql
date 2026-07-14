-- prisma/triggers/0004_immutable_financial_records.sql
-- Additional immutability triggers for financial records per §20.0 control 3.
-- Uses DO $$ blocks to skip triggers gracefully when the target table doesn't exist
-- (e.g., journal_lines may not be in all schema variants).

-- Journal lines: immutable once posted (skip if table doesn't exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='journal_lines') THEN
    CREATE TRIGGER trg_journal_lines_immutable
      BEFORE UPDATE OR DELETE ON journal_lines
      FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- Payment allocations: immutable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='payment_allocations') THEN
    CREATE TRIGGER trg_payment_allocations_immutable
      BEFORE UPDATE OR DELETE ON payment_allocations
      FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- Serial events: immutable lifecycle ledger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='serial_events') THEN
    CREATE TRIGGER trg_serial_events_immutable
      BEFORE UPDATE OR DELETE ON serial_events
      FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- Delivery events: immutable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='delivery_events') THEN
    CREATE TRIGGER trg_delivery_events_immutable
      BEFORE UPDATE OR DELETE ON delivery_events
      FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- Service events: immutable
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_events') THEN
    CREATE TRIGGER trg_service_events_immutable
      BEFORE UPDATE OR DELETE ON service_events
      FOR EACH ROW EXECUTE FUNCTION prevent_posted_record_mutation();
  END IF;
END $$;

-- set_updated_at for additional tables (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='fiscal_periods') THEN
    DROP TRIGGER IF EXISTS trg_fiscal_periods_updated_at ON fiscal_periods;
    CREATE TRIGGER trg_fiscal_periods_updated_at
      BEFORE UPDATE ON fiscal_periods
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='financial_accounts') THEN
    DROP TRIGGER IF EXISTS trg_financial_accounts_updated_at ON financial_accounts;
    CREATE TRIGGER trg_financial_accounts_updated_at
      BEFORE UPDATE ON financial_accounts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='accounting_policies') THEN
    DROP TRIGGER IF EXISTS trg_accounting_policies_updated_at ON accounting_policies;
    CREATE TRIGGER trg_accounting_policies_updated_at
      BEFORE UPDATE ON accounting_policies
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Document number leases: set_updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='document_number_leases') THEN
    DROP TRIGGER IF EXISTS trg_document_number_leases_updated_at ON document_number_leases;
    CREATE TRIGGER trg_document_number_leases_updated_at
      BEFORE UPDATE ON document_number_leases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Product batches: set_updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='product_batch') THEN
    DROP TRIGGER IF EXISTS trg_product_batches_updated_at ON product_batch;
    CREATE TRIGGER trg_product_batches_updated_at
      BEFORE UPDATE ON product_batch
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Communication consents: set_updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='communication_consents') THEN
    DROP TRIGGER IF EXISTS trg_communication_consents_updated_at ON communication_consents;
    CREATE TRIGGER trg_communication_consents_updated_at
      BEFORE UPDATE ON communication_consents
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Communication campaign recipients: set_updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='communication_campaign_recipients') THEN
    DROP TRIGGER IF EXISTS trg_communication_campaign_recipients_updated_at ON communication_campaign_recipients;
    CREATE TRIGGER trg_communication_campaign_recipients_updated_at
      BEFORE UPDATE ON communication_campaign_recipients
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Outbound messages: set_updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='outbound_messages') THEN
    DROP TRIGGER IF EXISTS trg_outbound_messages_updated_at ON outbound_messages;
    CREATE TRIGGER trg_outbound_messages_updated_at
      BEFORE UPDATE ON outbound_messages
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Webhook deliveries: set_updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='webhook_deliveries') THEN
    DROP TRIGGER IF EXISTS trg_webhook_deliveries_updated_at ON webhook_deliveries;
    CREATE TRIGGER trg_webhook_deliveries_updated_at
      BEFORE UPDATE ON webhook_deliveries
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Offline commands: set_updated_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='offline_commands') THEN
    DROP TRIGGER IF EXISTS trg_offline_commands_updated_at ON offline_commands;
    CREATE TRIGGER trg_offline_commands_updated_at
      BEFORE UPDATE ON offline_commands
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
