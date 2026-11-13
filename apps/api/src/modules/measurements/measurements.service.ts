import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import type { CreateMeasurementRecordRequest, SaveTemplateRequest } from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { DomainError, NotFoundError, ValidationFailedError } from '../../core/http/domain-error.js';
import { ClientsService } from '../clients/clients.service.js';
import { TenantSettingsService } from '../tenants/tenant-settings.service.js';
import { valueProblems } from './value-rules.js';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'P2002';
}

const FIELDS = {
  orderBy: { sortOrder: 'asc' },
  select: { key: true, label: true, section: true, required: true },
} as const;

const RECORD_INCLUDE = {
  template: {
    select: { version: true, category: { select: { id: true, name: true } }, fields: FIELDS },
  },
  takenBy: { select: { id: true, user: { select: { name: true } } } },
  supersededBy: { select: { id: true } },
  values: { select: { fieldKey: true, value: true } },
} as const;

interface RecordRow {
  id: string;
  clientId: string;
  templateId: string;
  unit: 'CM' | 'IN';
  measuredFor: string | null;
  takenAt: Date;
  notes: string | null;
  supersedesId: string | null;
  template: {
    version: number;
    category: { id: string; name: string };
    fields: { key: string; label: string; section: string | null }[];
  };
  takenBy: { id: string; user: { name: string } };
  supersededBy: { id: string } | null;
  values: { fieldKey: string; value: { toString(): string } }[];
}

function toRecord(r: RecordRow) {
  const byKey = new Map(r.values.map((v) => [v.fieldKey, v.value.toString()]));
  return {
    id: r.id,
    clientId: r.clientId,
    category: r.template.category,
    templateId: r.templateId,
    templateVersion: r.template.version,
    unit: r.unit,
    measuredFor: r.measuredFor,
    takenAt: r.takenAt.toISOString(),
    takenBy: { membershipId: r.takenBy.id, name: r.takenBy.user.name },
    notes: r.notes,
    supersedesId: r.supersedesId,
    supersededById: r.supersededBy?.id ?? null,
    values: r.template.fields
      .filter((f) => byKey.has(f.key))
      .map((f) => ({ key: f.key, label: f.label, section: f.section, value: byKey.get(f.key)! })),
  };
}

