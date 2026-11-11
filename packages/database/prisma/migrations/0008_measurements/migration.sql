-- Measurements: garment categories, versioned templates and immutable records (tenant-owned, RLS). ADR-027.

-- CreateTable
CREATE TABLE "garment_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "garment_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_field" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "section" TEXT,
    "sort_order" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "measurement_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "unit" "MeasurementUnit" NOT NULL,
    "measured_for" TEXT,
    "taken_at" TIMESTAMPTZ(3) NOT NULL,
    "taken_by_membership_id" UUID NOT NULL,
    "notes" TEXT,
    "supersedes_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_value" (
    "tenant_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "value" DECIMAL(7,3) NOT NULL,

    CONSTRAINT "measurement_value_pkey" PRIMARY KEY ("record_id","field_key")
);

-- CreateIndex
CREATE INDEX "garment_category_tenant_id_name_idx" ON "garment_category"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "garment_category_tenant_id_id_key" ON "garment_category"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_template_tenant_id_id_key" ON "measurement_template"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_template_tenant_id_category_id_version_key" ON "measurement_template"("tenant_id", "category_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_field_tenant_id_id_key" ON "measurement_field"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_field_tenant_id_template_id_key_key" ON "measurement_field"("tenant_id", "template_id", "key");

-- CreateIndex
CREATE INDEX "measurement_record_tenant_id_client_id_taken_at_idx" ON "measurement_record"("tenant_id", "client_id", "taken_at" DESC);

-- CreateIndex
CREATE INDEX "measurement_record_tenant_id_template_id_idx" ON "measurement_record"("tenant_id", "template_id");

-- CreateIndex
CREATE INDEX "measurement_record_tenant_id_taken_by_membership_id_idx" ON "measurement_record"("tenant_id", "taken_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_record_tenant_id_id_key" ON "measurement_record"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_record_tenant_id_supersedes_id_key" ON "measurement_record"("tenant_id", "supersedes_id");

-- CreateIndex
CREATE INDEX "measurement_value_tenant_id_record_id_idx" ON "measurement_value"("tenant_id", "record_id");

-- AddForeignKey
ALTER TABLE "garment_category" ADD CONSTRAINT "garment_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_template" ADD CONSTRAINT "measurement_template_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "garment_category"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_field" ADD CONSTRAINT "measurement_field_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "measurement_template"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_record" ADD CONSTRAINT "measurement_record_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_record" ADD CONSTRAINT "measurement_record_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "measurement_template"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_record" ADD CONSTRAINT "measurement_record_tenant_id_taken_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "taken_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_record" ADD CONSTRAINT "measurement_record_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "measurement_record"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_value" ADD CONSTRAINT "measurement_value_tenant_id_record_id_fkey" FOREIGN KEY ("tenant_id", "record_id") REFERENCES "measurement_record"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Templates, fields, records and values never change (ADR-027). forbid_mutation() is from 0002.
CREATE TRIGGER measurement_template_immutable BEFORE UPDATE OR DELETE ON "measurement_template"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER measurement_field_immutable BEFORE UPDATE OR DELETE ON "measurement_field"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER measurement_record_immutable BEFORE UPDATE OR DELETE ON "measurement_record"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER measurement_value_immutable BEFORE UPDATE OR DELETE ON "measurement_value"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- TRUNCATE bypasses row triggers.
CREATE TRIGGER measurement_record_no_truncate BEFORE TRUNCATE ON "measurement_record"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER measurement_value_no_truncate BEFORE TRUNCATE ON "measurement_value"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

ALTER TABLE "measurement_value" ADD CONSTRAINT "measurement_value_positive_check" CHECK (value > 0);
ALTER TABLE "measurement_template" ADD CONSTRAINT "measurement_template_version_check" CHECK (version >= 1);

-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "garment_category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "garment_category" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "garment_category"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "measurement_template" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_template" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "measurement_template"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "measurement_field" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_field" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "measurement_field"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "measurement_record" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_record" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "measurement_record"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "measurement_value" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "measurement_value" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "measurement_value"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
