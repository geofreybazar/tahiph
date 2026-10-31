import { Injectable } from '@nestjs/common';
import { TenantRole } from '@tahi/shared';
import { ClsService } from 'nestjs-cls';

export interface Principal {
  userId: string;
  email: string;
  aal: string | undefined;
}

@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService) {}

  get principal(): Principal | undefined {
    return this.cls.isActive() ? this.cls.get('principal') : undefined;
  }

  setPrincipal(principal: Principal): void {
    this.cls.set('principal', principal);
  }

  /** Undefined means no tenant, and the scoped client then refuses every operation. */
  get tenantId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('tenantId') : undefined;
  }

  get role(): TenantRole | undefined {
    return this.cls.isActive() ? this.cls.get('role') : undefined;
  }

  setTenant(tenantId: string, role: TenantRole): void {
    this.cls.set('tenantId', tenantId);
    this.cls.set('role', role);
  }

  /**
   * For work with no request, such as scheduled jobs. Awaits inside the context because Prisma
   * promises are lazy: returned unawaited, the query would run outside this tenant.
   */
  runInTenant<T>(tenantId: string, work: () => T | Promise<T>): Promise<T> {
    return this.cls.run({ ifNested: 'override' }, async () => {
      this.cls.set('tenantId', tenantId);
      return await work();
    });
  }
}
