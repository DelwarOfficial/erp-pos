-- prisma/migrations/0006_catalogue_pricing_tax.sql
-- §5.4 Catalogue, Pricing, and Tax

BEGIN;

-- ============================================================================
-- categories (hierarchical)
-- ============================================================================
CREATE TABLE categories (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  parent_id  UUID         REFERENCES categories(id),
  name       VARCHAR(120) NOT NULL,
  code       VARCHAR(40)  NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_categories_company ON categories(company_id);
CREATE INDEX idx_categories_parent  ON categories(parent_id);
CREATE INDEX idx_categories_active  ON categories(is_active);
CREATE UNIQUE INDEX idx_categories_company_code
  ON categories(company_id, code)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_categories_company_parent_name
  ON categories(company_id, parent_id, name)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- brands
-- ============================================================================
CREATE TABLE brands (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name       VARCHAR(120) NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_brands_company ON brands(company_id);
CREATE UNIQUE INDEX idx_brands_company_name
  ON brands(company_id, name)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- units
-- ============================================================================
CREATE TABLE units (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name              VARCHAR(80)  NOT NULL,
  code              VARCHAR(20)  NOT NULL,
  base_unit_id      UUID         REFERENCES units(id),
  conversion_factor DECIMAL(18,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  allow_fractional  BOOLEAN      NOT NULL DEFAULT false,
  UNIQUE(company_id, code)
);
CREATE INDEX idx_units_company   ON units(company_id);
CREATE INDEX idx_units_base_unit ON units(base_unit_id);

-- ============================================================================
-- customer_groups
-- ============================================================================
CREATE TABLE customer_groups (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name                  VARCHAR(100) NOT NULL,
  default_discount_rate DECIMAL(9,6) NOT NULL DEFAULT 0
                        CHECK (default_discount_rate BETWEEN 0 AND 100),
  credit_limit_default  DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (credit_limit_default >= 0),
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE(company_id, name)
);
CREATE INDEX idx_customer_groups_company ON customer_groups(company_id);

-- ============================================================================
-- products
-- ============================================================================
CREATE TABLE products (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name                   VARCHAR(255) NOT NULL,
  code                   VARCHAR(60)  NOT NULL,
  category_id            UUID         NOT NULL REFERENCES categories(id),
  brand_id               UUID         REFERENCES brands(id),
  unit_id                UUID         NOT NULL REFERENCES units(id),
  product_type           VARCHAR(20)  NOT NULL DEFAULT 'standard'
                         CHECK (product_type IN ('standard','combo','service','digital')),
  is_serialized          BOOLEAN      NOT NULL DEFAULT false,
  track_batches          BOOLEAN      NOT NULL DEFAULT false,
  warranty_period_months SMALLINT     CHECK (warranty_period_months IS NULL OR warranty_period_months >= 0),
  reference_cost         DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (reference_cost >= 0),
  default_price          DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (default_price >= 0),
  default_tax_code_id    UUID,  -- FK added below
  alert_quantity         DECIMAL(18,4) NOT NULL DEFAULT 0 CHECK (alert_quantity >= 0),
  short_description      VARCHAR(500),
  description            TEXT,
  is_featured            BOOLEAN      NOT NULL DEFAULT false,
  is_active              BOOLEAN      NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_products_company_code
  ON products(company_id, code)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_products_company   ON products(company_id);
CREATE INDEX idx_products_category  ON products(category_id);
CREATE INDEX idx_products_brand     ON products(brand_id);
CREATE INDEX idx_products_unit      ON products(unit_id);
CREATE INDEX idx_products_type      ON products(product_type);
CREATE INDEX idx_products_serial    ON products(is_serialized);
CREATE INDEX idx_products_batches   ON products(track_batches);
CREATE INDEX idx_products_featured  ON products(is_featured);
CREATE INDEX idx_products_active    ON products(is_active);
CREATE INDEX idx_products_deleted   ON products(deleted_at);
-- Trigram index for fast name search (Bangla + English)
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);

-- ============================================================================
-- tax_codes (forward reference for products.default_tax_code_id)
-- ============================================================================
CREATE TABLE tax_codes (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code              VARCHAR(40)  NOT NULL,
  name              VARCHAR(120) NOT NULL,
  price_includes_tax BOOLEAN     NOT NULL DEFAULT false,
  effective_from    DATE         NOT NULL,
  effective_to      DATE         CHECK (effective_to IS NULL OR effective_to >= effective_from),
  is_active         BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE(company_id, code)
);
CREATE INDEX idx_tax_codes_company  ON tax_codes(company_id);
CREATE INDEX idx_tax_codes_from     ON tax_codes(effective_from);
CREATE INDEX idx_tax_codes_to       ON tax_codes(effective_to);
CREATE INDEX idx_tax_codes_active   ON tax_codes(is_active);

-- Now add the FK
ALTER TABLE products
  ADD CONSTRAINT fk_products_default_tax_code
  FOREIGN KEY (default_tax_code_id) REFERENCES tax_codes(id);

-- ============================================================================
-- tax_components
-- ============================================================================
CREATE TABLE tax_components (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  component_code      VARCHAR(30)  NOT NULL,
  name                VARCHAR(100) NOT NULL,
  component_type      VARCHAR(20)  NOT NULL DEFAULT 'VAT'
                      CHECK (component_type IN ('VAT','SD','RD','ATV','OTHER')),
  rate                DECIMAL(9,6) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  calculation_order   SMALLINT     NOT NULL DEFAULT 1,
  compound_on_previous BOOLEAN     NOT NULL DEFAULT false,
  input_account_id    UUID,  -- FK to chart_of_accounts added in M4
  output_account_id   UUID,
  effective_from      DATE         NOT NULL,
  effective_to        DATE,
  UNIQUE(company_id, component_code)
);
CREATE INDEX idx_tax_components_company ON tax_components(company_id);
CREATE INDEX idx_tax_components_type    ON tax_components(component_type);

-- ============================================================================
-- tax_code_components
-- ============================================================================
CREATE TABLE tax_code_components (
  tax_code_id      UUID NOT NULL REFERENCES tax_codes(id) ON DELETE CASCADE,
  tax_component_id UUID NOT NULL REFERENCES tax_components(id) ON DELETE RESTRICT,
  PRIMARY KEY (tax_code_id, tax_component_id)
);
CREATE INDEX idx_tax_code_components_component ON tax_code_components(tax_component_id);

-- ============================================================================
-- media_assets
-- ============================================================================
CREATE TABLE media_assets (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  object_key       VARCHAR(700) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type        VARCHAR(120) NOT NULL,
  size_bytes       BIGINT       NOT NULL CHECK (size_bytes >= 0),
  sha256           CHAR(64)     NOT NULL,
  width_px         INTEGER      CHECK (width_px IS NULL OR width_px > 0),
  height_px        INTEGER      CHECK (height_px IS NULL OR height_px > 0),
  alt_text         VARCHAR(500),
  scan_status      VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (scan_status IN ('pending','clean','quarantined','rejected')),
  created_by       UUID         NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  UNIQUE(company_id, object_key)
);
CREATE INDEX idx_media_assets_company  ON media_assets(company_id);
CREATE INDEX idx_media_assets_mime     ON media_assets(mime_type);
CREATE INDEX idx_media_assets_sha      ON media_assets(sha256);
CREATE INDEX idx_media_assets_scan     ON media_assets(scan_status);
CREATE INDEX idx_media_assets_deleted  ON media_assets(deleted_at);

-- ============================================================================
-- entity_media_links
-- ============================================================================
CREATE TABLE entity_media_links (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  media_asset_id UUID        NOT NULL REFERENCES media_assets(id),
  entity_type   VARCHAR(40)  NOT NULL
                CHECK (entity_type IN ('company','branch','product','category','brand','employee','service_request','support_ticket','expense')),
  entity_id     UUID         NOT NULL,
  media_role    VARCHAR(30)  NOT NULL
                CHECK (media_role IN ('logo','primary','gallery','document','receipt','evidence','attachment')),
  sort_order    SMALLINT     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, entity_type, entity_id, media_asset_id, media_role)
);
CREATE INDEX idx_entity_media_company ON entity_media_links(company_id);
CREATE INDEX idx_entity_media_asset   ON entity_media_links(media_asset_id);
CREATE INDEX idx_entity_media_type    ON entity_media_links(entity_type);
CREATE INDEX idx_entity_media_entity  ON entity_media_links(entity_id);
CREATE INDEX idx_entity_media_role    ON entity_media_links(media_role);

-- ============================================================================
-- product_barcodes
-- Partial unique: at most one primary barcode per product.
-- ============================================================================
CREATE TABLE product_barcodes (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id       UUID         NOT NULL REFERENCES products(id),
  code             VARCHAR(100) NOT NULL,
  symbology        VARCHAR(20)  NOT NULL DEFAULT 'CODE128'
                   CHECK (symbology IN ('CODE128','CODE39','EAN8','EAN13','UPCA','QR')),
  unit_id          UUID         REFERENCES units(id),
  package_quantity DECIMAL(18,4) NOT NULL DEFAULT 1 CHECK (package_quantity > 0),
  is_primary       BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(company_id, code)
);
CREATE INDEX idx_product_barcodes_company ON product_barcodes(company_id);
CREATE INDEX idx_product_barcodes_product ON product_barcodes(product_id);
CREATE INDEX idx_product_barcodes_symb    ON product_barcodes(symbology);
CREATE INDEX idx_product_barcodes_unit    ON product_barcodes(unit_id);
CREATE INDEX idx_product_barcodes_primary ON product_barcodes(is_primary);
CREATE UNIQUE INDEX idx_product_barcodes_primary_per_product
  ON product_barcodes(product_id)
  WHERE is_primary = true;

-- ============================================================================
-- product_unit_options
-- Composite PK + two partial uniques (default_purchase / default_sale)
-- ============================================================================
CREATE TABLE product_unit_options (
  company_id              UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id              UUID         NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  unit_id                 UUID         NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  conversion_to_stock_unit DECIMAL(18,6) NOT NULL CHECK (conversion_to_stock_unit > 0),
  can_purchase            BOOLEAN      NOT NULL DEFAULT false,
  can_sell                BOOLEAN      NOT NULL DEFAULT false,
  is_default_purchase     BOOLEAN      NOT NULL DEFAULT false,
  is_default_sale         BOOLEAN      NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, product_id, unit_id)
);
CREATE INDEX idx_product_unit_options_product ON product_unit_options(product_id);
CREATE INDEX idx_product_unit_options_unit    ON product_unit_options(unit_id);
CREATE UNIQUE INDEX idx_product_unit_options_default_purchase
  ON product_unit_options(product_id)
  WHERE is_default_purchase = true;
CREATE UNIQUE INDEX idx_product_unit_options_default_sale
  ON product_unit_options(product_id)
  WHERE is_default_sale = true;

-- Tenant-consistency CHECK: product and unit belong to same company.
-- Implemented via triggers in 0008_triggers.sql (CHECK with subqueries not supported).

-- ============================================================================
-- product_combo_items
-- CHECK: combo_product_id <> component_product_id
-- Tenant-consistency: all 3 IDs same company (trigger)
-- ============================================================================
CREATE TABLE product_combo_items (
  company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  combo_product_id    UUID         NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  component_product_id UUID        NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  component_quantity  DECIMAL(18,4) NOT NULL CHECK (component_quantity > 0),
  component_unit_id   UUID         NOT NULL REFERENCES units(id),
  allow_substitution  BOOLEAN      NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, combo_product_id, component_product_id),
  CHECK (combo_product_id <> component_product_id)
);
CREATE INDEX idx_product_combo_items_combo      ON product_combo_items(combo_product_id);
CREATE INDEX idx_product_combo_items_component  ON product_combo_items(component_product_id);
CREATE INDEX idx_product_combo_items_unit       ON product_combo_items(component_unit_id);

