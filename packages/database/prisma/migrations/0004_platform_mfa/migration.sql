-- Platform admin MFA: TOTP replay protection and recovery codes (additive).

-- AlterTable
ALTER TABLE "platform_user" ADD COLUMN     "mfa_last_step" BIGINT;

-- CreateTable
CREATE TABLE "platform_recovery_code" (
    "id" UUID NOT NULL,
    "platform_user_id" UUID NOT NULL,
    "code_hash" BYTEA NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_recovery_code_code_hash_key" ON "platform_recovery_code"("code_hash");

-- CreateIndex
CREATE INDEX "platform_recovery_code_platform_user_id_idx" ON "platform_recovery_code"("platform_user_id");

-- AddForeignKey
ALTER TABLE "platform_recovery_code" ADD CONSTRAINT "platform_recovery_code_platform_user_id_fkey" FOREIGN KEY ("platform_user_id") REFERENCES "platform_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

