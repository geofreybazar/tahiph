import { Module } from '@nestjs/common';
import { MailerModule } from '../../core/email/email.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { InvitationsService } from './invitations.service.js';
import { OnboardingService } from './onboarding.service.js';
import { StaffService } from './staff.service.js';
import { TenantSettingsController } from './tenant-settings.controller.js';
import { TenantSettingsService } from './tenant-settings.service.js';
import {
  InvitationsController,
  OnboardingController,
  StaffController,
} from './tenants.controller.js';

@Module({
  imports: [AuthModule, MailerModule],
  controllers: [
    OnboardingController,
    InvitationsController,
    StaffController,
    TenantSettingsController,
  ],
  providers: [OnboardingService, InvitationsService, StaffService, TenantSettingsService],
})
export class TenantsModule {}
