CREATE TRIGGER `trg_fiscal_periods_no_overlap_ins` BEFORE INSERT ON `fiscal_periods`
FOR EACH ROW
BEGIN
IF EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.company_id = NEW.company_id
      AND NEW.period_start <= fp.period_end
      AND NEW.period_end >= fp.period_start
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FISCAL_PERIOD_OVERLAP';
  END IF;
END;

CREATE TRIGGER `trg_fiscal_periods_no_overlap_upd` BEFORE UPDATE ON `fiscal_periods`
FOR EACH ROW
BEGIN
IF EXISTS (
    SELECT 1 FROM fiscal_periods fp
    WHERE fp.company_id = NEW.company_id AND fp.id <> OLD.id
      AND NEW.period_start <= fp.period_end
      AND NEW.period_end >= fp.period_start
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FISCAL_PERIOD_OVERLAP';
  END IF;
END;

CREATE TRIGGER `trg_document_leases_no_overlap_ins` BEFORE INSERT ON `document_number_leases`
FOR EACH ROW
BEGIN
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
END;

CREATE TRIGGER `trg_document_leases_no_overlap_upd` BEFORE UPDATE ON `document_number_leases`
FOR EACH ROW
BEGIN
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
END;

CREATE TRIGGER `trg_journal_entries_immutable_upd` BEFORE UPDATE ON `journal_entries`
FOR EACH ROW
BEGIN
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
END;

CREATE TRIGGER `trg_journal_entries_immutable_del` BEFORE DELETE ON `journal_entries`
FOR EACH ROW
BEGIN
IF OLD.status = 'posted' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'POSTED_JOURNAL_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `trg_journallines_immutable_upd` BEFORE UPDATE ON `journal_lines`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_journallines_immutable_del` BEFORE DELETE ON `journal_lines`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_paymentallocations_immutable_upd` BEFORE UPDATE ON `payment_allocations`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_paymentallocations_immutable_del` BEFORE DELETE ON `payment_allocations`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_stockmovements_immutable_upd` BEFORE UPDATE ON `stock_movements`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_stockmovements_immutable_del` BEFORE DELETE ON `stock_movements`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_stockmovementbatches_immutable_upd` BEFORE UPDATE ON `stock_movement_batches`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_stockmovementbatches_immutable_del` BEFORE DELETE ON `stock_movement_batches`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_serialevents_immutable_upd` BEFORE UPDATE ON `serial_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_serialevents_immutable_del` BEFORE DELETE ON `serial_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_giftcardtransactions_immutable_upd` BEFORE UPDATE ON `gift_card_transactions`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_giftcardtransactions_immutable_del` BEFORE DELETE ON `gift_card_transactions`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_rewardpointtransactions_immutable_upd` BEFORE UPDATE ON `reward_point_transactions`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_rewardpointtransactions_immutable_del` BEFORE DELETE ON `reward_point_transactions`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_customeradvanceledger_immutable_upd` BEFORE UPDATE ON `customer_advance_ledger`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_customeradvanceledger_immutable_del` BEFORE DELETE ON `customer_advance_ledger`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_supplieradvanceledger_immutable_upd` BEFORE UPDATE ON `supplier_advance_ledger`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_supplieradvanceledger_immutable_del` BEFORE DELETE ON `supplier_advance_ledger`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_fixedassetdepreciation_immutable_upd` BEFORE UPDATE ON `fixed_asset_depreciation`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_fixedassetdepreciation_immutable_del` BEFORE DELETE ON `fixed_asset_depreciation`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_deliveryevents_immutable_upd` BEFORE UPDATE ON `delivery_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_deliveryevents_immutable_del` BEFORE DELETE ON `delivery_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_serviceevents_immutable_upd` BEFORE UPDATE ON `service_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_serviceevents_immutable_del` BEFORE DELETE ON `service_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_auditlogs_immutable_upd` BEFORE UPDATE ON `audit_logs`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_auditlogs_immutable_del` BEFORE DELETE ON `audit_logs`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_userroles_tenant_ins` BEFORE INSERT ON `user_roles`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM users a JOIN roles b ON b.company_id = a.company_id WHERE a.id = NEW.user_id AND b.id = NEW.role_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_userroles_tenant_upd` BEFORE UPDATE ON `user_roles`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM users a JOIN roles b ON b.company_id = a.company_id WHERE a.id = NEW.user_id AND b.id = NEW.role_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_userbranchaccess_tenant_ins` BEFORE INSERT ON `user_branch_access`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM users a JOIN branches b ON b.company_id = a.company_id WHERE a.id = NEW.user_id AND b.id = NEW.branch_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_userbranchaccess_tenant_upd` BEFORE UPDATE ON `user_branch_access`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM users a JOIN branches b ON b.company_id = a.company_id WHERE a.id = NEW.user_id AND b.id = NEW.branch_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_taxcodecomponents_tenant_ins` BEFORE INSERT ON `tax_code_components`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM tax_codes a JOIN tax_components b ON b.company_id = a.company_id WHERE a.id = NEW.tax_code_id AND b.id = NEW.tax_component_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_taxcodecomponents_tenant_upd` BEFORE UPDATE ON `tax_code_components`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM tax_codes a JOIN tax_components b ON b.company_id = a.company_id WHERE a.id = NEW.tax_code_id AND b.id = NEW.tax_component_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_stockadjustmentitemserials_tenant_ins` BEFORE INSERT ON `stock_adjustment_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM stock_adjustment_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.stock_adjustment_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_stockadjustmentitemserials_tenant_upd` BEFORE UPDATE ON `stock_adjustment_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM stock_adjustment_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.stock_adjustment_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_purchasereceivingitemserials_tenant_ins` BEFORE INSERT ON `purchase_receiving_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM purchase_receiving_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.purchase_receiving_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_purchasereceivingitemserials_tenant_upd` BEFORE UPDATE ON `purchase_receiving_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM purchase_receiving_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.purchase_receiving_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_landedcostallocations_tenant_ins` BEFORE INSERT ON `landed_cost_allocations`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM landed_cost_documents a JOIN purchase_items b ON b.company_id = a.company_id WHERE a.id = NEW.landed_cost_document_id AND b.id = NEW.purchase_item_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_landedcostallocations_tenant_upd` BEFORE UPDATE ON `landed_cost_allocations`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM landed_cost_documents a JOIN purchase_items b ON b.company_id = a.company_id WHERE a.id = NEW.landed_cost_document_id AND b.id = NEW.purchase_item_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_purchasereturnitemserials_tenant_ins` BEFORE INSERT ON `purchase_return_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM purchase_return_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.purchase_return_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_purchasereturnitemserials_tenant_upd` BEFORE UPDATE ON `purchase_return_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM purchase_return_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.purchase_return_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_transferitemserials_tenant_ins` BEFORE INSERT ON `transfer_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM transfer_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.transfer_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_transferitemserials_tenant_upd` BEFORE UPDATE ON `transfer_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM transfer_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.transfer_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_saleitemserials_tenant_ins` BEFORE INSERT ON `sale_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM sale_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.sale_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_saleitemserials_tenant_upd` BEFORE UPDATE ON `sale_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM sale_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.sale_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_salereturnitemserials_tenant_ins` BEFORE INSERT ON `sale_return_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM sale_return_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.sale_return_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_salereturnitemserials_tenant_upd` BEFORE UPDATE ON `sale_return_item_serials`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM sale_return_items a JOIN product_serials b ON b.company_id = a.company_id WHERE a.id = NEW.sale_return_item_id AND b.id = NEW.serial_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_couriercodsettlementitems_tenant_ins` BEFORE INSERT ON `courier_cod_settlement_items`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM courier_cod_settlements a JOIN delivery_orders b ON b.company_id = a.company_id WHERE a.id = NEW.settlement_id AND b.id = NEW.delivery_order_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_couriercodsettlementitems_tenant_upd` BEFORE UPDATE ON `courier_cod_settlement_items`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM courier_cod_settlements a JOIN delivery_orders b ON b.company_id = a.company_id WHERE a.id = NEW.settlement_id AND b.id = NEW.delivery_order_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_usernotifications_tenant_ins` BEFORE INSERT ON `user_notifications`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM notifications a JOIN users b ON b.company_id = a.company_id WHERE a.id = NEW.notification_id AND b.id = NEW.user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

CREATE TRIGGER `trg_usernotifications_tenant_upd` BEFORE UPDATE ON `user_notifications`
FOR EACH ROW
BEGIN
IF NOT EXISTS (SELECT 1 FROM notifications a JOIN users b ON b.company_id = a.company_id WHERE a.id = NEW.notification_id AND b.id = NEW.user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TENANT_VIOLATION';
  END IF;
END;

