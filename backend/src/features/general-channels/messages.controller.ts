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
import { RequireUser } from '../../auth/roles.guard';
import { MessagesService } from './messages.service';

/**
 * Channel-scoped message routes.
 * GET  /api/channels/:id/messages  — cursor-paged history
 * POST /api/channels/:id/messages  — post a new message (201)
 */
@UseGuards(JwtAuthGuard)
@Controller('api/channels')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get(':id/messages')
  @RequireUser()
  list(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.list(req.session!, id, { cursor, limit });
  }

  @Post(':id/messages')
  @HttpCode(201)
  @RequireUser()
  create(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.messages.create(req.session!, id, body ?? {});
  }
}

/**
 * Message-level actions (not scoped to a channel path).
 * PATCH  /api/messages/:id  — edit own message (200)
 * DELETE /api/messages/:id  — soft-delete own message (204)
 */
@UseGuards(JwtAuthGuard)
@Controller('api/messages')
export class MessageActionsController {
  constructor(private readonly messages: MessagesService) {}

  @Patch(':id')
  @RequireUser()
  update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.messages.update(req.session!, id, body ?? {});
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireUser()
  async remove(@Req() req: Request, @Param('id') id: string) {
    await this.messages.remove(req.session!, id);
  }
}
