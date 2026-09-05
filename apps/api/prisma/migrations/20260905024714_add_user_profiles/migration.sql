-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('PROMISE', 'VISION', 'DOMAINS', 'REALITY', 'TIME', 'HEALTH_BASELINE', 'COACHING_STYLE', 'PROPOSAL', 'NOTIFICATIONS', 'DONE');

-- CreateEnum
CREATE TYPE "CoachingStyle" AS ENUM ('GENTLE', 'BALANCED', 'DIRECT');

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "onboarding_step" "OnboardingStep" NOT NULL DEFAULT 'PROMISE',
    "onboarding_completed_at" TIMESTAMPTZ,
    "coaching_style" "CoachingStyle" NOT NULL DEFAULT 'BALANCED',
    "weekday_minutes" INTEGER,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "obstacles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "six_month_vision" TEXT,
    "selected_domains" "Domain"[] DEFAULT ARRAY[]::"Domain"[],
    "domain_reflections" JSONB,
    "health_baseline" JSONB,
    "pending_proposal" JSONB,
    "confidence_score" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "user_profiles_onboarding_step_idx" ON "user_profiles"("onboarding_step");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
