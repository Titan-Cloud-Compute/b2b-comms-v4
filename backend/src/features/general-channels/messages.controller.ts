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
} from '@nestjs/common';
import type { Request } from 'express';
import { RequireUser } from '../../auth/roles.guard';
import { MessagesService } from './messages.service';

@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('api/channels/:id/messages')
  @RequireUser()
  list(
    @Req() req: Request,
    @Param('id') channelId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.list(req.session, channelId, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('api/channels/:id/messages')
  @HttpCode(201)
  @RequireUser()
  create(
    @Req() req: Request,
    @Param('id') channelId: string,
    @Body() body: unknown,
  ) {
    return this.messages.create(req.session, channelId, body);
  }

  @Patch('api/messages/:id')
  @RequireUser()
  update(
    @Req() req: Request,
    @Param('id') messageId: string,
    @Body() body: unknown,
  ) {
    return this.messages.update(req.session, messageId, body);
  }

  @Delete('api/messages/:id')
  @HttpCode(204)
  @RequireUser()
  async remove(
    @Req() req: Request,
    @Param('id') messageId: string,
  ) {
    await this.messages.remove(req.session, messageId);
  }
}
