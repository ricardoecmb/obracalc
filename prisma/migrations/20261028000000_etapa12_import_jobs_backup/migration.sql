-- DropForeignKey
ALTER TABLE "backup_logs" DROP CONSTRAINT "backup_logs_user_id_fkey";

-- AlterTable
ALTER TABLE "backup_logs" ADD COLUMN     "format" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "restore_checked_at" TIMESTAMP(3),
ADD COLUMN     "restore_target" TEXT,
ADD COLUMN     "restore_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storage_driver" TEXT,
ADD COLUMN     "storage_key" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile_id" TEXT,
    "data_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "storage_driver" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "report" JSONB,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_status_created_at_idx" ON "import_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "import_jobs_user_id_created_at_idx" ON "import_jobs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_user_id_idempotency_key_key" ON "import_jobs"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "backup_logs_status_created_at_idx" ON "backup_logs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "import_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_logs" ADD CONSTRAINT "backup_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

