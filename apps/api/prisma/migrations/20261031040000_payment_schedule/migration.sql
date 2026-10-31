-- CreateTable
CREATE TABLE "payment_schedule_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_centavos" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_schedule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_schedule_items_tenant_id_project_id_idx" ON "payment_schedule_items"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_schedule_items_tenant_id_id_key" ON "payment_schedule_items"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "wedding_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "payment_schedule_items" ADD CONSTRAINT "payment_schedule_items_amount_positive" CHECK ("amount_centavos" > 0);

ALTER TABLE "payment_schedule_items" ENABLE ROW LEVEL SECURITY;
