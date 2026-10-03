import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles, RequireUser } from '../../auth/roles.guard';
import type { UserRole } from '@prisma/client';
import { ChannelsService } from './channels.service';
import { MessagesService } from './messages.service';
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
 * Channel-scoped message routes: GET and POST messages.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/channels')
export class ChannelMessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** List messages in a channel (cursor-paged, newest first). */
  @Get(':id/messages')
  @RequireUser()
  listMessages(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.list(req.session, id, { cursor, limit });
  }

  /** Post a new message to a channel. */
  @Post(':id/messages')
  @HttpCode(201)
  @RequireUser()
  postMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { body_html?: unknown; attachments?: unknown },
  ) {
    return this.messages.create(req.session, id, body ?? {});
  }
}

/**
 * Individual message routes: PATCH (edit) and DELETE (soft-delete).
 */
@UseGuards(JwtAuthGuard)
@Controller('api/messages')
export class MessageController {
  constructor(private readonly messages: MessagesService) {}

  /** Edit a message. Only the author may do this. */
  @Patch(':id')
  @RequireUser()
  updateMessage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { body_html?: unknown },
  ) {
    return this.messages.update(req.session, id, body ?? {});
  }

  /** Soft-delete a message. Only the author may do this. */
  @Delete(':id')
  @HttpCode(204)
  @RequireUser()
  deleteMessage(@Req() req: Request, @Param('id') id: string) {
    return this.messages.remove(req.session, id);
  }
}
