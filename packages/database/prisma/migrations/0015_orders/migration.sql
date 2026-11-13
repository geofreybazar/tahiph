-- Orders, items with measurement snapshots, and the status timeline (tenant-owned, RLS). ADR-034.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED', 'IN_PRODUCTION', 'READY', 'RELEASED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sales_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "quotation_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "promised_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "prices_include_tax" BOOLEAN NOT NULL,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "catalog_item_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "line_total" DECIMAL(12,2) NOT NULL,
    "measurement_record_id" UUID,
    "measurement_snapshot" JSONB,

    CONSTRAINT "sales_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_status_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "changed_by_membership_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_order_tenant_id_status_promised_date_idx" ON "sales_order"("tenant_id", "status", "promised_date");

-- CreateIndex
CREATE INDEX "sales_order_tenant_id_client_id_created_at_idx" ON "sales_order"("tenant_id", "client_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sales_order_tenant_id_created_at_id_idx" ON "sales_order"("tenant_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sales_order_tenant_id_created_by_membership_id_idx" ON "sales_order"("tenant_id", "created_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_tenant_id_id_key" ON "sales_order"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_tenant_id_number_key" ON "sales_order"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_tenant_id_quotation_id_key" ON "sales_order"("tenant_id", "quotation_id");

-- CreateIndex
CREATE INDEX "sales_order_item_tenant_id_order_id_sort_order_idx" ON "sales_order_item"("tenant_id", "order_id", "sort_order");

-- CreateIndex
CREATE INDEX "sales_order_item_tenant_id_catalog_item_id_idx" ON "sales_order_item"("tenant_id", "catalog_item_id");

-- CreateIndex
CREATE INDEX "sales_order_item_tenant_id_measurement_record_id_idx" ON "sales_order_item"("tenant_id", "measurement_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_item_tenant_id_id_key" ON "sales_order_item"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "sales_order_status_history_tenant_id_order_id_changed_at_idx" ON "sales_order_status_history"("tenant_id", "order_id", "changed_at");

-- CreateIndex
CREATE INDEX "sales_order_status_history_tenant_id_changed_by_membership__idx" ON "sales_order_status_history"("tenant_id", "changed_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_status_history_tenant_id_id_key" ON "sales_order_status_history"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_tenant_id_quotation_id_fkey" FOREIGN KEY ("tenant_id", "quotation_id") REFERENCES "quotation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "sales_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_tenant_id_catalog_item_id_fkey" FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_tenant_id_measurement_record_id_fkey" FOREIGN KEY ("tenant_id", "measurement_record_id") REFERENCES "measurement_record"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_status_history" ADD CONSTRAINT "sales_order_status_history_tenant_id_order_id_fkey" FOREIGN KEY ("tenant_id", "order_id") REFERENCES "sales_order"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_status_history" ADD CONSTRAINT "sales_order_status_history_tenant_id_changed_by_membership_fkey" FOREIGN KEY ("tenant_id", "changed_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks (not expressible in Prisma)
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_amounts_check"
  CHECK (subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND tax >= 0 AND total >= 0);
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_cancel_check"
  CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL));
ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_amounts_check"
  CHECK (quantity >= 1 AND unit_price >= 0 AND line_total >= 0 AND jsonb_typeof(options) = 'array');
ALTER TABLE "sales_order_status_history" ADD CONSTRAINT "sales_order_status_history_change_check"
  CHECK (from_status IS DISTINCT FROM to_status);

-- The timeline is append-only (forbid_mutation, migration 0002).
CREATE TRIGGER sales_order_status_history_append_only BEFORE UPDATE OR DELETE ON "sales_order_status_history"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sales_order_status_history_no_truncate BEFORE TRUNCATE ON "sales_order_status_history"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "sales_order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_order" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_order"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "sales_order_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_order_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_order_item"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "sales_order_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_order_status_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_order_status_history"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
