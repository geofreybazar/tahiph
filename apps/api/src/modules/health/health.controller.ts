import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../../common/auth/decorators';
import { ApiException } from '../../common/http/api-exception';
import { BASE_PRISMA } from '../../common/prisma/base-prisma.token';
import { PrismaClient } from '../../generated/prisma/client';

@Controller('health')
export class HealthController {
  constructor(@Inject(BASE_PRISMA) private readonly prisma: PrismaClient) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiException(503, 'INTERNAL_ERROR', 'Database unavailable');
    }
    return { status: 'ok' };
  }
}
