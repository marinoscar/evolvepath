-- CreateEnum
CREATE TYPE "Domain" AS ENUM ('WORK', 'FAMILY', 'HEALTH');

-- CreateEnum
CREATE TYPE "OutcomeState" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlanAuthor" AS ENUM ('USER', 'AI');

-- CreateEnum
CREATE TYPE "RoutineTriggerType" AS ENUM ('TIME', 'EVENT');

-- CreateEnum
CREATE TYPE "RoutineFrequency" AS ENUM ('DAILY', 'WEEKDAYS', 'WEEKENDS', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('PLANNED', 'READY', 'STARTED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'RESCHEDULED', 'SKIPPED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('USER_LOG', 'TIMER', 'WORKOUT_LOG', 'APP_FLOW');

-- CreateEnum
CREATE TYPE "DomainModeKind" AS ENUM ('GROW', 'MAINTAIN', 'RECOVER', 'PAUSE');

-- CreateTable
CREATE TABLE "best_self_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "identity_statement" TEXT,
    "work_identity" TEXT,
    "family_identity" TEXT,
    "health_identity" TEXT,
    "six_month_vision" TEXT,
    "motivations" TEXT[],
    "reasons" TEXT[],
    "last_reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "best_self_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcomes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "domain" "Domain" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_date" DATE,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "motivation" TEXT,
    "state" "OutcomeState" NOT NULL DEFAULT 'ACTIVE',
    "success_definition" TEXT,
    "user_confidence" INTEGER,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "outcome_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "PlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "rationale" TEXT,
    "expected_weekly_load" INTEGER,
    "fallback_strategy" TEXT,
    "user_approved" BOOLEAN NOT NULL DEFAULT false,
    "created_by" "PlanAuthor" NOT NULL DEFAULT 'USER',
    "previous_version_id" UUID,
    "active_from" TIMESTAMPTZ,
    "active_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routines" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_version_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "domain" "Domain" NOT NULL,
    "trigger_type" "RoutineTriggerType" NOT NULL DEFAULT 'TIME',
    "trigger_value" TEXT,
    "frequency" "RoutineFrequency" NOT NULL DEFAULT 'WEEKDAYS',
    "days_of_week" INTEGER[],
    "preferred_time" TEXT,
    "estimated_duration_min" INTEGER NOT NULL,
    "minimum_duration_min" INTEGER NOT NULL,
    "fallback_behavior" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "domain" "Domain" NOT NULL,
    "title" TEXT NOT NULL,
    "outcome_id" UUID,
    "plan_version_id" UUID,
    "routine_id" UUID,
    "scheduled_start" TIMESTAMPTZ NOT NULL,
    "scheduled_end" TIMESTAMPTZ,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "commitment_type" TEXT,
    "full_version" TEXT,
    "short_version" TEXT,
    "minimum_version" TEXT,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'PLANNED',
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "rescheduled_from_id" UUID,
    "skip_reason" TEXT,
    "user_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "commitment_id" UUID,
    "evidence_type" TEXT NOT NULL,
    "source" "EvidenceSource" NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantitative_value" DOUBLE PRECISION,
    "quantitative_unit" TEXT,
    "qualitative_value" TEXT,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "evidence_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "related_type" TEXT NOT NULL,
    "related_id" UUID,
    "commitment_id" UUID,
    "user_text" TEXT,
    "ai_summary" TEXT,
    "friction_tags" TEXT[],
    "mood" INTEGER,
    "perceived_difficulty" INTEGER,
    "satisfaction" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reflections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_modes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "domain" "Domain" NOT NULL,
    "mode" "DomainModeKind" NOT NULL DEFAULT 'GROW',
    "reason" TEXT,
    "effective_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "domain_modes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "best_self_profiles_user_id_key" ON "best_self_profiles"("user_id");

-- CreateIndex
CREATE INDEX "outcomes_user_id_domain_idx" ON "outcomes"("user_id", "domain");

-- CreateIndex
CREATE INDEX "outcomes_user_id_state_idx" ON "outcomes"("user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "plans_outcome_id_key" ON "plans"("outcome_id");

-- CreateIndex
CREATE INDEX "plans_user_id_idx" ON "plans"("user_id");

-- CreateIndex
CREATE INDEX "plan_versions_user_id_idx" ON "plan_versions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_plan_id_version_key" ON "plan_versions"("plan_id", "version");

-- CreateIndex
CREATE INDEX "routines_plan_version_id_idx" ON "routines"("plan_version_id");

-- CreateIndex
CREATE INDEX "routines_user_id_idx" ON "routines"("user_id");

-- CreateIndex
CREATE INDEX "commitments_user_id_scheduled_start_idx" ON "commitments"("user_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "commitments_user_id_status_idx" ON "commitments"("user_id", "status");

-- CreateIndex
CREATE INDEX "commitments_plan_version_id_idx" ON "commitments"("plan_version_id");

-- CreateIndex
CREATE INDEX "evidence_items_user_id_occurred_at_idx" ON "evidence_items"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "evidence_items_commitment_id_idx" ON "evidence_items"("commitment_id");

-- CreateIndex
CREATE INDEX "reflections_user_id_created_at_idx" ON "reflections"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reflections_related_type_related_id_idx" ON "reflections"("related_type", "related_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_modes_user_id_domain_key" ON "domain_modes"("user_id", "domain");

-- AddForeignKey
ALTER TABLE "best_self_profiles" ADD CONSTRAINT "best_self_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_modes" ADD CONSTRAINT "domain_modes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One ACTIVE version per plan. Prisma cannot declare a partial index; its
-- introspection ignores partial indexes, so this statement is not reported
-- as drift by later `migrate dev` runs.
CREATE UNIQUE INDEX "plan_versions_one_active_per_plan"
  ON "plan_versions"("plan_id") WHERE "status" = 'ACTIVE';
