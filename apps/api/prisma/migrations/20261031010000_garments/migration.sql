-- CreateEnum
CREATE TYPE "garment_stage" AS ENUM ('design', 'fabric_sourcing', 'cutting', 'sewing', 'embellishment', 'fitting', 'alterations', 'ready', 'released');

-- CreateEnum
CREATE TYPE "wearer_role" AS ENUM ('bride', 'groom', 'entourage', 'other');

-- CreateTable
CREATE TABLE "garments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "wearer_name" TEXT NOT NULL,
    "wearer_role" "wearer_role" NOT NULL,
    "description" TEXT,
    "stage" "garment_stage" NOT NULL DEFAULT 'design',
    "due_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "garments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_stage_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "garment_id" UUID NOT NULL,
    "from_stage" "garment_stage",
    "to_stage" "garment_stage" NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garment_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "garments_tenant_id_project_id_idx" ON "garments"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "garments_tenant_id_stage_idx" ON "garments"("tenant_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "garments_tenant_id_id_key" ON "garments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "garment_stage_events_tenant_id_garment_id_occurred_at_idx" ON "garment_stage_events"("tenant_id", "garment_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "garment_stage_events_tenant_id_id_key" ON "garment_stage_events"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "garments" ADD CONSTRAINT "garments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garments" ADD CONSTRAINT "garments_tenant_id_project_id_fkey" FOREIGN KEY ("tenant_id", "project_id") REFERENCES "wedding_projects"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_stage_events" ADD CONSTRAINT "garment_stage_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_stage_events" ADD CONSTRAINT "garment_stage_events_tenant_id_garment_id_fkey" FOREIGN KEY ("tenant_id", "garment_id") REFERENCES "garments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_stage_events" ADD CONSTRAINT "garment_stage_events_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "garments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "garment_stage_events" ENABLE ROW LEVEL SECURITY;
