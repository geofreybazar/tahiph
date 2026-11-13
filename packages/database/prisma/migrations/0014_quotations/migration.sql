-- Quotations and per-tenant number counters (tenant-owned, RLS). ADR-033.

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CONVERTED');

-- CreateTable
CREATE TABLE "tenant_counter" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "tenant_counter_pkey" PRIMARY KEY ("tenant_id","key","year")
);

-- CreateTable
CREATE TABLE "quotation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "client_id" UUID NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "valid_until" DATE,
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "prices_include_tax" BOOLEAN NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_membership_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quotation_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "catalog_item_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "line_total" DECIMAL(12,2) NOT NULL,
    "measurement_record_id" UUID,

    CONSTRAINT "quotation_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotation_tenant_id_created_at_id_idx" ON "quotation"("tenant_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "quotation_tenant_id_client_id_created_at_idx" ON "quotation"("tenant_id", "client_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quotation_tenant_id_status_valid_until_idx" ON "quotation"("tenant_id", "status", "valid_until");

-- CreateIndex
CREATE INDEX "quotation_tenant_id_created_by_membership_id_idx" ON "quotation"("tenant_id", "created_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_tenant_id_id_key" ON "quotation"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_tenant_id_number_revision_key" ON "quotation"("tenant_id", "number", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_tenant_id_supersedes_id_key" ON "quotation"("tenant_id", "supersedes_id");

-- CreateIndex
CREATE INDEX "quotation_item_tenant_id_quotation_id_sort_order_idx" ON "quotation_item"("tenant_id", "quotation_id", "sort_order");

-- CreateIndex
CREATE INDEX "quotation_item_tenant_id_catalog_item_id_idx" ON "quotation_item"("tenant_id", "catalog_item_id");

-- CreateIndex
CREATE INDEX "quotation_item_tenant_id_measurement_record_id_idx" ON "quotation_item"("tenant_id", "measurement_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_item_tenant_id_id_key" ON "quotation_item"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "tenant_counter" ADD CONSTRAINT "tenant_counter_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "quotation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_tenant_id_quotation_id_fkey" FOREIGN KEY ("tenant_id", "quotation_id") REFERENCES "quotation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_tenant_id_catalog_item_id_fkey" FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_tenant_id_measurement_record_id_fkey" FOREIGN KEY ("tenant_id", "measurement_record_id") REFERENCES "measurement_record"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks (not expressible in Prisma)
ALTER TABLE "tenant_counter" ADD CONSTRAINT "tenant_counter_value_check" CHECK (value > 0);
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_amounts_check"
  CHECK (subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND tax >= 0 AND total >= 0
         AND revision >= 1 AND (revision = 1) = (supersedes_id IS NULL));
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_sent_check"
  CHECK (status = 'DRAFT' OR (sent_at IS NOT NULL AND valid_until IS NOT NULL) OR status = 'SUPERSEDED');
ALTER TABLE "quotation_item" ADD CONSTRAINT "quotation_item_amounts_check"
  CHECK (quantity >= 1 AND unit_price >= 0 AND line_total >= 0 AND jsonb_typeof(options) = 'array');

-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "tenant_counter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_counter" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_counter"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "quotation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quotation"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "quotation_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotation_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quotation_item"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
