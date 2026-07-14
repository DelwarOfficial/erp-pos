-- prisma/triggers/0003_tenant_consistency_checks.sql
-- §16 tenant_consistency_checks()
--  Validates that FK references don't cross tenant boundaries.
--  CHECK constraints with subqueries are not supported in PostgreSQL, so
--  we enforce tenant consistency via BEFORE INSERT/UPDATE triggers.

CREATE OR REPLACE FUNCTION tenant_consistency_check() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_other_company UUID;
BEGIN
  -- Generic check: if NEW has a company_id and any FK that references another
  -- tenant-scoped table, verify the FK row belongs to the same company.
  -- This function is intentionally generic — per-table triggers below add
  -- specific checks.

  -- Example: products.category_id must belong to the same company as products
  IF TG_TABLE_NAME = 'products' AND NEW.category_id IS NOT NULL THEN
    SELECT company_id INTO v_other_company FROM categories WHERE id = NEW.category_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: products.category_id belongs to company %, not %',
        v_other_company, NEW.company_id USING ERRCODE = '42704';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'products' AND NEW.brand_id IS NOT NULL THEN
    SELECT company_id INTO v_other_company FROM brands WHERE id = NEW.brand_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: products.brand_id belongs to company %, not %',
        v_other_company, NEW.company_id USING ERRCODE = '42704';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'products' AND NEW.unit_id IS NOT NULL THEN
    SELECT company_id INTO v_other_company FROM units WHERE id = NEW.unit_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: products.unit_id belongs to company %, not %',
        v_other_company, NEW.company_id USING ERRCODE = '42704';
    END IF;
  END IF;

  -- product_combo_items: all 3 IDs must belong to the same company
  IF TG_TABLE_NAME = 'product_combo_items' THEN
    SELECT company_id INTO v_other_company FROM products WHERE id = NEW.combo_product_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: combo_product_id belongs to company %', v_other_company
        USING ERRCODE = '42704';
    END IF;
    SELECT company_id INTO v_other_company FROM products WHERE id = NEW.component_product_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: component_product_id belongs to company %', v_other_company
        USING ERRCODE = '42704';
    END IF;
    SELECT company_id INTO v_other_company FROM units WHERE id = NEW.component_unit_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: component_unit_id belongs to company %', v_other_company
        USING ERRCODE = '42704';
    END IF;
  END IF;

  -- product_unit_options: product and unit must belong to same company
  IF TG_TABLE_NAME = 'product_unit_options' THEN
    SELECT company_id INTO v_other_company FROM products WHERE id = NEW.product_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: product_unit_options.product_id' USING ERRCODE = '42704';
    END IF;
    SELECT company_id INTO v_other_company FROM units WHERE id = NEW.unit_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: product_unit_options.unit_id' USING ERRCODE = '42704';
    END IF;
  END IF;

  -- warehouses: branch must belong to same company
  IF TG_TABLE_NAME = 'warehouses' AND NEW.branch_id IS NOT NULL THEN
    SELECT company_id INTO v_other_company FROM branches WHERE id = NEW.branch_id;
    IF v_other_company IS NOT NULL AND v_other_company <> NEW.company_id THEN
      RAISE EXCEPTION 'Tenant consistency violation: warehouses.branch_id' USING ERRCODE = '42704';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_tenant_consistency
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION tenant_consistency_check();

CREATE TRIGGER trg_product_combo_items_tenant_consistency
  BEFORE INSERT OR UPDATE ON product_combo_items
  FOR EACH ROW EXECUTE FUNCTION tenant_consistency_check();

CREATE TRIGGER trg_product_unit_options_tenant_consistency
  BEFORE INSERT OR UPDATE ON product_unit_options
  FOR EACH ROW EXECUTE FUNCTION tenant_consistency_check();

CREATE TRIGGER trg_warehouses_tenant_consistency
  BEFORE INSERT OR UPDATE ON warehouses
  FOR EACH ROW EXECUTE FUNCTION tenant_consistency_check();
