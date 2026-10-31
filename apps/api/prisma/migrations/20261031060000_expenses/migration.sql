-- CreateEnum
CREATE TYPE "expense_kind" AS ENUM ('operating', 'production');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "expense_kind" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount_centavos" INTEGER NOT NULL,
    "incurred_on" DATE NOT NULL,
    "project_id" UUID,
    "receipt_media_id" UUID,
    "recorded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_tenant_id_incurred_on_idx" ON "expenses"("tenant_id", "incurred_on");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_kind_incurred_on_idx" ON "expenses"("tenant_id", "kind", "incurred_on");

-- CreateIndex
CREATE INDEX "expenses_tenant_id_project_id_idx" ON "expenses"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenant_id_id_key" ON "expenses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_tenant_id_receipt_media_id_key" ON "expenses"("tenant_id", "receipt_media_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "wedding_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_receipt_media_id_fkey" FOREIGN KEY ("tenant_id", "receipt_media_id") REFERENCES "media_files"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount_centavos" > 0);

ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
