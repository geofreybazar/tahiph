-- Storefront customer accounts (tenant-owned, RLS).

-- CreateEnum
CREATE TYPE "CustomerAccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "customer_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT,
    "status" "CustomerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(3) NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_account_tenant_id_id_key" ON "customer_account"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_account_tenant_id_email_key" ON "customer_account"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "customer_account" ADD CONSTRAINT "customer_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "customer_account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_account" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customer_account"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
