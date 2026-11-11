import { Module } from '@nestjs/common';
import { MailerModule } from '../../core/email/email.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { InvitationsService } from './invitations.service.js';
import { OnboardingService } from './onboarding.service.js';
import { InvitationsController, OnboardingController } from './tenants.controller.js';

@Module({
  imports: [AuthModule, MailerModule],
  controllers: [OnboardingController, InvitationsController],
  providers: [OnboardingService, InvitationsService],
})
export class TenantsModule {}
