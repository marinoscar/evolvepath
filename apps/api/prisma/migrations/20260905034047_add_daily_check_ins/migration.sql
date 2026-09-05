-- CreateEnum
CREATE TYPE "CheckInFeel" AS ENUM ('NORMAL', 'PACKED', 'LOW_ENERGY', 'UNEXPECTED_PROBLEM');

-- CreateTable
CREATE TABLE "daily_check_ins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date_local" TEXT NOT NULL,
    "feel" "CheckInFeel" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "daily_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_check_ins_user_id_date_local_key" ON "daily_check_ins"("user_id", "date_local");

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
