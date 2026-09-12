-- Forward-only: preserve original session identity and MFA assurance on rotation.
-- Legacy families have no recorded assurance: force reauthentication instead of
-- promoting password-only/unknown sessions to MFA-verified during refresh.
ALTER TABLE `refresh_tokens`
  ADD COLUMN `session_id` VARCHAR(191) NULL,
  ADD COLUMN `mfa_verified` BOOLEAN NOT NULL DEFAULT false;

UPDATE `refresh_tokens`
SET `revoked_at` = CURRENT_TIMESTAMP(3), `revoke_reason` = 'session_assurance_upgrade'
WHERE `revoked_at` IS NULL;
