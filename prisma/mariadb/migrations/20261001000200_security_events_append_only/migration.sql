-- F-59 (docs/audits/2026-09-21-full-bug-hunt.md): security_events is the
-- forensic record of authentication failures, cross-tenant idempotency reuse,
-- unverified webhooks and outbox dead-letters. It was hard-deleted on a rolling
-- window by the retention job. Like audit_logs, it is now append-only: rows can
-- be neither edited nor removed through the application's database login.
-- Archiving and purging old rows is a separately privileged workflow.

CREATE TRIGGER `trg_security_events_immutable_upd` BEFORE UPDATE ON `security_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;

CREATE TRIGGER `trg_security_events_immutable_del` BEFORE DELETE ON `security_events`
FOR EACH ROW
BEGIN
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE_LEDGER';
END;
