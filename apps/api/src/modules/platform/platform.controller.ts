import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { createTenantSchema, paginationQuerySchema } from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { AuditService } from '../../common/auth/audit.service';
import { PlatformRoute } from '../../common/auth/decorators';
import { InvitationIssuer } from '../../common/auth/invitation-issuer';
import { ApiException } from '../../common/http/api-exception';
import { Paginated } from '../../common/http/paginated';
import { BASE_PRISMA } from '../../common/prisma/base-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { PrismaClient, TenantStatus } from '../../generated/prisma/client';

class CreateTenantDto extends createZodDto(createTenantSchema) {}
class ListTenantsDto extends createZodDto(paginationQuerySchema) {}

const TENANT_FIELDS = { id: true, name: true, slug: true, status: true, createdAt: true } as const;

@Controller('platform/tenants')
@PlatformRoute()
export class PlatformController {
  constructor(
    @Inject(BASE_PRISMA) private readonly prisma: PrismaClient,
    private readonly issuer: InvitationIssuer,
    private readonly audit: AuditService,
    private readonly context: RequestContext,
  ) {}

  @Get()
  async list(@Query() query: ListTenantsDto) {
    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        select: TENANT_FIELDS,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.tenant.count(),
    ]);
    return new Paginated(items, query, total);
  }

  @Post()
  async create(@Body() { name, slug, ownerEmail }: CreateTenantDto) {
    let tenant;
    try {
      tenant = await this.prisma.tenant.create({ data: { name, slug }, select: TENANT_FIELDS });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      throw new ApiException(409, 'CONFLICT', 'This web address is already taken');
    }
    const invitation = await this.issuer.issue(
      tenant.id,
      ownerEmail,
      'owner',
      this.context.principal!.userId,
    );
    await this.audit.record({
      action: 'tenant.created',
      tenantId: tenant.id,
      entityType: 'tenant',
      entityId: tenant.id,
    });
    return { tenant, invitation };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        ...TENANT_FIELDS,
        _count: { select: { memberships: { where: { status: 'active' } } } },
      },
    });
    if (!tenant) throw new ApiException(404, 'NOT_FOUND', 'Business not found');
    const { _count, ...rest } = tenant;
    return { ...rest, memberCount: _count.memberships };
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id', ParseUUIDPipe) id: string) {
    return this.setStatus(id, 'suspended', 'tenant.suspended');
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.setStatus(id, 'active', 'tenant.activated');
  }

  private async setStatus(id: string, status: TenantStatus, action: string) {
    const { count } = await this.prisma.tenant.updateMany({ where: { id }, data: { status } });
    if (count === 0) throw new ApiException(404, 'NOT_FOUND', 'Business not found');
    await this.audit.record({ action, tenantId: id, entityType: 'tenant', entityId: id });
    return { id, status };
  }
}
