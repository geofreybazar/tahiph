import { Inject, Injectable } from '@nestjs/common';
import { errors, JWTVerifyGetKey, jwtVerify } from 'jose';
import { z } from 'zod';
import { Env } from '../config/env';
import { ENV } from '../config/env.token';
import { ApiException } from '../http/api-exception';
import { Principal } from '../request-context/request-context';

export const JWT_KEY_SET = Symbol('JWT_KEY_SET');

/** Asymmetric only: accepting HS256 would let a leaked or guessed secret forge tokens. */
const ALGORITHMS = ['ES256', 'RS256'];

const claimsSchema = z.object({
  sub: z.uuid(),
  email: z.email(),
  aal: z.string().optional(),
});

const unauthenticated = () => new ApiException(401, 'UNAUTHENTICATED', 'Sign in to continue');

@Injectable()
export class JwtVerifier {
  constructor(
    @Inject(JWT_KEY_SET) private readonly keySet: JWTVerifyGetKey,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        issuer: this.env.SUPABASE_JWT_ISSUER,
        audience: 'authenticated',
        algorithms: ALGORITHMS,
        requiredClaims: ['exp', 'sub'],
      });
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) throw unauthenticated();
      const { sub, email, aal } = claims.data;
      return { userId: sub, email: email.toLowerCase(), aal };
    } catch (error) {
      // Not being able to reach the keys is our outage, not the user's bad token.
      if (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) {
        throw unauthenticated();
      }
      throw error;
    }
  }
}
