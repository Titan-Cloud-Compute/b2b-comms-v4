import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { InvitationsController } from './invitations.controller';
import { ProjectsService } from './projects.service';
import { InvitationMailerService } from './invitation-mailer.service';

@Module({
  controllers: [ProjectsController, InvitationsController],
  providers: [ProjectsService, InvitationMailerService],
  exports: [ProjectsService],
})
export class ProjectsAndExternalOrganizationSpacesModule {}
