-- CreateEnum
CREATE TYPE "CommitmentVersion" AS ENUM ('FULL', 'SHORT', 'MINIMUM');

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "active_seconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "active_since" TIMESTAMPTZ,
ADD COLUMN     "decomposed_from_id" UUID,
ADD COLUMN     "full_minutes" INTEGER,
ADD COLUMN     "minimum_minutes" INTEGER,
ADD COLUMN     "minutes_spent" INTEGER,
ADD COLUMN     "short_minutes" INTEGER,
ADD COLUMN     "skip_note" TEXT,
ADD COLUMN     "steps" JSONB,
ADD COLUMN     "timer_minutes" INTEGER,
ADD COLUMN     "version_used" "CommitmentVersion";

-- CreateIndex
CREATE INDEX "commitments_user_id_status_active_since_idx" ON "commitments"("user_id", "status", "active_since");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_decomposed_from_id_fkey" FOREIGN KEY ("decomposed_from_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
