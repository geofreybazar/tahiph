-- Appointment reminders (ADR-029). Additive only.

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN "appointment_reminders" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "appointment" ADD COLUMN "reminder_sent_at" TIMESTAMPTZ(3);
