import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiException } from '../http/api-exception';
import { RequestContext } from '../request-context/request-context';
import { RouteAccess, ROUTE_ACCESS } from './decorators';
import { IdentityRepository } from './identity.repository';
import { JwtVerifier } from './jwt-verifier';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
    private readonly identity: IdentityRepository,
    private readonly context: RequestContext,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [
      execution.getHandler(),
      execution.getClass(),
    ]);
    if (access?.kind === 'public') return true;

    const header = execution.switchToHttp().getRequest<Request>().headers.authorization;
    const token = /^Bearer (\S+)$/i.exec(header ?? '')?.[1];
    if (!token) throw new ApiException(401, 'UNAUTHENTICATED', 'Sign in to continue');

    const principal = await this.verifier.verify(token);
    await this.identity.syncUser(principal);
    this.context.setPrincipal(principal);
    return true;
  }
}
