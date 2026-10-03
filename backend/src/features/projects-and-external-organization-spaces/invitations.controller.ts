import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { ProjectsService } from './projects.service';

@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly projects: ProjectsService) {}

  /** The invited contact follows the emailed link and submits a password. */
  @Public()
  @Post('accept')
  @HttpCode(201)
  accept(@Body() body: Record<string, unknown>) {
    return this.projects.accept(body);
  }

  @Post(':id/resend')
  @HttpCode(200)
  resend(@Req() req: Request, @Param('id') id: string) {
    return this.projects.resend(req.session, id);
  }
}
