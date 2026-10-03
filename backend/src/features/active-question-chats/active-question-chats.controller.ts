import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ActiveQuestionChatsService, type Actor } from './active-question-chats.service';

export function actorOf(req: Request): Actor | undefined {
  const s = req.session;
  return s?.userId ? { userId: s.userId, role: s.role, organizationId: s.organizationId ?? null } : undefined;
}

@ApiTags('active-question-chats')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class ActiveQuestionChatsController {
  constructor(private readonly svc: ActiveQuestionChatsService) {}

  @Get('projects/:id/questions')
  list(@Param('id') projectId: string, @Req() req: Request) {
    return this.svc.list(projectId, actorOf(req));
  }

  @Post('projects/:id/questions')
  @HttpCode(201)
  create(
    @Param('id') projectId: string,
    @Body() body: { title?: unknown; name?: unknown; message?: unknown; body_html?: unknown } | undefined,
    @Req() req: Request,
  ) {
    return this.svc.create(projectId, actorOf(req), body ?? {});
  }

  @Get('questions/:id')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.svc.get(id, actorOf(req));
  }

  @Get('questions/:id/messages')
  messages(@Param('id') id: string, @Req() req: Request) {
    return this.svc.listMessages(id, actorOf(req));
  }

  @Post('questions/:id/messages')
  @HttpCode(201)
  postMessage(
    @Param('id') id: string,
    @Body() body: { body_html?: unknown; message?: unknown } | undefined,
    @Req() req: Request,
  ) {
    return this.svc.postMessage(id, actorOf(req), body ?? {});
  }

  @Post('questions/:id/resolve')
  @HttpCode(200)
  resolve(@Param('id') id: string, @Req() req: Request) {
    return this.svc.resolve(id, actorOf(req));
  }

  @Delete('questions/:id/resolve')
  @HttpCode(200)
  unresolve(@Param('id') id: string, @Req() req: Request) {
    return this.svc.unresolve(id, actorOf(req));
  }
}
