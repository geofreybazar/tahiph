-- Uploaded images (tenant-owned, RLS). ADR-031.

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('LOGO', 'CATALOG_ITEM_IMAGE');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'REJECTED');

-- CreateTable
CREATE TABLE "media_asset" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "content_type" TEXT NOT NULL,
    "catalog_item_id" UUID,
    "created_by_membership_id" UUID NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_asset_tenant_id_purpose_created_at_idx" ON "media_asset"("tenant_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "media_asset_tenant_id_catalog_item_id_created_at_idx" ON "media_asset"("tenant_id", "catalog_item_id", "created_at");

-- CreateIndex
CREATE INDEX "media_asset_tenant_id_created_by_membership_id_idx" ON "media_asset"("tenant_id", "created_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_tenant_id_id_key" ON "media_asset"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_tenant_id_catalog_item_id_fkey" FOREIGN KEY ("tenant_id", "catalog_item_id") REFERENCES "catalog_item"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks (not expressible in Prisma)
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_catalog_item_check"
  CHECK ((purpose = 'CATALOG_ITEM_IMAGE') = (catalog_item_id IS NOT NULL));

-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "media_asset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_asset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "media_asset"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
