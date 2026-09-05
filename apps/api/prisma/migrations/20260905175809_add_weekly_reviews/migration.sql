-- CreateEnum
CREATE TYPE "WeeklyReviewStatus" AS ENUM ('GENERATING', 'READY', 'APPROVED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WeeklyPlanStatus" AS ENUM ('DRAFT', 'APPROVED');

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "weekly_review_time" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "weekly_review_weekday" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "weekly_reviews" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start" VARCHAR(10) NOT NULL,
    "status" "WeeklyReviewStatus" NOT NULL DEFAULT 'GENERATING',
    "aggregates" JSONB NOT NULL DEFAULT '{}',
    "ai_summary" JSONB,
    "proposal_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invocation_id" TEXT,
    "generated_at" TIMESTAMPTZ,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weekly_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "week_start" VARCHAR(10) NOT NULL,
    "review_id" UUID,
    "primary_focus" TEXT,
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "domain_modes" JSONB NOT NULL DEFAULT '{}',
    "proposal" JSONB,
    "status" "WeeklyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weekly_reviews_user_id_status_idx" ON "weekly_reviews"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_reviews_user_id_week_start_key" ON "weekly_reviews"("user_id", "week_start");

-- CreateIndex
CREATE INDEX "weekly_plans_user_id_status_idx" ON "weekly_plans"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_plans_user_id_week_start_key" ON "weekly_plans"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plans" ADD CONSTRAINT "weekly_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_plans" ADD CONSTRAINT "weekly_plans_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "weekly_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The range Prisma cannot express. A weekday outside 0-6 does not fail loudly:
-- the hourly sweep simply never matches it, so the user's review silently
-- stops being prepared. Introspection ignores check constraints, so this is
-- not reported as drift by a later `migrate dev`.
ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_weekly_review_weekday_range"
  CHECK ("weekly_review_weekday" BETWEEN 0 AND 6);
