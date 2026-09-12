-- Forward-only widening. Audit snapshots contain complete serialized objects:
-- a valid 170-character product name plus a 40-character code exceeds VARCHAR(191).
-- Preserve nullability and existing data; do not truncate or rewrite snapshots.
ALTER TABLE `audit_logs`
  MODIFY COLUMN `before_value` LONGTEXT NULL,
  MODIFY COLUMN `after_value` LONGTEXT NULL;
