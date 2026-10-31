import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { AccessGuard } from './access.guard';
import { AuthGuard } from './auth.guard';
import { IdentityRepository } from './identity.repository';
import { JWT_KEY_SET, JwtVerifier } from './jwt-verifier';

@Global()
@Module({
  providers: [
    {
      provide: JWT_KEY_SET,
      inject: [ENV],
      useFactory: (env: Env) => createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL)),
    },
    JwtVerifier,
    IdentityRepository,
    // Order matters: authentication runs before tenant and role checks.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [IdentityRepository],
})
export class AuthModule {}
