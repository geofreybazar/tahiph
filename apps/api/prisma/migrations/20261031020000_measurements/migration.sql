-- CreateEnum
CREATE TYPE "measurement_unit" AS ENUM ('in', 'cm');

-- AlterTable
ALTER TABLE "garments" ADD COLUMN     "measurement_record_id" UUID;

-- CreateTable
CREATE TABLE "measurement_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "person_name" TEXT NOT NULL,
    "notes" TEXT,
    "portal_visible" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "measurement_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "taken_on" DATE NOT NULL,
    "unit" "measurement_unit" NOT NULL,
    "notes" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_values" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "value" DECIMAL(6,2) NOT NULL,

    CONSTRAINT "measurement_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "measurement_profiles_tenant_id_client_id_idx" ON "measurement_profiles"("tenant_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_profiles_tenant_id_id_key" ON "measurement_profiles"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "measurement_records_tenant_id_profile_id_taken_on_idx" ON "measurement_records"("tenant_id", "profile_id", "taken_on" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "measurement_records_tenant_id_id_key" ON "measurement_records"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_values_tenant_id_id_key" ON "measurement_values"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_values_tenant_id_record_id_key_key" ON "measurement_values"("tenant_id", "record_id", "key");

-- CreateIndex
CREATE INDEX "garments_tenant_id_measurement_record_id_idx" ON "garments"("tenant_id", "measurement_record_id");

-- AddForeignKey
ALTER TABLE "garments" ADD CONSTRAINT "garments_tenant_id_measurement_record_id_fkey" FOREIGN KEY ("tenant_id", "measurement_record_id") REFERENCES "measurement_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_profiles" ADD CONSTRAINT "measurement_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_profiles" ADD CONSTRAINT "measurement_profiles_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_tenant_id_profile_id_fkey" FOREIGN KEY ("tenant_id", "profile_id") REFERENCES "measurement_profiles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_values" ADD CONSTRAINT "measurement_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_values" ADD CONSTRAINT "measurement_values_tenant_id_record_id_fkey" FOREIGN KEY ("tenant_id", "record_id") REFERENCES "measurement_records"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "measurement_values" ADD CONSTRAINT "measurement_values_value_positive" CHECK ("value" > 0);

ALTER TABLE "measurement_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_values" ENABLE ROW LEVEL SECURITY;
