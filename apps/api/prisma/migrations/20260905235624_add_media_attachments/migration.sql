-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('WORKOUT_FORM', 'EQUIPMENT', 'MEAL', 'GENERAL');

-- CreateTable
CREATE TABLE "media_attachments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "storage_object_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "purpose" "MediaPurpose" NOT NULL DEFAULT 'GENERAL',
    "target_type" TEXT,
    "target_id" UUID,
    "ai_summary" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "media_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_attachments_storage_object_id_key" ON "media_attachments"("storage_object_id");

-- CreateIndex
CREATE INDEX "media_attachments_user_id_created_at_idx" ON "media_attachments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "media_attachments_target_type_target_id_idx" ON "media_attachments"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_attachments" ADD CONSTRAINT "media_attachments_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
