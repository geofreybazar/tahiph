-- Tables created by tahi_migrator must be usable by the runtime role, and only by it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tahi_api;
GRANT USAGE ON SCHEMA public TO tahi_api;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "tenant_role" AS ENUM ('owner', 'admin', 'staff');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "media_bucket" AS ENUM ('public_media', 'private_media');

-- CreateEnum
CREATE TYPE "media_purpose" AS ENUM ('sketch', 'design_reference', 'fitting_photo', 'payment_proof', 'expense_receipt');

-- CreateEnum
CREATE TYPE "media_status" AS ENUM ('pending', 'ready');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('draft', 'active', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "tenant_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "tenant_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "invited_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bucket" "media_bucket" NOT NULL,
    "object_key" TEXT NOT NULL,
    "purpose" "media_purpose" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "original_filename" TEXT,
    "status" "media_status" NOT NULL DEFAULT 'pending',
    "uploaded_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_counters" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wedding_projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "project_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "wedding_date" DATE,
    "status" "project_status" NOT NULL DEFAULT 'draft',
    "price_centavos" INTEGER NOT NULL,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wedding_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_id_key" ON "tenant_memberships"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invitations_token_hash_key" ON "tenant_invitations"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invitations_tenant_id_id_key" ON "tenant_invitations"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "media_files_tenant_id_status_idx" ON "media_files"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "media_files_tenant_id_id_key" ON "media_files"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "media_files_bucket_object_key_key" ON "media_files"("bucket", "object_key");

-- CreateIndex
CREATE INDEX "clients_tenant_id_full_name_idx" ON "clients"("tenant_id", "full_name");

-- CreateIndex
CREATE INDEX "clients_tenant_id_email_idx" ON "clients"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenant_id_id_key" ON "clients"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "wedding_projects_tenant_id_client_id_idx" ON "wedding_projects"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "wedding_projects_tenant_id_status_idx" ON "wedding_projects"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "wedding_projects_tenant_id_wedding_date_idx" ON "wedding_projects"("tenant_id", "wedding_date");

-- CreateIndex
CREATE UNIQUE INDEX "wedding_projects_tenant_id_id_key" ON "wedding_projects"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wedding_projects_tenant_id_project_number_key" ON "wedding_projects"("tenant_id", "project_number");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wedding_projects" ADD CONSTRAINT "wedding_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wedding_projects" ADD CONSTRAINT "wedding_projects_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "clients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma can't express the rest.

-- Deny-all RLS, with no policies. See docs/security.md section 5.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wedding_projects" ENABLE ROW LEVEL SECURITY;

-- One active owner per tenant.
CREATE UNIQUE INDEX "tenant_memberships_one_active_owner"
  ON "tenant_memberships" ("tenant_id")
  WHERE "role" = 'owner' AND "status" = 'active';

-- One open invitation per email in a tenant.
CREATE UNIQUE INDEX "tenant_invitations_one_open_per_email"
  ON "tenant_invitations" ("tenant_id", "email")
  WHERE "accepted_at" IS NULL;

ALTER TABLE "wedding_projects"
  ADD CONSTRAINT "wedding_projects_price_not_negative" CHECK ("price_centavos" >= 0);
ALTER TABLE "media_files"
  ADD CONSTRAINT "media_files_size_not_negative" CHECK ("size_bytes" >= 0),
  ADD CONSTRAINT "media_files_key_starts_with_tenant"
    CHECK ("object_key" LIKE "tenant_id"::text || '/%');
