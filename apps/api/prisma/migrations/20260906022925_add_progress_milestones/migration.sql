-- CreateEnum
CREATE TYPE "milestone_kind" AS ENUM ('FIRST_FULL_WEEK', 'FOUR_WEEKS', 'TEN_WORKOUTS', 'FIRST_COMEBACK', 'REDUCED_REMINDERS', 'FIRST_START_AFTER_POSTPONE');

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "milestone_kind" NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "domain" "Domain",
    "achieved_at" TIMESTAMPTZ NOT NULL,
    "meta" JSONB,
    "acknowledged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_user_id_achieved_at_idx" ON "milestones"("user_id", "achieved_at" DESC);

-- CreateIndex
CREATE INDEX "milestones_user_id_acknowledged_at_idx" ON "milestones"("user_id", "acknowledged_at");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_user_id_kind_sequence_key" ON "milestones"("user_id", "kind", "sequence");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
