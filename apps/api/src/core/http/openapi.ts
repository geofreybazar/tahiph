import { apiErrorSchema } from '@tahi/validation';
import { z } from 'zod';
import { SESSION_COOKIES } from '../auth/cookies.js';
import { CSRF_HEADER } from '../auth/csrf.js';
import type { RouteInfo } from './route-inventory.js';

type Json = Record<string, unknown>;

function schemaOf(schema: z.ZodType, io: 'input' | 'output'): Json {
  // Refinements and transforms cannot be expressed in JSON Schema; they are enforced at runtime.
  const s = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as Json;
  delete s.$schema;
  return s;
}

const REALM_SECURITY: Record<string, string | undefined> = {
  tenant: 'staffSession',
  platform: 'adminSession',
  customer: 'customerSession',
};

const REALM_HOSTS: Record<string, string> = {
  tenant: 'Dashboard host (app.tahi.ph)',
  platform: 'Admin host (admin.tahi.ph)',
  public: 'Storefront hosts ({slug}.tahi.ph, custom domains)',
  customer: 'Storefront hosts ({slug}.tahi.ph, custom domains)',
  internal: 'Any host (internal)',
};

const ERROR_RESPONSE = {
  description: 'Error envelope',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
};

/** Builds the OpenAPI 3.1 document from the route inventory (ADR-023). */
export function buildOpenApiDocument(routes: RouteInfo[], info: { version: string }): Json {
  const paths: Record<string, Json> = {};
  for (const r of routes) {
    const realm = r.access?.realm ?? 'internal';
    const parameters: Json[] = r.pathParams.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: r.params
        ? ((schemaOf(r.params, 'input').properties as Json | undefined)?.[name] ?? {
            type: 'string',
          })
        : { type: 'string' },
    }));
    if (r.query) {
      const q = schemaOf(r.query, 'input');
      const required = new Set((q.required as string[] | undefined) ?? []);
      for (const [name, schema] of Object.entries((q.properties as Json | undefined) ?? {})) {
        parameters.push({ name, in: 'query', required: required.has(name), schema });
      }
    }
    const unsafe = r.method !== 'GET';
    if (unsafe && realm !== 'internal') {
      parameters.push({
        name: CSRF_HEADER,
        in: 'header',
        required: true,
        description:
          'Double-submit CSRF token from the __Host-tahi_csrf cookie. Origin must match the host.',
        schema: { type: 'string' },
      });
    }
    const data = r.response
      ? r.response.paginated
        ? { type: 'array', items: schemaOf(r.response.schema, 'output') }
        : schemaOf(r.response.schema, 'output')
      : {};
    const envelope: Json = { type: 'object', required: ['data'], properties: { data } };
    if (r.response?.paginated) {
      (envelope.properties as Json).meta = { $ref: '#/components/schemas/PaginationMeta' };
    }
    const security = r.access?.mode === 'public' ? [] : [{ [REALM_SECURITY[realm] ?? 'none']: [] }];
    const op: Json = {
      operationId: r.operationId,
      tags: [realm],
      description: `${REALM_HOSTS[realm] ?? realm}.`,
      'x-tahi-realm': realm,
      'x-tahi-access': r.access?.mode ?? 'unconfigured',
      ...(r.access?.permissions.length ? { 'x-tahi-permissions': r.access.permissions } : {}),
      ...(Object.keys(r.references).length ? { 'x-tahi-references': r.references } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: schemaOf(r.body, 'input') } },
            },
          }
        : {}),
      security,
      responses: {
        [String(r.status)]: {
          description: 'Success',
          content: { 'application/json': { schema: envelope } },
        },
        default: ERROR_RESPONSE,
      },
    };
    const path = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    paths[path] = { ...(paths[path] ?? {}), [r.method.toLowerCase()]: op };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'TAHI.ph API',
      version: info.version,
      description:
        'Generated from the Zod contracts in @tahi/validation (ADR-023). Every endpoint is served on the host of its realm; tenant context is never a request field.',
    },
    paths,
    components: {
      schemas: {
        ApiError: schemaOf(apiErrorSchema, 'output'),
        PaginationMeta: {
          type: 'object',
          required: ['nextCursor', 'hasMore'],
          properties: { nextCursor: { type: ['string', 'null'] }, hasMore: { type: 'boolean' } },
        },
      },
      securitySchemes: {
        staffSession: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIES.TENANT },
        adminSession: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIES.PLATFORM },
        customerSession: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIES.CUSTOMER },
      },
    },
  };
}
