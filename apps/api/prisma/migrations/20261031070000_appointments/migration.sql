-- CreateEnum
CREATE TYPE "appointment_type" AS ENUM ('consultation', 'fitting', 'pickup', 'other');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID,
    "project_id" UUID,
    "garment_id" UUID,
    "type" "appointment_type" NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'scheduled',
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_tenant_id_starts_at_idx" ON "appointments"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_client_id_idx" ON "appointments"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_project_id_idx" ON "appointments"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_garment_id_idx" ON "appointments"("tenant_id", "garment_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "wedding_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_garment_id_fkey" FOREIGN KEY ("tenant_id", "garment_id") REFERENCES "garments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "appointments" ADD CONSTRAINT "appointments_ends_after_starts" CHECK ("ends_at" > "starts_at");

ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
