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
import { ChannelAccessService } from './channel-access.service';
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
 * Channel-scoped routes (not project-prefixed).
 * Currently: GET messages with access enforcement.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/channels')
export class ChannelMessagesController {
  constructor(private readonly access: ChannelAccessService) {}

  /** List messages in a channel.
   *  Returns 403 if the caller cannot access the channel (e.g. external user
   *  on an internal-only channel). */
  @Get(':id/messages')
  @RequireUser()
  async listMessages(@Req() req: Request, @Param('id') id: string) {
    await this.access.assertChannelAccess(req.session, id);
    // Message fetching is owned by a later unit; return a typed placeholder.
    return { items: [], next_cursor: null };
  }
}
