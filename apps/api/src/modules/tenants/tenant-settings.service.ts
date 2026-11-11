import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import {
  clockToMinutes,
  minutesToClock,
  type BusinessProfileRequest,
  type CreateHolidayRequest,
  type OperatingHoursRequest,
  type UpdateTenantSettingsRequest,
} from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { DomainError, NotFoundError } from '../../core/http/domain-error.js';

const PROFILE_SELECT = {
  displayName: true,
  legalName: true,
  tin: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  province: true,
  postalCode: true,
  phone: true,
  email: true,
  updatedAt: true,
} as const;

const SETTINGS_SELECT = {
  timezone: true,
  currency: true,
  measurementUnit: true,
  vatRegistered: true,
  taxRate: true,
  pricesIncludeTax: true,
  updatedAt: true,
} as const;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'P2002';
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The active atelier's business profile, settings, opening hours and holidays (ADR-024).
 * Profile and settings rows always exist: onboarding creates them and migration 0006
 * backfilled older ateliers.
 */
@Injectable()
export class TenantSettingsService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
  ) {}

  private actor(ip: string) {
    return { actorType: 'USER' as const, actorId: requireContext(this.cls, 'userId'), ip };
  }

  async profile() {
    return this.tenantDb.db().businessProfile.findFirstOrThrow({ select: PROFILE_SELECT });
  }

  async replaceProfile(input: BusinessProfileRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const profile = await this.tenantDb.db().businessProfile.update({
        where: { tenantId: requireContext(this.cls, 'tenantId') },
        data: input,
        select: PROFILE_SELECT,
      });
      await this.audit.tenant({ ...this.actor(ip), action: 'business_profile.updated' });
      return profile;
    });
  }

  async settings() {
    const s = await this.tenantDb.db().tenantSettings.findFirstOrThrow({ select: SETTINGS_SELECT });
    return { ...s, taxRate: s.taxRate.toFixed(2) };
  }

  async updateSettings(input: UpdateTenantSettingsRequest, ip: string) {
    const s = await this.tenantDb.withTenantTx(async () => {
      const updated = await this.tenantDb.db().tenantSettings.update({
        where: { tenantId: requireContext(this.cls, 'tenantId') },
        data: input,
        select: SETTINGS_SELECT,
      });
      await this.audit.tenant({
        ...this.actor(ip),
        action: 'settings.updated',
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
    return { ...s, taxRate: s.taxRate.toFixed(2) };
  }

  async operatingHours() {
    const rows = await this.tenantDb.db().operatingHours.findMany({
      orderBy: [{ dayOfWeek: 'asc' }, { opensMinute: 'asc' }],
      select: { dayOfWeek: true, opensMinute: true, closesMinute: true },
    });
    return {
      ranges: rows.map((r) => ({
        dayOfWeek: r.dayOfWeek,
        opens: minutesToClock(r.opensMinute),
        closes: minutesToClock(r.closesMinute),
      })),
    };
  }

  /** Replaces the whole week in one transaction; overlaps were rejected by the schema. */
  async replaceOperatingHours(input: OperatingHoursRequest, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      const db = this.tenantDb.db();
      await db.operatingHours.deleteMany({});
      await db.operatingHours.createMany({
        data: input.ranges.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          opensMinute: clockToMinutes(r.opens),
          closesMinute: clockToMinutes(r.closes),
        })) as never,
      });
      await this.audit.tenant({
        ...this.actor(ip),
        action: 'operating_hours.replaced',
        metadata: { ranges: input.ranges.length },
      });
    });
    return this.operatingHours();
  }

  // shortcut: returns every holiday unpaginated; add a date-range query once ateliers keep years of them.
  async holidays() {
    const rows = await this.tenantDb.db().holiday.findMany({
      orderBy: { date: 'asc' },
      select: { id: true, date: true, name: true },
    });
    return rows.map((h) => ({ ...h, date: fromDate(h.date) }));
  }

  async createHoliday(input: CreateHolidayRequest, ip: string) {
    try {
      return await this.tenantDb.withTenantTx(async () => {
        const h = await this.tenantDb.db().holiday.create({
          data: { date: toDate(input.date), name: input.name } as never,
          select: { id: true, date: true, name: true },
        });
        await this.audit.tenant({
          ...this.actor(ip),
          action: 'holiday.created',
          targetType: 'holiday',
          targetId: h.id,
          metadata: { date: input.date },
        });
        return { ...h, date: fromDate(h.date) };
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          'HOLIDAY_EXISTS',
          'There is already a holiday on this date.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  async deleteHoliday(id: string, ip: string): Promise<null> {
    await this.tenantDb.withTenantTx(async () => {
      // Scoped: another atelier's holiday is not found (404).
      const { count } = await this.tenantDb.db().holiday.deleteMany({ where: { id } });
      if (count === 0) throw new NotFoundError('Holiday not found.');
      await this.audit.tenant({
        ...this.actor(ip),
        action: 'holiday.deleted',
        targetType: 'holiday',
        targetId: id,
      });
    });
    return null;
  }
}
