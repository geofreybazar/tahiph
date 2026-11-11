import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TENANT_MODELS, type DatabaseClient } from '@tahi/database';
import { randomBytes } from 'node:crypto';
import { TENANT_PERMISSIONS } from '@tahi/types';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AuditModule } from '../src/core/audit/audit.module.js';
import { AuthCoreModule } from '../src/core/auth/auth-core.module.js';
import { MemoryRateLimitStore, RATE_LIMIT_STORE } from '../src/core/auth/rate-limit.js';
import { SessionService } from '../src/core/auth/session.service.js';
import { CoreModule } from '../src/core/core.module.js';
import { UNSCOPED_PRISMA } from '../src/core/database/database.module.js';
import { MAILER } from '../src/core/email/email.types.js';
import { configureApp } from '../src/core/http/configure-app.js';
import { HttpModule } from '../src/core/http/http.module.js';
import { routesOf } from '../src/core/http/openapi.factory.js';
import type { RouteInfo } from '../src/core/http/route-inventory.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { PlatformModule } from '../src/modules/platform/platform.module.js';
import { ClientsModule } from '../src/modules/clients/clients.module.js';
import { CatalogModule } from '../src/modules/catalog/catalog.module.js';
import { AppointmentsModule } from '../src/modules/appointments/appointments.module.js';
import { MeasurementsModule } from '../src/modules/measurements/measurements.module.js';
import { TenantsModule } from '../src/modules/tenants/tenants.module.js';
import { Browser } from './browser.js';
import {
  addMember,
  asTenant,
  createTenant,
  createUser,
  suffix,
  type TenantFixture,
} from './fixtures.js';

type App = Parameters<typeof request>[0];

/**
 * Cross-tenant suite (docs/MULTI_TENANCY.md §7), driven by the route inventory so new routes
 * are covered automatically:
 * 1. every tenant/customer route whose request carries ids (path params or uuid body fields)
 *    must declare them with @References();
 * 2. for each reference, a request with the other atelier's id must return 404 and write
 *    nothing for that atelier, while the same request with the actor's own id must not 404.
 */

/** Distinct future start times, so own-id bookings never collide with each other. */
let slot = 0;
const nextStart = () => new Date(Date.UTC(2031, 0, 1) + slot++ * 3 * 3600_000).toISOString();