-- ============================================================================
-- discount_policies
-- ============================================================================
CREATE TABLE discount_policies (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name                VARCHAR(150) NOT NULL,
  discount_type       VARCHAR(20)  NOT NULL CHECK (discount_type IN ('percentage','fixed')),
  value               DECIMAL(18,6) NOT NULL DEFAULT 0 CHECK (value >= 0),
  max_discount_amount DECIMAL(18,2) CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  product_id          UUID         REFERENCES products(id),
  category_id         UUID         REFERENCES categories(id),
  customer_group_id   UUID         REFERENCES customer_groups(id),
  branch_id           UUID         REFERENCES branches(id),
  valid_from          TIMESTAMPTZ  NOT NULL,
  valid_to            TIMESTAMPTZ  CHECK (valid_to IS NULL OR valid_to > valid_from),
  priority            SMALLINT     NOT NULL DEFAULT 0,
  combinable          BOOLEAN      NOT NULL DEFAULT false,
  is_active           BOOLEAN      NOT NULL DEFAULT true
);
CREATE INDEX idx_discount_policies_company  ON discount_policies(company_id);
CREATE INDEX idx_discount_policies_product  ON discount_policies(product_id);
CREATE INDEX idx_discount_policies_category ON discount_policies(category_id);
CREATE INDEX idx_discount_policies_group    ON discount_policies(customer_group_id);
CREATE INDEX idx_discount_policies_branch   ON discount_policies(branch_id);
CREATE INDEX idx_discount_policies_from     ON discount_policies(valid_from);
CREATE INDEX idx_discount_policies_to       ON discount_policies(valid_to);
CREATE INDEX idx_discount_policies_active   ON discount_policies(is_active);

