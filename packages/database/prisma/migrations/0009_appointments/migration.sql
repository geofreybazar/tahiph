-- Appointments: types, staff availability, time off and bookings (tenant-owned, RLS). ADR-028.

-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('CONSULTATION', 'MEASUREMENT', 'DESIGN', 'FITTING', 'FINAL_FITTING', 'PICKUP', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('DASHBOARD', 'STOREFRONT');

-- CreateTable
CREATE TABLE "appointment_type" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AppointmentKind" NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "public_bookable" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_availability" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "opens_minute" SMALLINT NOT NULL,
    "closes_minute" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_time_off" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "staff_membership_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'DASHBOARD',
    "notes" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_type_tenant_id_id_key" ON "appointment_type"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "staff_availability_tenant_id_membership_id_day_of_week_idx" ON "staff_availability"("tenant_id", "membership_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "staff_availability_tenant_id_id_key" ON "staff_availability"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "staff_time_off_tenant_id_membership_id_starts_at_idx" ON "staff_time_off"("tenant_id", "membership_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_time_off_tenant_id_id_key" ON "staff_time_off"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "appointment_tenant_id_starts_at_idx" ON "appointment"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_tenant_id_client_id_starts_at_idx" ON "appointment"("tenant_id", "client_id", "starts_at" DESC);

-- CreateIndex
CREATE INDEX "appointment_tenant_id_staff_membership_id_starts_at_idx" ON "appointment"("tenant_id", "staff_membership_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_tenant_id_type_id_idx" ON "appointment"("tenant_id", "type_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_tenant_id_id_key" ON "appointment"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "appointment_type" ADD CONSTRAINT "appointment_type_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_client_id_fkey" FOREIGN KEY ("tenant_id", "client_id") REFERENCES "client"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_type_id_fkey" FOREIGN KEY ("tenant_id", "type_id") REFERENCES "appointment_type"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_tenant_id_staff_membership_id_fkey" FOREIGN KEY ("tenant_id", "staff_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks (not expressible in Prisma)
ALTER TABLE "appointment_type" ADD CONSTRAINT "appointment_type_minutes_check"
  CHECK (duration_minutes BETWEEN 5 AND 720 AND buffer_minutes BETWEEN 0 AND 240);
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_range_check"
  CHECK (day_of_week BETWEEN 0 AND 6
     AND opens_minute >= 0 AND closes_minute <= 1440 AND opens_minute < closes_minute);
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_range_check" CHECK (starts_at < ends_at);
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_range_check"
  CHECK (starts_at < ends_at AND ends_at <= blocked_until);

-- No double-booking per staff member (DATABASE_DESIGN.md §3.1, Q1). Half-open ranges allow
-- back-to-back slots; the buffer is inside [starts_at, blocked_until). btree_gist is from 0001.
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist (
    tenant_id WITH =,
    staff_membership_id WITH =,
    tstzrange(starts_at, blocked_until, '[)') WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED'));

-- Row-Level Security (docs/MULTI_TENANCY.md §5)
ALTER TABLE "appointment_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_type" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointment_type"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "staff_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_availability" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_availability"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "staff_time_off" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_time_off" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_time_off"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

ALTER TABLE "appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointment"
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