/** Valid request bodies apart from the referenced ids. Add one per referencing route. */
const SAMPLES: Record<string, () => Record<string, unknown>> = {
  'InvitationsController.create': () => ({ email: `x-${suffix()}@example.test` }),
  'AuthController.switchTenant': () => ({}),
  'StaffController.update': () => ({}),
  'TenantSettingsController.deleteHoliday': () => ({}),
  'InvitationsController.revoke': () => ({}),
  'RolesController.update': () => ({ name: `Renamed ${suffix()}` }),
  'RolesController.remove': () => ({}),
  'ClientsController.get': () => ({}),
  'ClientsController.update': () => ({ firstName: 'Bea' }),
  'ClientsController.archive': () => ({}),
  'ClientsController.restore': () => ({}),
  'ClientsController.notes': () => ({}),
  'ClientsController.addNote': () => ({ body: 'Measured for a terno' }),
  'ClientsController.deleteNote': () => ({}),
  'ClientsController.communications': () => ({}),
  'GarmentCategoriesController.rename': () => ({ name: `Barong ${suffix()}` }),
  'GarmentCategoriesController.archive': () => ({}),
  'GarmentCategoriesController.restore': () => ({}),
  'GarmentCategoriesController.template': () => ({}),
  'GarmentCategoriesController.saveTemplate': () => ({
    fields: [{ key: 'chest', label: 'Chest' }],
  }),
  'MeasurementsController.template': () => ({}),
  'MeasurementsController.list': () => ({}),
  'MeasurementsController.create': () => ({ values: { chest: '96.5' } }),
  'MeasurementsController.record': () => ({}),
  'AppointmentTypesController.update': () => ({ name: `Fitting ${suffix()}` }),
  'AppointmentTypesController.archive': () => ({}),
  'AppointmentTypesController.restore': () => ({}),
  'StaffScheduleController.availability': () => ({}),
  'StaffScheduleController.replaceAvailability': () => ({ ranges: [] }),
  'StaffScheduleController.timeOff': () => ({}),
  'StaffScheduleController.addTimeOff': () => ({
    startsAt: '2032-01-01T00:00:00Z',
    endsAt: '2032-01-01T01:00:00Z',
  }),
  'StaffScheduleController.deleteTimeOff': () => ({}),
  'AppointmentsController.list': () => ({
    from: '2031-01-01T00:00:00Z',
    to: '2031-02-01T00:00:00Z',
  }),
  'AppointmentsController.slots': () => ({ date: '2031-06-02' }),
  'AppointmentsController.get': () => ({}),
  'AppointmentsController.create': () => ({ startsAt: nextStart() }),
  'AppointmentsController.reschedule': () => ({ startsAt: nextStart() }),
  'AppointmentsController.cancel': () => ({}),
  'AppointmentsController.complete': () => ({}),
  'AppointmentsController.noShow': () => ({}),
  'CatalogCategoriesController.update': () => ({ name: `Gowns ${suffix()}` }),
  'CatalogCategoriesController.archive': () => ({}),
  'CatalogCategoriesController.restore': () => ({}),
  'CatalogItemsController.list': () => ({}),
  'CatalogItemsController.create': () => ({
    kind: 'PRODUCT',
    name: 'Barong',
    pricingMode: 'QUOTE',
  }),
  'CatalogItemsController.get': () => ({}),
  'CatalogItemsController.update': () => ({ name: `Barong ${suffix()}` }),
  'CatalogItemsController.archive': () => ({}),
  'CatalogItemsController.restore': () => ({}),
  'CatalogItemsController.setOptionGroups': () => ({}),
  'OptionGroupsController.get': () => ({}),
  'OptionGroupsController.update': () => ({ name: `Fabric ${suffix()}` }),
  'OptionGroupsController.archive': () => ({}),
  'OptionGroupsController.restore': () => ({}),
  'OptionGroupsController.addOption': () => ({ name: 'Jusi', priceDelta: '1500.00' }),
  'OptionGroupsController.updateOption': () => ({ name: `Piña ${suffix()}` }),
  'OptionGroupsController.archiveOption': () => ({}),
  'OptionGroupsController.restoreOption': () => ({}),
  'ClientsController.addCommunication': () => ({
    channel: 'CALL',
    direction: 'INBOUND',
    summary: 'Asked about fittings',
  }),
};

/** Realms whose routes act inside one atelier. Platform routes take tenant ids by design. */
const TENANT_SCOPED_REALMS = new Set(['tenant', 'customer', 'public']);

interface Side {
  tenant: TenantFixture;
  resources: Record<string, string>;
  /** Kinds a request may consume (deleted by the own-id control): a new id per request. */
  fresh: Record<string, () => Promise<string>>;
}

type JsonProp = { format?: string; items?: { format?: string } };

/** Request fields holding uuids: single ids, or arrays of ids (`array: true`). */
function uuidFields(schema: z.ZodType | undefined): { name: string; array: boolean }[] {
  if (!schema) return [];
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, JsonProp>;
    anyOf?: { properties?: Record<string, JsonProp> }[];
  };
  const found = new Map<string, boolean>();
  for (const o of [json, ...(json.anyOf ?? [])]) {
    for (const [name, p] of Object.entries(o.properties ?? {})) {
      if (p.format === 'uuid') found.set(name, false);
      else if (p.items?.format === 'uuid') found.set(name, true);
    }
  }
  return [...found].map(([name, array]) => ({ name, array }));
}

const uuidBodyFields = (schema: z.ZodType | undefined) => uuidFields(schema).map((f) => f.name);

