import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { SECRET_BOX, SecretBox } from './secret-box.js';

@Global()
@Module({
  providers: [
    {
      provide: SECRET_BOX,
      inject: [ENV],
      useFactory: (env: Env) => SecretBox.fromEnv(env.ENCRYPTION_KEYS),
    },
  ],
  exports: [SECRET_BOX],
})
export class CryptoModule {}
