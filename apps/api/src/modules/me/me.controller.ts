import { Controller, Get } from '@nestjs/common';
import { IdentityRepository } from '../../common/auth/identity.repository';
import { RequestContext } from '../../common/request-context/request-context';

@Controller('me')
export class MeController {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly context: RequestContext,
  ) {}

  @Get()
  async me() {
    const { userId, email } = this.context.principal!;
    const [memberships, isPlatformAdmin] = await Promise.all([
      this.identity.listActiveMemberships(userId),
      this.identity.isPlatformAdmin(userId),
    ]);
    return {
      id: userId,
      email,
      isPlatformAdmin,
      memberships: memberships.map(({ role, tenant }) => ({ role, ...tenant })),
    };
  }
}
