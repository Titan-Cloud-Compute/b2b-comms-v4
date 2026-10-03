import { Module } from '@nestjs/common';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';
import { InvitationsAcceptController } from './invitations-accept.controller';
import { InvitationsAcceptService } from './invitations-accept.service';

@Module({
  controllers: [UsersAdminController, InvitationsAcceptController],
  providers: [UsersAdminService, InvitationsAcceptService],
})
export class AuthenticationAndRolesModule {}
