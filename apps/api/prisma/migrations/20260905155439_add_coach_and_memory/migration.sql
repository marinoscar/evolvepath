-- CreateEnum
CREATE TYPE "CoachMessageRole" AS ENUM ('USER', 'COACH', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProposalSourceKind" AS ENUM ('COACH', 'WEEKLY_REVIEW', 'WORKOUT', 'PATTERN');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'EDITED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MemoryInsightCategory" AS ENUM ('IDENTITY', 'WORK', 'FAMILY', 'HEALTH', 'COACHING_PREFERENCE', 'NOTIFICATION_PREFERENCE', 'PATTERN');

-- CreateEnum
CREATE TYPE "MemoryInsightSource" AS ENUM ('AI', 'USER');

-- CreateEnum
CREATE TYPE "ObstacleType" AS ENUM ('EVENING_WORKOUT_UNRELIABLE', 'AMBIGUOUS_WORK_TASK', 'FAMILY_PLAN_COLLIDES_WITH_WORK', 'OVERCOMMITMENT', 'PERFECTIONISM', 'LOW_ENERGY_WINDOW', 'OTHER');

-- CreateTable
CREATE TABLE "coach_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "CoachMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "structured" JSONB,
    "attachment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invocation_id" UUID,
    "safety_decision" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_change_proposals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "source_kind" "ProposalSourceKind" NOT NULL,
    "source_message_id" UUID,
    "summary" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "original_changes" JSONB,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "applied_plan_version_id" UUID,
    "invocation_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "edited_at" TIMESTAMPTZ,
    "decided_at" TIMESTAMPTZ,
    "decision_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plan_change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_insights" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "MemoryInsightCategory" NOT NULL,
    "statement" TEXT NOT NULL,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL,
    "user_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "do_not_use" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ,
    "source" "MemoryInsightSource" NOT NULL,
    "invocation_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "memory_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obstacles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ObstacleType" NOT NULL,
    "description" TEXT NOT NULL,
    "domain" "Domain" NOT NULL,
    "observed_count" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL,
    "last_observed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intervention_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "obstacles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coach_conversations_user_id_last_message_at_idx" ON "coach_conversations"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "coach_messages_conversation_id_created_at_idx" ON "coach_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "plan_change_proposals_user_id_status_created_at_idx" ON "plan_change_proposals"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "plan_change_proposals_plan_id_idx" ON "plan_change_proposals"("plan_id");

-- CreateIndex
CREATE INDEX "memory_insights_user_id_category_idx" ON "memory_insights"("user_id", "category");

-- CreateIndex
CREATE INDEX "memory_insights_user_id_do_not_use_user_confirmed_idx" ON "memory_insights"("user_id", "do_not_use", "user_confirmed");

-- CreateIndex
CREATE INDEX "obstacles_user_id_domain_last_observed_at_idx" ON "obstacles"("user_id", "domain", "last_observed_at" DESC);

-- AddForeignKey
ALTER TABLE "coach_conversations" ADD CONSTRAINT "coach_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "coach_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_applied_plan_version_id_fkey" FOREIGN KEY ("applied_plan_version_id") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_insights" ADD CONSTRAINT "memory_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obstacles" ADD CONSTRAINT "obstacles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
