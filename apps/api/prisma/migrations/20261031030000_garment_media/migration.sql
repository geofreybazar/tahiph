-- CreateTable
CREATE TABLE "garment_media" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "garment_id" UUID NOT NULL,
    "media_file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garment_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garment_media_tenant_id_garment_id_idx" ON "garment_media"("tenant_id", "garment_id");

-- CreateIndex
CREATE UNIQUE INDEX "garment_media_tenant_id_id_key" ON "garment_media"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "garment_media_tenant_id_media_file_id_key" ON "garment_media"("tenant_id", "media_file_id");

-- AddForeignKey
ALTER TABLE "garment_media" ADD CONSTRAINT "garment_media_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_media" ADD CONSTRAINT "garment_media_tenant_id_garment_id_fkey" FOREIGN KEY ("tenant_id", "garment_id") REFERENCES "garments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_media" ADD CONSTRAINT "garment_media_tenant_id_media_file_id_fkey" FOREIGN KEY ("tenant_id", "media_file_id") REFERENCES "media_files"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "garment_media" ENABLE ROW LEVEL SECURITY;
