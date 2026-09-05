-- CreateEnum
CREATE TYPE "FamilyRelationship" AS ENUM ('PARTNER', 'CHILD', 'PARENT', 'SIBLING', 'FRIEND', 'OTHER');

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "family_member_id" UUID,
ADD COLUMN     "ritual_id" UUID;

-- CreateTable
CREATE TABLE "family_members" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "nickname" VARCHAR(40) NOT NULL,
    "relationship" "FamilyRelationship" NOT NULL,
    "birthday" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rituals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "purpose" VARCHAR(300),
    "family_member_id" UUID,
    "recurrence" JSONB NOT NULL,
    "ideal_minutes" INTEGER NOT NULL,
    "minimum_minutes" INTEGER NOT NULL,
    "fallback_behavior" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_materialized_through" DATE,
    "routine_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rituals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_members_user_id_idx" ON "family_members"("user_id");

-- CreateIndex
CREATE INDEX "rituals_user_id_active_idx" ON "rituals"("user_id", "active");

-- CreateIndex
CREATE INDEX "commitments_user_id_ritual_id_idx" ON "commitments"("user_id", "ritual_id");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_ritual_id_scheduled_start_key" ON "commitments"("ritual_id", "scheduled_start");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_ritual_id_fkey" FOREIGN KEY ("ritual_id") REFERENCES "rituals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

