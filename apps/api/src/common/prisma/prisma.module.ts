import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client';
import { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { RequestContext } from '../request-context/request-context';
import { BASE_PRISMA } from './base-prisma.token';
import { createBasePrisma, createScopedPrisma } from './prisma-clients';
import { SCOPED_PRISMA } from './scoped-prisma.token';

@Global()
@Module({
  providers: [
    RequestContext,
    {
      provide: BASE_PRISMA,
      inject: [ENV],
      useFactory: (env: Env) => createBasePrisma(env.DATABASE_URL),
    },
    {
      provide: SCOPED_PRISMA,
      inject: [BASE_PRISMA, RequestContext],
      useFactory: (base: PrismaClient, context: RequestContext) =>
        createScopedPrisma(base, () => context.tenantId),
    },
  ],
  exports: [BASE_PRISMA, SCOPED_PRISMA, RequestContext],
})
export class PrismaModule implements OnModuleDestroy {
  constructor(@Inject(BASE_PRISMA) private readonly base: PrismaClient) {}

  onModuleDestroy() {
    return this.base.$disconnect();
  }
}
