import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ReferencesService, type Actor } from './references.service';

function actorOf(req: Request): Actor | undefined {
  const s = req.session;
  return s?.userId ? { userId: s.userId, role: s.role } : undefined;
}

/** Message Reference and Annotation endpoints. Membership / authorship rules live in ReferencesService. */
@ApiTags('message-reference-and-annotation')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class ReferencesController {
  constructor(private readonly svc: ReferencesService) {}

  @Post('messages/:id/reference')
  @HttpCode(201)
  create(@Param('id') messageId: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.svc.create(messageId, actorOf(req), body);
  }

  @Get('references')
  list(@Query('message_ids') messageIds: string | undefined, @Req() req: Request) {
    return this.svc.listForMessages(messageIds, actorOf(req));
  }

  @Get('references/:id')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.svc.get(id, actorOf(req));
  }

  @Put('references/:id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.svc.update(id, actorOf(req), body);
  }

  @Delete('references/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.svc.remove(id, actorOf(req));
  }

  @Get('file-versions/:id/pages/:page')
  async page(
    @Param('id') versionId: string,
    @Param('page') page: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const rendered = await this.svc.pageImage(versionId, page, actorOf(req));
    res.setHeader('Content-Type', rendered.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(rendered.body, { type: rendered.contentType });
  }
}
