import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles, RequireUser } from '../../auth/roles.guard';
import type { UserRole } from '@prisma/client';
import { ChannelsService } from './channels.service';
import type { CreateChannelRequest } from './general-channels.types';

/**
 * Project-scoped channels: list and create.
 *
 * JwtAuthGuard validates the session cookie (or is replaced by a stub in tests).
 * Role enforcement for POST is also done in ChannelsService.create so it works
 * in unit tests where the global APP_GUARD RolesGuard does not run.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/projects/:id/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  /** List channels for a project.  Any authenticated user may call this;
   *  the service enforces project-membership access. */
  @Get()
  @RequireUser()
  list(@Req() req: Request, @Param('id') id: string) {
    return this.channels.list(req.session, id);
  }

  /** Create a general channel.  Only ADMIN or MANAGER may do this. */
  @Post()
  @HttpCode(201)
  @Roles('MANAGER' as UserRole, 'ADMIN' as UserRole)
  create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateChannelRequest,
  ) {
    return this.channels.create(req.session, id, body ?? {});
  }
}

/**
 * Re-exported alias kept for backward-compatibility with existing imports.
 * The real GET :id/messages route lives in MessagesController (messages.controller.ts).
 */
export { MessagesController as ChannelMessagesController } from './messages.controller';
