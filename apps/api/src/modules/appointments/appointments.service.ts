import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma, TenantDatabase } from '@tahi/database';
import {
  clockToMinutes,
  minutesToClock,
  type AppointmentListQuery,
  type CreateAppointmentRequest,
  type CreateAppointmentTypeRequest,
  type CreateTimeOffRequest,
  type OperatingHoursRequest,
  type RescheduleAppointmentRequest,
  type SlotQuery,
  type UpdateAppointmentTypeRequest,
} from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { DomainError, NotFoundError } from '../../core/http/domain-error.js';
import { ClientsService } from '../clients/clients.service.js';
import { StaffService } from '../tenants/staff.service.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { computeSlots, dayOfWeek, localToUtc } from './slots.js';

const ACTIVE = ['PENDING', 'CONFIRMED'] as const;
const MINUTE = 60_000;

/** SQLSTATE 23P01 from appointment_no_overlap; the adapter error carries the message. */
function isOverlapViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.message} ${JSON.stringify((err as { meta?: unknown }).meta ?? {})}`;
  return text.includes('appointment_no_overlap') || text.includes('23P01');
}

function conflict() {
  return new DomainError(
    'APPOINTMENT_CONFLICT',
    'The staff member already has an appointment at this time.',
    HttpStatus.CONFLICT,
  );
}

const TYPE_SELECT = {
  id: true,
  name: true,
  kind: true,
  durationMinutes: true,
  bufferMinutes: true,
  publicBookable: true,
  color: true,
  archivedAt: true,
} as const;

const toType = (t: Prisma.AppointmentTypeGetPayload<{ select: typeof TYPE_SELECT }>) => ({
  ...t,
  archivedAt: t.archivedAt?.toISOString() ?? null,
});

const APPOINTMENT_INCLUDE = {
  client: { select: { id: true, firstName: true, lastName: true } },
  type: { select: { id: true, name: true, kind: true, color: true } },
  staff: { select: { id: true, user: { select: { name: true } } } },
} as const;

type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>;

const toAppointment = (a: AppointmentRow) => ({
  id: a.id,
  client: {
    id: a.client.id,
    name: [a.client.firstName, a.client.lastName].filter(Boolean).join(' '),
  },
  type: a.type,
  staff: { membershipId: a.staff.id, name: a.staff.user.name },
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt.toISOString(),
  blockedUntil: a.blockedUntil.toISOString(),
  status: a.status,
  source: a.source,
  notes: a.notes,
  cancelReason: a.cancelReason,
});

/** Appointment types, staff availability, booking and the calendar (ADR-028). */
@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
    private readonly staff: StaffService,
    private readonly settings: TenantSettingsService,
  ) {}

  private audited(
    action: string,
    targetType: string,
    targetId: string,
    ip: string,
    metadata?: Prisma.InputJsonObject,
  ) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType,
      targetId,
      ip,
      ...(metadata ? { metadata } : {}),
    });
  }

  // ----- Types ------------------------------------------------------------------------

  async listTypes() {
    const rows = await this.tenantDb.db().appointmentType.findMany({
      orderBy: { name: 'asc' },
      select: TYPE_SELECT,
    });
    return rows.map(toType);
  }

  private async findType(id: string) {
    // Scoped: another atelier's type is not found (404).
    const t = await this.tenantDb.db().appointmentType.findFirst({
      where: { id },
      select: TYPE_SELECT,
    });
    if (!t) throw new NotFoundError('Appointment type not found.');
    return t;
  }

  async createType(input: CreateAppointmentTypeRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const t = await this.tenantDb.db().appointmentType.create({
        data: input as never,
        select: TYPE_SELECT,
      });
      await this.audited('appointment_type.created', 'appointment_type', t.id, ip);
      return toType(t);
    });
  }

  /** Changes apply to new bookings; existing appointments keep their times. */
  async updateType(id: string, input: UpdateAppointmentTypeRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      await this.findType(id);
      const t = await this.tenantDb.db().appointmentType.update({
        where: { id },
        data: input,
        select: TYPE_SELECT,
      });
      await this.audited('appointment_type.updated', 'appointment_type', id, ip);
      return toType(t);
    });
  }

  async setTypeArchived(id: string, archived: boolean, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const current = await this.findType(id);
      if ((current.archivedAt !== null) === archived) return toType(current);
      const t = await this.tenantDb.db().appointmentType.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select: TYPE_SELECT,
      });
      await this.audited(
        archived ? 'appointment_type.archived' : 'appointment_type.restored',
        'appointment_type',
        id,
        ip,
      );
      return toType(t);
    });
  }

  // ----- Staff availability and time off ----------------------------------------------

  async availability(membershipId: string) {
    await this.staff.member(membershipId);
    const rows = await this.tenantDb.db().staffAvailability.findMany({
      where: { membershipId },
      orderBy: [{ dayOfWeek: 'asc' }, { opensMinute: 'asc' }],
    });
    return {
      ranges: rows.map((r) => ({
        dayOfWeek: r.dayOfWeek,
        opens: minutesToClock(r.opensMinute),
        closes: minutesToClock(r.closesMinute),
      })),
    };
  }

  /** Replaces the member's week. An empty week means "follows opening hours". */
  async replaceAvailability(membershipId: string, input: OperatingHoursRequest, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      await this.staff.member(membershipId);
      const db = this.tenantDb.db();
      await db.staffAvailability.deleteMany({ where: { membershipId } });
      await db.staffAvailability.createMany({
        data: input.ranges.map((r) => ({
          membershipId,
          dayOfWeek: r.dayOfWeek,
          opensMinute: clockToMinutes(r.opens),
          closesMinute: clockToMinutes(r.closes),
        })) as never,
      });
      await this.audited('staff_availability.replaced', 'membership', membershipId, ip);
    });
    return this.availability(membershipId);
  }

  async timeOff(membershipId: string) {
    await this.staff.member(membershipId);
    const rows = await this.tenantDb.db().staffTimeOff.findMany({
      where: { membershipId, endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((t) => ({
      id: t.id,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      reason: t.reason,
    }));
  }

  /** Existing appointments are not moved; the calendar shows the clash for staff to resolve. */
  async addTimeOff(membershipId: string, input: CreateTimeOffRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      await this.staff.member(membershipId);
      const t = await this.tenantDb.db().staffTimeOff.create({
        data: {
          membershipId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          reason: input.reason || null,
        } as never,
      });
      await this.audited('staff_time_off.created', 'staff_time_off', t.id, ip);
      return {
        id: t.id,
        startsAt: t.startsAt.toISOString(),
        endsAt: t.endsAt.toISOString(),
        reason: t.reason,
      };
    });
  }

  async deleteTimeOff(membershipId: string, timeOffId: string, ip: string): Promise<null> {
    await this.tenantDb.withTenantTx(async () => {
      const { count } = await this.tenantDb
        .db()
        .staffTimeOff.deleteMany({ where: { id: timeOffId, membershipId } });
      if (count === 0) throw new NotFoundError('Time off not found.');
      await this.audited('staff_time_off.deleted', 'staff_time_off', timeOffId, ip);
    });
    return null;
  }

  // ----- Calendar and slots -----------------------------------------------------------

  /** Appointments overlapping [from, to), in start order. Filter ids must exist (404). */
  async list(query: AppointmentListQuery) {
    if (query.clientId) await this.clients.get(query.clientId);
    if (query.staffMembershipId) await this.staff.member(query.staffMembershipId);
    const rows = await this.tenantDb.db().appointment.findMany({
      where: {
        startsAt: { lt: new Date(query.to) },
        endsAt: { gt: new Date(query.from) },
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.staffMembershipId ? { staffMembershipId: query.staffMembershipId } : {}),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      include: APPOINTMENT_INCLUDE,
    });
    return rows.map(toAppointment);
  }

  async get(id: string) {
    return toAppointment(await this.find(id));
  }

  async slots(query: SlotQuery) {
    const type = await this.findType(query.typeId);
    if (type.archivedAt) throw typeArchived();
    const { timezone } = await this.settings.settings();
    const members = query.staffMembershipId
      ? [await this.staff.activeMember(query.staffMembershipId)]
      : await this.staff.activeMembers();
    const ids = members.map((m) => m.membershipId);
    const dayStart = localToUtc(query.date, 0, timezone);
    const dayEnd = localToUtc(query.date, 1440, timezone);
    const weekday = dayOfWeek(query.date);
    const db = this.tenantDb.db();

    const [hours, holidays, availability, appointments, timeOff] = await Promise.all([
      this.settings.operatingHours(),
      this.settings.holidays(),
      db.staffAvailability.findMany({ where: { membershipId: { in: ids } } }),
      db.appointment.findMany({
        where: {
          staffMembershipId: { in: ids },
          status: { in: [...ACTIVE] },
          startsAt: { lt: dayEnd },
          blockedUntil: { gt: dayStart },
        },
        select: { staffMembershipId: true, startsAt: true, blockedUntil: true },
      }),
      db.staffTimeOff.findMany({
        where: { membershipId: { in: ids }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      }),
    ]);

    const opening = hours.ranges
      .filter((r) => r.dayOfWeek === weekday)
      .map((r) => ({
        opensMinute: clockToMinutes(r.opens),
        closesMinute: clockToMinutes(r.closes),
      }));
    const slots = computeSlots({
      date: query.date,
      timezone,
      durationMinutes: type.durationMinutes,
      bufferMinutes: type.bufferMinutes,
      now: new Date(),
      isHoliday: holidays.some((h) => h.date === query.date),
      opening,
      staff: ids.map((membershipId) => {
        const own = availability.filter((a) => a.membershipId === membershipId);
        return {
          membershipId,
          availability: own.length ? own.filter((a) => a.dayOfWeek === weekday) : null,
          busy: [
            ...appointments
              .filter((a) => a.staffMembershipId === membershipId)
              .map((a) => ({ start: a.startsAt, end: a.blockedUntil })),
            ...timeOff
              .filter((t) => t.membershipId === membershipId)
              .map((t) => ({ start: t.startsAt, end: t.endsAt })),
          ],
        };
      }),
    });
    return {
      date: query.date,
      timezone,
      staff: slots.map((s, i) => ({
        membershipId: s.membershipId,
        name: members[i]!.name,
        startsAt: s.startsAt.map((d) => d.toISOString()),
      })),
    };
  }

  // ----- Booking ----------------------------------------------------------------------

  /**
   * Books a confirmed dashboard appointment. Outside opening hours is allowed (ADR-028);
   * overlaps are not: the exclusion constraint rejects them, even under concurrency.
   */
  async create(input: CreateAppointmentRequest, ip: string) {
    try {
      return await this.tenantDb.withTenantTx(async () => {
        await this.clients.get(input.clientId);
        const type = await this.findType(input.typeId);
        if (type.archivedAt) throw typeArchived();
        await this.staff.activeMember(input.staffMembershipId);
        const startsAt = new Date(input.startsAt);
        const endsAt = new Date(startsAt.getTime() + type.durationMinutes * MINUTE);
        const a = await this.tenantDb.db().appointment.create({
          data: {
            clientId: input.clientId,
            typeId: type.id,
            staffMembershipId: input.staffMembershipId,
            startsAt,
            endsAt,
            blockedUntil: new Date(endsAt.getTime() + type.bufferMinutes * MINUTE),
            status: 'CONFIRMED',
            source: 'DASHBOARD',
            notes: input.notes || null,
          } as never,
          include: APPOINTMENT_INCLUDE,
        });
        await this.audited('appointment.created', 'appointment', a.id, ip);
        return toAppointment(a);
      });
    } catch (err) {
      if (isOverlapViolation(err)) throw conflict();
      throw err;
    }
  }

  /** Moves the appointment in place, keeping its length and buffer (ADR-028). */
  async reschedule(id: string, input: RescheduleAppointmentRequest, ip: string) {
    try {
      return await this.tenantDb.withTenantTx(async () => {
        const a = await this.find(id);
        assertActive(a.status);
        if (input.staffMembershipId) await this.staff.activeMember(input.staffMembershipId);
        const startsAt = new Date(input.startsAt);
        const shift = startsAt.getTime() - a.startsAt.getTime();
        const updated = await this.tenantDb.db().appointment.update({
          where: { id },
          data: {
            startsAt,
            endsAt: new Date(a.endsAt.getTime() + shift),
            blockedUntil: new Date(a.blockedUntil.getTime() + shift),
            ...(input.staffMembershipId ? { staffMembershipId: input.staffMembershipId } : {}),
          },
          include: APPOINTMENT_INCLUDE,
        });
        await this.audited('appointment.rescheduled', 'appointment', id, ip, {
          fromStartsAt: a.startsAt.toISOString(),
          toStartsAt: startsAt.toISOString(),
          fromStaff: a.staffMembershipId,
          toStaff: updated.staffMembershipId,
        });
        return toAppointment(updated);
      });
    } catch (err) {
      if (isOverlapViolation(err)) throw conflict();
      throw err;
    }
  }

  /** CANCELLED, COMPLETED or NO_SHOW, only from PENDING or CONFIRMED. Frees the slot. */
  async transition(
    id: string,
    status: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW',
    ip: string,
    reason?: string,
  ) {
    return this.tenantDb.withTenantTx(async () => {
      const a = await this.find(id);
      assertActive(a.status);
      const updated = await this.tenantDb.db().appointment.update({
        where: { id },
        data: { status, ...(status === 'CANCELLED' ? { cancelReason: reason || null } : {}) },
        include: APPOINTMENT_INCLUDE,
      });
      await this.audited(`appointment.${status.toLowerCase()}`, 'appointment', id, ip);
      return toAppointment(updated);
    });
  }

  private async find(id: string): Promise<AppointmentRow> {
    // Scoped: another atelier's appointment is not found (404).
    const a = await this.tenantDb.db().appointment.findFirst({
      where: { id },
      include: APPOINTMENT_INCLUDE,
    });
    if (!a) throw new NotFoundError('Appointment not found.');
    return a;
  }
}

function assertActive(status: string) {
  if (!(ACTIVE as readonly string[]).includes(status)) {
    throw new DomainError(
      'APPOINTMENT_CLOSED',
      'This appointment is already completed, cancelled or marked as no-show.',
    );
  }
}

function typeArchived() {
  return new DomainError('TYPE_ARCHIVED', 'This appointment type is archived.');
}