describe('Cross-tenant isolation for every route (integration)', () => {
  let app: INestApplication;
  let prisma: DatabaseClient;
  let routes: RouteInfo[];
  let actorBrowser: Browser;
  let A: Side;
  let B: Side;
  const server = (): App => app.getHttpServer() as App;

  async function side(userId: string): Promise<Side> {
    const tenant = await createTenant(prisma, {
      owner: [...TENANT_PERMISSIONS],
      staff: ['clients.read'],
    });
    const member = await addMember(prisma, tenant, userId, 'owner');
    const colleague = await addMember(prisma, tenant, (await createUser(prisma)).id, 'staff');
    const holiday = await asTenant(prisma, tenant.tenantId, (tx) =>
      tx.holiday.create({
        data: { tenantId: tenant.tenantId, date: new Date('2030-12-25'), name: 'Christmas' },
      }),
    );
    const invitation = await prisma.authToken.create({
      data: {
        tokenHash: new Uint8Array(randomBytes(32)),
        purpose: 'INVITE',
        tenantId: tenant.tenantId,
        email: `inv-${suffix()}@example.test`,
        metadata: { roleId: tenant.roles.staff! },
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const customRole = await asTenant(prisma, tenant.tenantId, (tx) =>
      tx.role.create({
        data: { tenantId: tenant.tenantId, key: `custom-${suffix()}`, name: `Custom ${suffix()}` },
      }),
    );
    const client = await asTenant(prisma, tenant.tenantId, (tx) =>
      tx.client.create({ data: { tenantId: tenant.tenantId, firstName: 'Ana' } }),
    );
    // A note by the atelier's owner (the actor, on side A), so the own-id control may delete it.
    const note = () =>
      asTenant(prisma, tenant.tenantId, async (tx) => {
        const n = await tx.clientNote.create({
          data: {
            tenantId: tenant.tenantId,
            clientId: client.id,
            authorMembershipId: member.id,
            body: 'Prefers silk',
          },
        });
        return n.id;
      });
    const { category, template } = await asTenant(prisma, tenant.tenantId, async (tx) => {
      const c = await tx.garmentCategory.create({
        data: { tenantId: tenant.tenantId, name: 'Barong' },
      });
      const t = await tx.measurementTemplate.create({
        data: { tenantId: tenant.tenantId, categoryId: c.id, version: 1 },
      });
      await tx.measurementField.create({
        data: {
          tenantId: tenant.tenantId,
          templateId: t.id,
          key: 'chest',
          label: 'Chest',
          sortOrder: 0,
        },
      });
      return { category: c, template: t };
    });
    // Records are corrected at most once, so each request gets its own.
    const record = () =>
      asTenant(prisma, tenant.tenantId, async (tx) => {
        const r = await tx.measurementRecord.create({
          data: {
            tenantId: tenant.tenantId,
            clientId: client.id,
            templateId: template.id,
            unit: 'CM',
            takenAt: new Date(),
            takenByMembershipId: member.id,
          },
        });
        await tx.measurementValue.create({
          data: { tenantId: tenant.tenantId, recordId: r.id, fieldKey: 'chest', value: '96' },
        });
        return r.id;
      });
    const appointmentType = await asTenant(prisma, tenant.tenantId, (tx) =>
      tx.appointmentType.create({
        data: { tenantId: tenant.tenantId, name: 'Fitting', kind: 'FITTING', durationMinutes: 60 },
      }),
    );
    const appointment = () =>
      asTenant(prisma, tenant.tenantId, async (tx) => {
        const startsAt = new Date(nextStart());
        const endsAt = new Date(startsAt.getTime() + 3600_000);
        const a = await tx.appointment.create({
          data: {
            tenantId: tenant.tenantId,
            clientId: client.id,
            typeId: appointmentType.id,
            staffMembershipId: colleague.id,
            startsAt,
            endsAt,
            blockedUntil: endsAt,
          },
        });
        return a.id;
      });
    const timeOff = () =>
      asTenant(prisma, tenant.tenantId, async (tx) => {
        const t = await tx.staffTimeOff.create({
          data: {
            tenantId: tenant.tenantId,
            membershipId: colleague.id,
            startsAt: new Date('2033-01-01T00:00:00Z'),
            endsAt: new Date('2033-01-02T00:00:00Z'),
          },
        });
        return t.id;
      });
    const catalog = await asTenant(prisma, tenant.tenantId, async (tx) => {
      const category = await tx.catalogCategory.create({
        data: { tenantId: tenant.tenantId, name: 'Gowns' },
      });
      const item = await tx.catalogItem.create({
        data: {
          tenantId: tenant.tenantId,
          kind: 'SERVICE',
          name: 'Alteration',
          pricingMode: 'QUOTE',
        },
      });
      const group = await tx.catalogOptionGroup.create({
        data: { tenantId: tenant.tenantId, name: 'Fabric', selection: 'SINGLE' },
      });
      const option = await tx.catalogOption.create({
        data: { tenantId: tenant.tenantId, groupId: group.id, name: 'Piña' },
      });
      return { category, item, group, option };
    });
    return {
      tenant,
      fresh: { clientNote: note, measurementRecord: record, appointment, timeOff },
      resources: {
        catalogCategory: catalog.category.id,
        catalogItem: catalog.item.id,
        optionGroup: catalog.group.id,
        catalogOption: catalog.option.id,
        appointmentType: appointmentType.id,
        garmentCategory: category.id,
        measurementTemplate: template.id,
        client: client.id,
        customRole: customRole.id,
        role: tenant.roles.staff!,
        membership: member.id,
        staffMember: colleague.id,
        holiday: holiday.id,
        invitation: invitation.id,
      },
    };
  }

  /**
   * Content hash of every row the victim atelier owns, in every tenant table plus its auth
   * tokens, so inserts, updates and deletes all change it (row counts miss updates).
   */
  async function footprint(t: TenantFixture): Promise<Record<string, string>> {
    const hash = (from: string) =>
      `SELECT md5(coalesce(string_agg(r::text, ',' ORDER BY r::text), '')) AS h FROM ${from}`;
    const out = await asTenant(prisma, t.tenantId, async (tx) => {
      const tables: Record<string, string> = {};
      for (const table of Object.values(TENANT_MODELS)) {
        const [r] = await tx.$queryRawUnsafe<{ h: string }[]>(hash(`"${table}" r`));
        tables[table] = r!.h;
      }
      return tables;
    });
    const [tokens] = await prisma.$queryRawUnsafe<{ h: string }[]>(
      hash(`(SELECT * FROM auth_token WHERE tenant_id = $1::uuid) r`),
      t.tenantId,
    );
    out.auth_token = tokens!.h;
    return out;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const ref = await Test.createTestingModule({
      imports: [
        CoreModule,
        HttpModule,
        AuthCoreModule,
        AuditModule,
        AuthModule,
        TenantsModule,
        ClientsModule,
        MeasurementsModule,
        AppointmentsModule,
        CatalogModule,
        PlatformModule,
      ],
    })
      .overrideProvider(MAILER)
      .useValue({ send: () => Promise.resolve() })
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue(new MemoryRateLimitStore())
      .compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init();
    prisma = app.get(UNSCOPED_PRISMA);
    routes = routesOf(app);

    // The actor owns atelier A. Atelier B belongs to someone else.
    const actor = await createUser(prisma);
    A = await side(actor.id);
    B = await side((await createUser(prisma)).id);
    const sessions = app.get(SessionService);
    const s = await sessions.create({
      realm: 'TENANT',
      subjectId: actor.id,
      tenantId: A.tenant.tenantId,
      activeMembershipId: A.resources.membership,
    });
    actorBrowser = new Browser(server, 'app.tahi.test');
    actorBrowser.cookies.set('__Host-tahi_app', s.token);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('every id in a tenant-scoped request is declared with @References()', () => {
    const undeclared = routes
      .filter((r) => r.access && TENANT_SCOPED_REALMS.has(r.access.realm))
      .flatMap((r) =>
        [...r.pathParams, ...uuidBodyFields(r.body), ...uuidBodyFields(r.query)]
          .filter((field) => !(field in r.references))
          .map((field) => `${r.operationId}: ${field}`),
      );
    expect(undeclared).toEqual([]);
  });

  it('every referencing route has a request sample', () => {
    const missing = routes.filter(
      (r) => Object.keys(r.references).length > 0 && !(r.operationId in SAMPLES),
    );
    expect(missing.map((r) => r.operationId)).toEqual([]);
  });

  it('finds the routes it is meant to cover', () => {
    const covered = routes
      .filter((r) => Object.keys(r.references).length > 0)
      .map((r) => r.operationId);
    expect(covered).toEqual(
      expect.arrayContaining([
        'InvitationsController.create',
        'InvitationsController.revoke',
        'RolesController.remove',
        'ClientsController.update',
        'ClientsController.deleteNote',
        'ClientsController.addCommunication',
        'GarmentCategoriesController.saveTemplate',
        'MeasurementsController.create',
        'MeasurementsController.record',
        'AppointmentsController.create',
        'AppointmentsController.slots',
        'AppointmentsController.list',
        'AppointmentsController.reschedule',
        'StaffScheduleController.deleteTimeOff',
        'CatalogItemsController.setOptionGroups',
        'CatalogItemsController.create',
        'OptionGroupsController.updateOption',
        'RolesController.update',
        'AuthController.switchTenant',
        'StaffController.update',
        'TenantSettingsController.deleteHoliday',
      ]),
    );
  });

  it('detects updates in the other atelier, not only inserts', async () => {
    const before = await footprint(B.tenant);
    await asTenant(prisma, B.tenant.tenantId, (tx) =>
      tx.role.update({ where: { id: B.resources.role! }, data: { name: `renamed-${suffix()}` } }),
    );
    expect(await footprint(B.tenant)).not.toEqual(before);
  });

  it('returns 404 for another atelier’s ids and writes nothing there', async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => Object.keys(r.references).length > 0)) {
      if (route.access?.realm !== 'tenant') {
        failures.push(`${route.operationId}: no actor for realm ${route.access?.realm}`);
        continue;
      }
      for (const field of Object.keys(route.references)) {
        const kind = route.references[field]!;
        /** Resolves the ids first (fresh fixtures write), then returns the request to fire. */
        const prepare = async (owner: Side) => {
          let path = route.path.replace(/^\/api\/v1\//, '');
          const body: Record<string, unknown> = SAMPLES[route.operationId]!();
          for (const [f, k] of Object.entries(route.references)) {
            // Only the field under test points at `owner`; the others stay valid for A.
            const who = f === field ? owner : A;
            const id = who.fresh[k] ? await who.fresh[k]() : who.resources[k];
            if (!id) throw new Error(`no fixture for resource kind ${k}`);
            if (route.pathParams.includes(f)) path = path.replace(`:${f}`, id);
            else body[f] = uuidFields(route.body).some((x) => x.name === f && x.array) ? [id] : id;
          }
          // GET routes take the sample and the ids as query parameters.
          const query = new URLSearchParams(body as Record<string, string>).toString();
          return () =>
            route.method === 'GET'
              ? actorBrowser.get(query ? `${path}?${query}` : path)
              : actorBrowser.send(
                  route.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete',
                  path,
                  body,
                );
        };

        const sendForeign = await prepare(B);
        const before = await footprint(B.tenant);
        const foreign = await sendForeign();
        const after = await footprint(B.tenant);
        if (foreign.status !== 404)
          failures.push(`${route.operationId} ${field}→${kind}: foreign id gave ${foreign.status}`);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          failures.push(`${route.operationId} ${field}: wrote to the other atelier`);
        }
        // Positive control: the request is otherwise valid, so the 404 above is tenancy.
        const own = await (await prepare(A))();
        if (own.status === 404 || own.status === 422 || own.status >= 500) {
          failures.push(
            `${route.operationId} ${field}: own id gave ${own.status} (sample broken?)`,
          );
        }
        // Routes that rotate the session (switch-tenant) set a new cookie; Browser keeps it.
      }
    }
    expect(failures).toEqual([]);
  });
});
