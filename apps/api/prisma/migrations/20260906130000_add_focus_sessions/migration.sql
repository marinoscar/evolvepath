-- CreateEnum
CREATE TYPE "FocusSessionOutcome" AS ENUM ('DONE', 'PARTIAL', 'ABANDONED');

-- CreateTable
CREATE TABLE "focus_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "planned_minutes" INTEGER NOT NULL,
    "instruction" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "outcome" "FocusSessionOutcome",
    "actual_minutes" INTEGER,
    "continued_count" INTEGER NOT NULL DEFAULT 0,
    "distraction_notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "focus_sessions_evidence_id_key" ON "focus_sessions"("evidence_id");

-- CreateIndex
CREATE INDEX "focus_sessions_user_id_started_at_idx" ON "focus_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "focus_sessions_commitment_id_idx" ON "focus_sessions"("commitment_id");

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "evidence_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