/** Garment categories, versioned templates and immutable measurement records (ADR-027). */
@Injectable()
export class MeasurementsService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
    private readonly settings: TenantSettingsService,
  ) {}

  private audited(action: string, targetType: string, targetId: string, ip: string) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType,
      targetId,
      ip,
    });
  }

  // ----- Categories -------------------------------------------------------------------

  async listCategories() {
    const rows = await this.tenantDb.db().garmentCategory.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        templates: { orderBy: { version: 'desc' }, take: 1, select: { version: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      currentVersion: c.templates[0]?.version ?? null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
    }));
  }

  async createCategory(name: string, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const c = await this.tenantDb.db().garmentCategory.create({
        data: { name } as never,
        select: { id: true, name: true, archivedAt: true },
      });
      await this.audited('garment_category.created', 'garment_category', c.id, ip);
      return { id: c.id, name: c.name, currentVersion: null, archivedAt: null };
    });
  }

  async renameCategory(id: string, name: string, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      await this.findCategory(id);
      await this.tenantDb.db().garmentCategory.update({ where: { id }, data: { name } });
      await this.audited('garment_category.renamed', 'garment_category', id, ip);
    });
    return this.categoryOut(id);
  }

  /** Archived categories keep their templates and records but take no new records. */
  async setArchived(id: string, archived: boolean, ip: string) {
    await this.tenantDb.withTenantTx(async () => {
      const c = await this.findCategory(id);
      if ((c.archivedAt !== null) === archived) return;
      await this.tenantDb.db().garmentCategory.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audited(
        archived ? 'garment_category.archived' : 'garment_category.restored',
        'garment_category',
        id,
        ip,
      );
    });
    return this.categoryOut(id);
  }

  private async categoryOut(id: string) {
    const c = (await this.listCategories()).find((x) => x.id === id);
    if (!c) throw new NotFoundError('Garment category not found.');
    return c;
  }

  private async findCategory(id: string) {
    // Scoped: another atelier's category is not found (404).
    const c = await this.tenantDb.db().garmentCategory.findFirst({
      where: { id },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!c) throw new NotFoundError('Garment category not found.');
    return c;
  }

  // ----- Templates --------------------------------------------------------------------

  private latestTemplate(categoryId: string) {
    return this.tenantDb.db().measurementTemplate.findFirst({
      where: { categoryId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        fields: FIELDS,
      },
    });
  }

  async currentTemplate(categoryId: string) {
    await this.findCategory(categoryId);
    const t = await this.latestTemplate(categoryId);
    if (!t) throw new NotFoundError('This category has no template yet.');
    return { ...t, createdAt: t.createdAt.toISOString() };
  }

  async template(id: string) {
    const t = await this.tenantDb.db().measurementTemplate.findFirst({
      where: { id },
      select: {
        id: true,
        version: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        fields: FIELDS,
      },
    });
    if (!t) throw new NotFoundError('Template not found.');
    return { ...t, createdAt: t.createdAt.toISOString() };
  }

  /** Saves a new version; existing records keep the version they were taken with. */
  async saveTemplate(categoryId: string, input: SaveTemplateRequest, ip: string) {
    try {
      const id = await this.tenantDb.withTenantTx(async () => {
        await this.findCategory(categoryId);
        const latest = await this.latestTemplate(categoryId);
        const db = this.tenantDb.db();
        const t = await db.measurementTemplate.create({
          data: { categoryId, version: (latest?.version ?? 0) + 1 } as never,
          select: { id: true },
        });
        await db.measurementField.createMany({
          data: input.fields.map((f, sortOrder) => ({
            templateId: t.id,
            ...f,
            sortOrder,
          })) as never,
        });
        await this.audited('measurement_template.saved', 'measurement_template', t.id, ip);
        return t.id;
      });
      return await this.template(id);
    } catch (err) {
      // Two saves raced for the same version number; the other one won.
      if (isUniqueViolation(err)) {
        throw new DomainError(
          'TEMPLATE_CHANGED',
          'The template was changed by someone else. Reload and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  // ----- Records ----------------------------------------------------------------------

  // shortcut: returns the latest 100 records unpaginated; a client rarely has more.
  async listRecords(clientId: string) {
    await this.clients.get(clientId);
    const rows = await this.tenantDb.db().measurementRecord.findMany({
      where: { clientId },
      orderBy: [{ takenAt: 'desc' }, { id: 'desc' }],
      take: 100,
      include: RECORD_INCLUDE,
    });
    return rows.map(toRecord);
  }

  /** Every revision of a client's measurements, oldest first (data export, ADR-032). */
  async exportForClient(clientId: string) {
    const rows = await this.tenantDb.db().measurementRecord.findMany({
      where: { clientId },
      orderBy: [{ takenAt: 'asc' }, { id: 'asc' }],
      include: RECORD_INCLUDE,
    });
    return rows.map(toRecord);
  }

  /**
   * Deletes a client's measurements through erase_client_measurements(), the only path the
   * immutability trigger allows (migration 0013, ADR-032). Returns the records deleted.
   */
  async eraseForClient(clientId: string): Promise<number> {
    return this.tenantDb.withTenantTx(async () => {
      const [row] = await this.tenantDb.db().$queryRaw<
        { n: number }[]
      >`SELECT erase_client_measurements(${clientId}::uuid) AS n`;
      return row?.n ?? 0;
    });
  }

  async record(recordId: string) {
    const r = await this.tenantDb.db().measurementRecord.findFirst({
      where: { id: recordId },
      include: RECORD_INCLUDE,
    });
    if (!r) throw new NotFoundError('Measurement record not found.');
    return toRecord(r);
  }

  async createRecord(clientId: string, input: CreateMeasurementRecordRequest, ip: string) {
    try {
      const id = await this.tenantDb.withTenantTx(async () => {
        await this.clients.get(clientId);
        const category = await this.findCategory(input.categoryId);
        if (category.archivedAt) {
          throw new DomainError('CATEGORY_ARCHIVED', 'This garment category is archived.');
        }
        const template = await this.latestTemplate(category.id);
        if (!template) {
          throw new DomainError('NO_TEMPLATE', 'This garment category has no template yet.');
        }
        const problems = valueProblems(template.fields, input.values);
        if (problems.length) throw new ValidationFailedError(problems);

        const db = this.tenantDb.db();
        if (input.supersedesId) {
          // Same client only; another client's or atelier's record is not found.
          const prior = await db.measurementRecord.findFirst({
            where: { id: input.supersedesId, clientId },
            select: { supersededBy: { select: { id: true } } },
          });
          if (!prior) throw new NotFoundError('The record to correct was not found.');
          if (prior.supersededBy) throw alreadyCorrected();
        }
        const unit = input.unit ?? (await this.settings.settings()).measurementUnit;
        const r = await db.measurementRecord.create({
          data: {
            clientId,
            templateId: template.id,
            unit,
            measuredFor: input.measuredFor || null,
            takenAt: input.takenAt ? new Date(input.takenAt) : new Date(),
            takenByMembershipId: requireContext(this.cls, 'membershipId'),
            notes: input.notes || null,
            supersedesId: input.supersedesId ?? null,
          } as never,
          select: { id: true },
        });
        await db.measurementValue.createMany({
          data: Object.entries(input.values).map(([fieldKey, value]) => ({
            recordId: r.id,
            fieldKey,
            value,
          })) as never,
        });
        await this.audited('measurement_record.created', 'measurement_record', r.id, ip);
        return r.id;
      });
      return await this.record(id);
    } catch (err) {
      // Two corrections of the same record raced; UNIQUE(tenant_id, supersedes_id) kept one.
      if (isUniqueViolation(err)) throw alreadyCorrected();
      throw err;
    }
  }
}

function alreadyCorrected() {
  return new DomainError(
    'ALREADY_CORRECTED',
    'This record was already corrected. Correct the latest record instead.',
    HttpStatus.CONFLICT,
  );
}
