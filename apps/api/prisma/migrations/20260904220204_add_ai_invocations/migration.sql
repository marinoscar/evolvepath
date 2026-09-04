-- CreateEnum
CREATE TYPE "ai_invocation_operation" AS ENUM ('invoke', 'test_connection');

-- CreateEnum
CREATE TYPE "ai_key_scope" AS ENUM ('user', 'platform');

-- CreateEnum
CREATE TYPE "ai_invocation_status" AS ENUM ('succeeded', 'failed', 'invalid_output', 'refused');

-- CreateTable
CREATE TABLE "ai_invocations" (
    "id" UUID NOT NULL,
    "operation" "ai_invocation_operation" NOT NULL,
    "key_scope" "ai_key_scope" NOT NULL,
    "user_id" UUID,
    "persona" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "request_id" TEXT,
    "provider_request_id" TEXT,
    "status" "ai_invocation_status" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_input_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "output_valid" BOOLEAN,
    "safety_decision" TEXT,
    "attachment_count" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_invocations_user_id_created_at_idx" ON "ai_invocations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_invocations_persona_created_at_idx" ON "ai_invocations"("persona", "created_at");

-- CreateIndex
CREATE INDEX "ai_invocations_status_created_at_idx" ON "ai_invocations"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
