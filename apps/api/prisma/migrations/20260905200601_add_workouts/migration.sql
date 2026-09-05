-- CreateEnum
CREATE TYPE "Equipment" AS ENUM ('BODYWEIGHT', 'DUMBBELL', 'BARBELL', 'MACHINE', 'CABLE', 'KETTLEBELL', 'BAND', 'BENCH');

-- CreateEnum
CREATE TYPE "MovementPattern" AS ENUM ('PUSH_H', 'PUSH_V', 'PULL_H', 'PULL_V', 'SQUAT', 'HINGE', 'LUNGE', 'CARRY', 'CORE', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "ProgressionMethod" AS ENUM ('DOUBLE_PROGRESSION');

-- CreateEnum
CREATE TYPE "WorkoutProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkoutVariant" AS ENUM ('FULL', 'SHORT', 'MINIMUM');

-- CreateEnum
CREATE TYPE "WorkoutSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "Discomfort" AS ENUM ('NONE', 'MILD', 'SHARP_PAIN');

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "workout_template_id" UUID;

-- CreateTable
CREATE TABLE "exercises" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'catalog',
    "equipment" "Equipment"[],
    "movement_pattern" "MovementPattern" NOT NULL,
    "instructions" TEXT NOT NULL,
    "contraindication_tags" TEXT[],
    "substitution_group" TEXT NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_programs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_weeks" INTEGER NOT NULL,
    "weekly_structure" JSONB NOT NULL,
    "progression_method" "ProgressionMethod" NOT NULL DEFAULT 'DOUBLE_PROGRESSION',
    "status" "WorkoutProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "plan_id" UUID,
    "generation_input" JSONB,
    "rationale" TEXT,
    "substitutions" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workout_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_templates" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "variant" "WorkoutVariant" NOT NULL,
    "target_minutes" INTEGER NOT NULL,
    "fallback_of_template_id" UUID,
    "routine_id" UUID,

    CONSTRAINT "workout_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_template_exercises" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "sets" INTEGER NOT NULL,
    "rep_min" INTEGER NOT NULL,
    "rep_max" INTEGER NOT NULL,
    "rest_seconds" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "workout_template_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "commitment_id" UUID,
    "template_id" UUID NOT NULL,
    "variant" "WorkoutVariant" NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "status" "WorkoutSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "discomfort_flag" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "set_logs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "set_number" INTEGER NOT NULL,
    "weight_kg" DECIMAL(6,2),
    "reps" INTEGER NOT NULL,
    "rpe" INTEGER,
    "discomfort" "Discomfort" NOT NULL DEFAULT 'NONE',
    "logged_at" TIMESTAMPTZ NOT NULL,
    "client_id" TEXT NOT NULL,

    CONSTRAINT "set_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_weight_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date_local" VARCHAR(10) NOT NULL,
    "weight_kg" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "body_weight_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exercises_substitution_group_idx" ON "exercises"("substitution_group");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_scope_name_key_key" ON "exercises"("scope", "name_key");

-- CreateIndex
CREATE INDEX "workout_programs_user_id_status_idx" ON "workout_programs"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workout_templates_routine_id_key" ON "workout_templates"("routine_id");

-- CreateIndex
CREATE UNIQUE INDEX "workout_templates_program_id_name_variant_key" ON "workout_templates"("program_id", "name", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "workout_template_exercises_template_id_order_key" ON "workout_template_exercises"("template_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "workout_sessions_commitment_id_key" ON "workout_sessions"("commitment_id");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_template_id_status_started_at_idx" ON "workout_sessions"("user_id", "template_id", "status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "set_logs_client_id_key" ON "set_logs"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "set_logs_session_id_exercise_id_set_number_key" ON "set_logs"("session_id", "exercise_id", "set_number");

-- CreateIndex
CREATE UNIQUE INDEX "body_weight_logs_user_id_date_local_key" ON "body_weight_logs"("user_id", "date_local");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_workout_template_id_fkey" FOREIGN KEY ("workout_template_id") REFERENCES "workout_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_programs" ADD CONSTRAINT "workout_programs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_programs" ADD CONSTRAINT "workout_programs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "workout_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_fallback_of_template_id_fkey" FOREIGN KEY ("fallback_of_template_id") REFERENCES "workout_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_template_exercises" ADD CONSTRAINT "workout_template_exercises_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workout_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_template_exercises" ADD CONSTRAINT "workout_template_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workout_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "set_logs" ADD CONSTRAINT "set_logs_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_weight_logs" ADD CONSTRAINT "body_weight_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
