import { Module } from '@nestjs/common';
import {
  AcceptInvitationController,
  MembersController,
  TenantController,
} from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [MembersController, AcceptInvitationController, TenantController],
  providers: [MembersService],
})
export class MembersModule {}
