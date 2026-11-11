-- Catalogue: categories, items, shared option groups and options (tenant-owned, RLS). ADR-030.

-- CreateEnum
CREATE TYPE "CatalogItemKind" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('READY_TO_WEAR', 'MADE_TO_MEASURE');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('FIXED', 'QUOTE');

-- CreateEnum
CREATE TYPE "OptionSelection" AS ENUM ('SINGLE', 'MULTIPLE');

-- CreateTable
CREATE TABLE "catalog_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID,
    "kind" "CatalogItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fulfilment" "Fulfilment",
    "pricing_mode" "PricingMode" NOT NULL,
    "base_price" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "public_visible" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_option_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "selection" "OptionSelection" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_option_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_option" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalog_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_item_option_group" (
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "catalog_item_option_group_pkey" PRIMARY KEY ("item_id","group_id")
);

-- CreateIndex
CREATE INDEX "catalog_category_tenant_id_sort_order_idx" ON "catalog_category"("tenant_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_category_tenant_id_id_key" ON "catalog_category"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "catalog_item_tenant_id_created_at_id_idx" ON "catalog_item"("tenant_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "catalog_item_tenant_id_category_id_idx" ON "catalog_item"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "catalog_item_name_trgm_idx" ON "catalog_item" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_item_tenant_id_id_key" ON "catalog_item"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_option_group_tenant_id_id_key" ON "catalog_option_group"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "catalog_option_tenant_id_group_id_sort_order_idx" ON "catalog_option"("tenant_id", "group_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_option_tenant_id_id_key" ON "catalog_option"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "catalog_item_option_group_tenant_id_item_id_idx" ON "catalog_item_option_group"("tenant_id", "item_id");

-- CreateIndex
CREATE INDEX "catalog_item_option_group_tenant_id_group_id_idx" ON "catalog_item_option_group"("tenant_id", "group_id");

-- AddForeignKey
ALTER TABLE "catalog_category" ADD CONSTRAINT "catalog_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "catalog_category"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_option_group" ADD CONSTRAINT "catalog_option_group_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_option" ADD CONSTRAINT "catalog_option_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "catalog_option_group"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item_option_group" ADD CONSTRAINT "catalog_item_option_group_tenant_id_item_id_fkey" FOREIGN KEY ("tenant_id", "item_id") REFERENCES "catalog_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item_option_group" ADD CONSTRAINT "catalog_item_option_group_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "catalog_option_group"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks (not expressible in Prisma)
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_price_check"
  CHECK ((pricing_mode <> 'FIXED' OR base_price IS NOT NULL) AND (base_price IS NULL OR base_price >= 0));
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_fulfilment_check"
  CHECK (kind = 'PRODUCT' OR fulfilment IS NULL);

-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "catalog_category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_category" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog_category"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "catalog_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog_item"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "catalog_option_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_option_group" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog_option_group"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "catalog_option" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_option" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog_option"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "catalog_item_option_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_item_option_group" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog_item_option_group"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
