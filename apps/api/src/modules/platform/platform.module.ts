import { Module } from '@nestjs/common';
import { PlatformAuthController } from './auth/platform-auth.controller.js';
import { PlatformAuthService } from './auth/platform-auth.service.js';

/** Platform administration (admin.tahi.ph). Tenant management arrives in Phase 7. */
@Module({
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService],
})
export class PlatformModule {}
