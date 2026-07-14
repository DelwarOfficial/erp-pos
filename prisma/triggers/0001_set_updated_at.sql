-- prisma/triggers/0001_set_updated_at.sql
-- Auto-update updated_at on every UPDATE.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Apply to every table with updated_at
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_cashier_device_pins_updated_at
  BEFORE UPDATE ON cashier_device_pins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_configuration_values_updated_at
  BEFORE UPDATE ON configuration_values
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_translation_overrides_updated_at
  BEFORE UPDATE ON translation_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_dashboard_preferences_updated_at
  BEFORE UPDATE ON dashboard_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_refresh_tokens_updated_at
  BEFORE UPDATE ON refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
