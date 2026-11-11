import { Module } from '@nestjs/common';
import { MailerModule } from '../../core/email/email.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CustomerAuthController } from './customer/customer-auth.controller.js';
import { CustomerAuthService } from './customer/customer-auth.service.js';

@Module({
  imports: [MailerModule],
  controllers: [AuthController, CustomerAuthController],
  providers: [AuthService, CustomerAuthService],
  exports: [AuthService],
})
export class AuthModule {}
