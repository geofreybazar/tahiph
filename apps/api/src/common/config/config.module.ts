import { Global, Module } from '@nestjs/common';
import { parseEnv } from './env';
import { ENV } from './env.token';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
