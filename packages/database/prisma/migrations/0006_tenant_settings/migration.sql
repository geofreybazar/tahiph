-- Atelier business profile, settings, operating hours and holidays (tenant-owned, RLS). ADR-024.

-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('CM', 'IN');

-- CreateTable
CREATE TABLE "business_profile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "tin" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postal_code" TEXT,
    "phone" TEXT,
    "email" CITEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "measurement_unit" "MeasurementUnit" NOT NULL DEFAULT 'CM',
    "vat_registered" BOOLEAN NOT NULL DEFAULT false,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_hours" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "opens_minute" SMALLINT NOT NULL,
    "closes_minute" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operating_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_profile_tenant_id_key" ON "business_profile"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_profile_tenant_id_id_key" ON "business_profile"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_id_key" ON "tenant_settings"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "operating_hours_tenant_id_day_of_week_idx" ON "operating_hours"("tenant_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "operating_hours_tenant_id_id_key" ON "operating_hours"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_tenant_id_id_key" ON "holiday"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_tenant_id_date_key" ON "holiday"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "business_profile" ADD CONSTRAINT "business_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_hours" ADD CONSTRAINT "operating_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Checks (not expressible in Prisma)
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tax_rate_check"
  CHECK (tax_rate >= 0 AND tax_rate <= 100);
ALTER TABLE "operating_hours" ADD CONSTRAINT "operating_hours_range_check"
  CHECK (day_of_week BETWEEN 0 AND 6
     AND opens_minute >= 0 AND closes_minute <= 1440 AND opens_minute < closes_minute);

-- Backfill one profile and one settings row per existing atelier, before RLS is enabled
-- (the owner role is subject to FORCE ROW LEVEL SECURITY afterwards).
INSERT INTO "business_profile" ("id", "tenant_id", "display_name", "updated_at")
  SELECT gen_random_uuid(), "id", "name", CURRENT_TIMESTAMP FROM "tenant";
INSERT INTO "tenant_settings" ("id", "tenant_id", "updated_at")
  SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP FROM "tenant";

-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "business_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_profile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "business_profile"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_settings"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "operating_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operating_hours" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "operating_hours"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holiday" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "holiday"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
