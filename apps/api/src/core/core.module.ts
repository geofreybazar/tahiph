import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { ContextModule } from './context/context.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { DatabaseModule } from './database/database.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { RedisModule } from './redis/redis.module.js';

/** Infrastructure shared by the HTTP API and the worker. */
@Module({
  imports: [ConfigModule, ContextModule, CryptoModule, LoggingModule, DatabaseModule, RedisModule],
})
export class CoreModule {}
