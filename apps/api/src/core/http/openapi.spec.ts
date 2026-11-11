import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { configureApp } from './configure-app.js';
import { openApiDocumentOf, routesOf } from './openapi.factory.js';

type Doc = { paths: Record<string, Record<string, Record<string, unknown>>> };

/** The generated document against the real AppModule (no connections are opened). */
describe('OpenAPI document (ADR-023)', () => {
  let app: INestApplication;
  let doc: Doc;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://u:p@127.0.0.1:1/db';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication({ logger: false });
    configureApp(app, { TRUST_PROXY: 'loopback' });
    await app.init(); // also runs the boot-time route audit
    doc = openApiDocumentOf(app) as unknown as Doc;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('computes exactly the paths Express routes', () => {
    const express = app.getHttpAdapter().getInstance() as {
      router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
    };
    const registered = express.router.stack
      // Nest adds a wildcard catch-all (all methods) for URI versioning; it is not an endpoint.
      .filter((l) => l.route && !l.route.path.includes('*'))
      .flatMap((l) =>
        Object.keys(l.route!.methods).map((m) => `${m.toUpperCase()} ${l.route!.path}`),
      )
      .sort();
    const computed = routesOf(app)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(computed).toEqual(registered);
  });

  it('documents request bodies, envelopes, status codes and realms', () => {
    const login = doc.paths['/api/v1/auth/login']!.post!;
    expect(login['x-tahi-realm']).toBe('tenant');
    expect(JSON.stringify(login.requestBody)).toContain('"password"');
    expect(Object.keys(login.responses as object)).toEqual(['200', 'default']);
    const register = doc.paths['/api/v1/auth/register']!.post!;
    expect(Object.keys(register.responses as object)).toContain('202');

    const invite = doc.paths['/api/v1/tenant/invitations']!.post!;
    expect(invite['x-tahi-permissions']).toEqual(['staff.manage']);
    expect(invite['x-tahi-references']).toEqual({ roleId: 'role' });
    expect(invite.security).toEqual([{ staffSession: [] }]);
    expect(JSON.stringify(invite.parameters)).toContain('x-csrf-token');

    expect(doc.paths['/api/health/live']!.get!.security).toEqual([]);
    expect(doc.paths['/api/v1/platform/auth/me']!.get!.security).toEqual([{ adminSession: [] }]);
  });

  it('never exposes a tenant id or secrets as a request or response field', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toMatch(/tenant_?id/i);
    expect(json).not.toMatch(/passwordHash|tokenHash|mfaSecret/);
  });
});
