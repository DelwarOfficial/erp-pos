-- When this session last passed a real MFA check (TOTP or passkey).
--
-- Step-up MFA used to trust a mfa_verified flag that refresh rotation copied
-- forward for the whole 30-day session, so a sensitive action never asked for
-- a code again (red-team workstream 5). Sensitive actions now need a check
-- within the last 60 minutes, read from this column, not from the token.
--
-- Structure only: one nullable column, no data change. Existing sessions have
-- no time, so their next sensitive action asks for a code.

ALTER TABLE `refresh_tokens` ADD COLUMN `mfa_verified_at` DATETIME(3) NULL AFTER `mfa_verified`;
