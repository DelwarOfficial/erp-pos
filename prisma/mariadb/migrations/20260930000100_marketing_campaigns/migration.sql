-- Marketing SMS campaigns on the SMS gateway (blueprint §5.11A, docs/adr/0008-due-reminders.md).
--
-- A campaign's messages are ordinary outbound_messages (trigger_source
-- 'campaign', purpose 'marketing'), one per campaign recipient, sent by the
-- same claim-and-revalidate path as reminders. Only customers whose latest
-- marketing SMS consent is 'granted' are messaged.
--
-- Additive: new nullable columns, a unique index, foreign keys and CHECKs.

-- AlterTable
ALTER TABLE `communication_campaigns` ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    ADD COLUMN `completed_at` DATETIME(3) NULL,
    ADD COLUMN `locale` VARCHAR(191) NOT NULL DEFAULT 'bn',
    ADD COLUMN `started_at` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `outbound_messages_campaign_recipient_id_key` ON `outbound_messages`(`campaign_recipient_id`);

-- AddForeignKey
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_campaign_recipient_id_fkey` FOREIGN KEY (`campaign_recipient_id`) REFERENCES `communication_campaign_recipients`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- ── Tenant consistency ──
ALTER TABLE `communication_campaign_recipients` ADD UNIQUE INDEX `uq_tenant_communication_campaign_recipients_id` (`company_id`, `id`);
ALTER TABLE `outbound_messages` ADD CONSTRAINT `fk_tenant_outbound_messages_campaign_recipient` FOREIGN KEY (`company_id`, `campaign_recipient_id`) REFERENCES `communication_campaign_recipients` (`company_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── Invariants ──
ALTER TABLE `outbound_messages` DROP CONSTRAINT `outbound_messages_trigger_chk`;
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_trigger_chk` CHECK (`trigger_source` IN ('reminder', 'manual', 'bulk', 'campaign'));
-- A campaign message always names its recipient, and only campaign messages do.
ALTER TABLE `outbound_messages` ADD CONSTRAINT `outbound_messages_campaign_link_chk`
  CHECK ((`trigger_source` = 'campaign') = (`campaign_recipient_id` IS NOT NULL));
ALTER TABLE `communication_campaigns` ADD CONSTRAINT `communication_campaigns_status_chk`
  CHECK (`status` IN ('draft', 'scheduled', 'running', 'completed', 'cancelled', 'failed'));
ALTER TABLE `communication_campaigns` ADD CONSTRAINT `communication_campaigns_locale_chk` CHECK (`locale` IN ('bn', 'en'));
ALTER TABLE `communication_campaign_recipients` ADD CONSTRAINT `communication_campaign_recipients_status_chk`
  CHECK (`status` IN ('queued', 'sent', 'delivered', 'failed', 'skipped'));
