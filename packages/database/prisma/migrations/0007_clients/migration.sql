-- CRM: clients, notes and communications (tenant-owned, RLS). ADR-026.

-- CreateEnum
CREATE TYPE "ClientSource" AS ENUM ('WALK_IN', 'REFERRAL', 'STOREFRONT', 'SOCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('CALL', 'SMS', 'EMAIL', 'MESSENGER', 'VIBER', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "client" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" CITEXT,
    "phone" TEXT,
    "birthday" DATE,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postal_code" TEXT,
    "preferences" TEXT,
    "source" "ClientSource" NOT NULL DEFAULT 'OTHER',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_note" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "author_membership_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "summary" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_tenant_id_created_at_id_idx" ON "client"("tenant_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "client_first_name_trgm_idx" ON "client" USING GIN ("first_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "client_last_name_trgm_idx" ON "client" USING GIN ("last_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "client_phone_trgm_idx" ON "client" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "client_tags_idx" ON "client" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "client_tenant_id_id_key" ON "client"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "client_note_tenant_id_client_id_created_at_idx" ON "client_note"("tenant_id", "client_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "client_note_tenant_id_author_membership_id_idx" ON "client_note"("tenant_id", "author_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_note_tenant_id_id_key" ON "client_note"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "communication_tenant_id_client_id_occurred_at_idx" ON "communication"("tenant_id", "client_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "communication_tenant_id_recorded_by_membership_id_idx" ON "communication"("tenant_id", "recorded_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_tenant_id_id_key" ON "communication"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_note" ADD CONSTRAINT "client_note_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_note" ADD CONSTRAINT "client_note_tenant_id_author_membership_id_fkey" FOREIGN KEY ("tenant_id", "author_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication" ADD CONSTRAINT "communication_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication" ADD CONSTRAINT "communication_tenant_id_recorded_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "recorded_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "client_note" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_note" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "client_note"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "communication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "communication"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
