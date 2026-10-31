import { Controller, Get, Inject, Param } from '@nestjs/common';
import { isValidTenantSlug } from '@tahi/shared';
import { Public } from '../../common/auth/decorators';
import { ApiException } from '../../common/http/api-exception';
import { BASE_PRISMA } from '../../common/prisma/base-prisma.token';
import { PrismaClient } from '../../generated/prisma/client';

@Controller('public/sites')
export class PublicSitesController {
  constructor(@Inject(BASE_PRISMA) private readonly prisma: PrismaClient) {}

  /** Selects only public fields. Unavailable sites return no details beyond that fact. */
  @Public()
  @Get(':slug')
  async resolve(@Param('slug') slug: string) {
    const tenant = isValidTenantSlug(slug)
      ? await this.prisma.tenant.findUnique({
          where: { slug },
          select: { slug: true, name: true, status: true },
        })
      : null;
    if (!tenant) throw new ApiException(404, 'NOT_FOUND', 'Site not found');

    return tenant.status === 'active'
      ? { slug: tenant.slug, name: tenant.name, available: true }
      : { slug: tenant.slug, available: false };
  }
}
