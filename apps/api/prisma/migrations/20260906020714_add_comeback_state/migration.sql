-- CreateEnum
CREATE TYPE "comeback_state" AS ENUM ('NONE', 'OFFERED', 'IN_PROGRESS');

-- CreateEnum
CREATE TYPE "comeback_trigger" AS ENUM ('INACTIVITY', 'REPEATED_MISSES');

-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "comeback_commitment_id" UUID,
ADD COLUMN     "comeback_offered_at" TIMESTAMPTZ,
ADD COLUMN     "comeback_state" "comeback_state" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "comeback_trigger" "comeback_trigger",
ADD COLUMN     "last_active_at" TIMESTAMPTZ,
ADD COLUMN     "last_sweep_at" TIMESTAMPTZ,
ADD COLUMN     "plan_review_suggested_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "user_profiles_comeback_state_idx" ON "user_profiles"("comeback_state");

-- CreateIndex
CREATE INDEX "user_profiles_last_active_at_idx" ON "user_profiles"("last_active_at");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_comeback_commitment_id_fkey" FOREIGN KEY ("comeback_commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
