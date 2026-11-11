import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ResponseSchema } from '../http/contract.js';
import { ActiveMember, Authenticated, Public, Realm, RequirePermission } from './decorators.js';
import { RouteAccessAudit, findUnconfiguredRoutes } from './route-audit.js';

@Controller('ok')
@Realm('tenant')
class ConfiguredController {
  @Get('a')
  @ResponseSchema(z.object({}))
  @RequirePermission('clients.read')
  a() {}

  @Get('b')
  @ResponseSchema(z.object({}))
  @Authenticated()
  b() {}

  @Get('c')
  @ResponseSchema(z.object({}))
  @ActiveMember()
  c() {}

  /** Not a route: helpers without path metadata are ignored. */
  helper() {}
}

@Controller('bad')
class UnconfiguredController {
  @Get('none')
  @ResponseSchema(z.object({}))
  none() {}

  @Get('realm-only')
  @ResponseSchema(z.object({}))
  @Realm('tenant')
  realmOnly() {}

  @Get('public-session')
  @ResponseSchema(z.object({}))
  @Realm('public')
  @Authenticated()
  publicWithSession() {}

  @Get('internal-auth')
  @ResponseSchema(z.object({}))
  @Realm('internal')
  @Authenticated()
  internalWithSession() {}

  @Get('ok')
  @ResponseSchema(z.object({}))
  @Realm('platform')
  @Public()
  fine() {}

  @Get('member-outside-tenant')
  @ResponseSchema(z.object({}))
  @Realm('customer')
  @ActiveMember()
  memberOutsideTenant() {}

  @Get('no-response')
  @Realm('platform')
  @Public()
  noResponse() {}
}

async function problemsFor(...controllers: (new () => unknown)[]) {
  @Module({ imports: [DiscoveryModule], controllers })
  class M {}
  const ref = await Test.createTestingModule({ imports: [M] }).compile();
  return findUnconfiguredRoutes(
    ref.get(DiscoveryService),
    ref.get(MetadataScanner),
    ref.get(Reflector),
  );
}

describe('route access audit (deny by default)', () => {
  it('accepts fully configured routes', async () => {
    expect(await problemsFor(ConfiguredController)).toEqual([]);
  });

  it('lists every route with missing or invalid configuration', async () => {
    expect((await problemsFor(UnconfiguredController)).sort()).toEqual([
      'UnconfiguredController.internalWithSession (access)',
      'UnconfiguredController.memberOutsideTenant (access)',
      'UnconfiguredController.noResponse (response schema)',
      'UnconfiguredController.none (access)',
      'UnconfiguredController.publicWithSession (access)',
      'UnconfiguredController.realmOnly (access)',
    ]);
  });

  it('stops the application from starting', async () => {
    @Module({
      imports: [DiscoveryModule],
      controllers: [UnconfiguredController],
      providers: [RouteAccessAudit],
    })
    class M {}
    const ref = await Test.createTestingModule({ imports: [M] }).compile();
    const app = ref.createNestApplication({ logger: false });
    await expect(app.init()).rejects.toThrow(/UnconfiguredController\.none/);
    await app.close().catch(() => undefined);
  });
});
