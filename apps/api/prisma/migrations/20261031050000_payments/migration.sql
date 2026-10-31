-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('payment', 'refund');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cash', 'gcash', 'maya', 'bank_transfer', 'card', 'other');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "schedule_item_id" UUID,
    "kind" "payment_kind" NOT NULL,
    "amount_centavos" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "reference" TEXT,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "proof_media_id" UUID,
    "recorded_by_user_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ,
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_tenant_id_project_id_idx" ON "payments"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_paid_at_idx" ON "payments"("tenant_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_schedule_item_id_idx" ON "payments"("tenant_id", "schedule_item_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_proof_media_id_idx" ON "payments"("tenant_id", "proof_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_idempotency_key_key" ON "payments"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "wedding_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_schedule_item_id_fkey" FOREIGN KEY ("tenant_id", "schedule_item_id") REFERENCES "payment_schedule_items"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_proof_media_id_fkey" FOREIGN KEY ("tenant_id", "proof_media_id") REFERENCES "media_files"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_centavos" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_void_all_or_none" CHECK (
  ("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL)
  OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND "void_reason" IS NOT NULL)
);

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