-- ============================================================================
-- product_prices
-- UNIQUE includes all 6 columns (with nullable branch_id/customer_group_id)
-- ============================================================================
CREATE TABLE product_prices (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  product_id       UUID         NOT NULL REFERENCES products(id),
  branch_id        UUID         REFERENCES branches(id),
  customer_group_id UUID        REFERENCES customer_groups(id),
  currency_code    CHAR(3)      NOT NULL REFERENCES currencies(code),
  price            DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  valid_from       TIMESTAMPTZ  NOT NULL,
  valid_to         TIMESTAMPTZ  CHECK (valid_to IS NULL OR valid_to > valid_from),
  priority         SMALLINT     NOT NULL DEFAULT 0,
  UNIQUE(company_id, product_id, branch_id, customer_group_id, currency_code, valid_from)
);
CREATE INDEX idx_product_prices_company ON product_prices(company_id);
CREATE INDEX idx_product_prices_product ON product_prices(product_id);
CREATE INDEX idx_product_prices_branch  ON product_prices(branch_id);
CREATE INDEX idx_product_prices_group   ON product_prices(customer_group_id);
CREATE INDEX idx_product_prices_from    ON product_prices(valid_from);
CREATE INDEX idx_product_prices_to      ON product_prices(valid_to);

-- ============================================================================
-- withholding_rules
-- ============================================================================
CREATE TABLE withholding_rules (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID         NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code              VARCHAR(40)  NOT NULL,
  withholding_type  VARCHAR(20)  NOT NULL DEFAULT 'TDS'
                    CHECK (withholding_type IN ('TDS','VDS','OTHER')),
  applies_to        VARCHAR(30)  NOT NULL DEFAULT 'supplier_payment'
                    CHECK (applies_to IN ('supplier_payment','customer_payment','expense')),
  rate              DECIMAL(9,6) NOT NULL DEFAULT 0 CHECK (rate BETWEEN 0 AND 100),
  minimum_base_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  payable_account_id UUID        NOT NULL,  -- FK to chart_of_accounts added in M4
  effective_from    DATE         NOT NULL,
  effective_to      DATE,
  conditions        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  is_active         BOOLEAN      NOT NULL DEFAULT true,
  UNIQUE(company_id, code)
);
CREATE INDEX idx_withholding_rules_company ON withholding_rules(company_id);
CREATE INDEX idx_withholding_rules_type    ON withholding_rules(withholding_type);
CREATE INDEX idx_withholding_rules_applies ON withholding_rules(applies_to);
CREATE INDEX idx_withholding_rules_from    ON withholding_rules(effective_from);
CREATE INDEX idx_withholding_rules_to      ON withholding_rules(effective_to);
CREATE INDEX idx_withholding_rules_active  ON withholding_rules(is_active);
CREATE INDEX idx_withholding_rules_cond    ON withholding_rules USING GIN (conditions);

COMMIT;
