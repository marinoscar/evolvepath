-- CreateEnum
CREATE TYPE "notification_interaction_kind" AS ENUM ('SENT', 'OPENED', 'ACTIONED', 'DISMISSED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "notification_action_kind" AS ENUM ('START', 'IN', 'MOVE', 'SHORT', 'SKIP');

-- CreateEnum
CREATE TYPE "notification_suppress_reason" AS ENUM ('QUIET_HOURS', 'DAILY_CAP', 'WEEKLY_CAP', 'PER_COMMITMENT_MAX', 'SKIPPED', 'MUTED', 'DOMAIN_PAUSED', 'FATIGUE', 'ALREADY_DONE');

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "notification_policy" JSONB;

-- CreateTable
CREATE TABLE "notification_interactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" "notification_interaction_kind" NOT NULL,
    "commitment_id" UUID,
    "notification_id" UUID,
    "delivery_id" UUID,
    "sent_interaction_id" UUID,
    "action" "notification_action_kind",
    "suppress_reason" "notification_suppress_reason",
    "dedupe_key" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_interactions_user_id_kind_created_at_idx" ON "notification_interactions"("user_id", "kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_interactions_user_id_commitment_id_kind_idx" ON "notification_interactions"("user_id", "commitment_id", "kind");

-- CreateIndex
CREATE INDEX "notification_interactions_sent_interaction_id_idx" ON "notification_interactions"("sent_interaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_interactions_user_id_event_key_dedupe_key_key" ON "notification_interactions"("user_id", "event_key", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "notification_interactions" ADD CONSTRAINT "notification_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_interactions" ADD CONSTRAINT "notification_interactions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_interactions" ADD CONSTRAINT "notification_interactions_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_interactions" ADD CONSTRAINT "notification_interactions_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "notification_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_interactions" ADD CONSTRAINT "notification_interactions_sent_interaction_id_fkey" FOREIGN KEY ("sent_interaction_id") REFERENCES "notification_interactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
