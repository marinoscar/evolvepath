-- CreateEnum
CREATE TYPE "WorkSessionPlanSource" AS ENUM ('AI', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "WorkSessionPlanStatus" AS ENUM ('PROPOSED', 'APPLIED', 'DISCARDED', 'EXPIRED');

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "work_milestone_id" UUID;

-- CreateTable
CREATE TABLE "work_milestones" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "outcome_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "target_date" DATE,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_session_plan_proposals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "outcome_id" UUID NOT NULL,
    "source" "WorkSessionPlanSource" NOT NULL,
    "status" "WorkSessionPlanStatus" NOT NULL DEFAULT 'PROPOSED',
    "plan" JSONB NOT NULL,
    "applied_plan" JSONB,
    "invocation_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "applied_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_session_plan_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_milestones_user_id_outcome_id_idx" ON "work_milestones"("user_id", "outcome_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_milestones_outcome_id_order_key" ON "work_milestones"("outcome_id", "order");

-- CreateIndex
CREATE INDEX "work_session_plan_proposals_user_id_outcome_id_status_idx" ON "work_session_plan_proposals"("user_id", "outcome_id", "status");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_work_milestone_id_fkey" FOREIGN KEY ("work_milestone_id") REFERENCES "work_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_milestones" ADD CONSTRAINT "work_milestones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_milestones" ADD CONSTRAINT "work_milestones_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_session_plan_proposals" ADD CONSTRAINT "work_session_plan_proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_session_plan_proposals" ADD CONSTRAINT "work_session_plan_proposals_outcome_id_fkey" FOREIGN KEY ("outcome_id") REFERENCES "outcomes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
