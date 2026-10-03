import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequireUser, Roles } from '../../auth/roles.guard';
import { ChannelsService } from './channels.service';

/**
 * Auth: JwtAuthGuard and RolesGuard are registered globally (APP_GUARD in AuthModule).
 * @RequireUser / @Roles decorators set the role metadata that RolesGuard reads.
 */
@Controller('api/projects/:id/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequireUser()
  list(@Req() req: Request, @Param('id') projectId: string) {
    return this.channels.list(req.session, projectId);
  }

  @Post()
  @HttpCode(201)
  @Roles('MANAGER', 'ADMIN')
  create(
    @Req() req: Request,
    @Param('id') projectId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.channels.create(req.session, projectId, body);
  }
}
