import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  transferOwnershipSchema,
  updateMemberSchema,
  updateTenantSchema,
} from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { MembersService } from './members.service';

class CreateInvitationDto extends createZodDto(createInvitationSchema) {}
class AcceptInvitationDto extends createZodDto(acceptInvitationSchema) {}
class UpdateMemberDto extends createZodDto(updateMemberSchema) {}
class TransferOwnershipDto extends createZodDto(transferOwnershipSchema) {}
class UpdateTenantDto extends createZodDto(updateTenantSchema) {}

@Controller()
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @TenantRoute('members:manage')
  @Get('members')
  list() {
    return this.members.listMembers();
  }

  @TenantRoute('ownership:transfer')
  @Post('members/transfer-ownership')
  @HttpCode(204)
  transfer(@Body() body: TransferOwnershipDto) {
    return this.members.transferOwnership(body.membershipId);
  }

  @TenantRoute('members:manage')
  @Patch('members/:id')
  changeRole(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateMemberDto) {
    return this.members.changeRole(id, body.role);
  }

  @TenantRoute('members:manage')
  @Delete('members/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.remove(id);
  }

  @TenantRoute('members:manage')
  @Get('invitations')
  listInvitations() {
    return this.members.listInvitations();
  }

  @TenantRoute('members:manage')
  @Post('invitations')
  invite(@Body() body: CreateInvitationDto) {
    return this.members.invite(body);
  }

  @TenantRoute('members:manage')
  @Delete('invitations/:id')
  @HttpCode(204)
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.revokeInvitation(id);
  }
}

/** Any signed-in user: there's no tenant membership yet. */
@Controller('invitations/accept')
export class AcceptInvitationController {
  constructor(private readonly members: MembersService) {}

  @Post()
  @HttpCode(200)
  accept(@Body() body: AcceptInvitationDto) {
    return this.members.acceptInvitation(body.token);
  }
}

@Controller('tenant')
export class TenantController {
  constructor(private readonly members: MembersService) {}

  @TenantRoute()
  @Get()
  get() {
    return this.members.getTenant();
  }

  @TenantRoute('tenant:update')
  @Patch()
  update(@Body() body: UpdateTenantDto) {
    return this.members.updateTenant(body.name);
  }
}
