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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { FileExplorerService, type Actor, type UploadedBlob } from './file-explorer.service';

function actorOf(req: Request): Actor | undefined {
  const s = req.session;
  return s?.userId ? { userId: s.userId, role: s.role } : undefined;
}

@ApiTags('file-explorer')
@UseGuards(JwtAuthGuard)
@Controller('api')
export class FileExplorerController {
  constructor(private readonly svc: FileExplorerService) {}

  @Get('projects/:id/files')
  list(
    @Param('id') projectId: string,
    @Query('folder_id') folderId: string | undefined,
    @Query('q') q: string | undefined,
    @Req() req: Request,
  ) {
    return this.svc.list(projectId, actorOf(req), folderId || null, q || null);
  }

  @Post('projects/:id/files')
  @HttpCode(201)
  // No multer size limit on purpose: the 100 MB cap is enforced by the policy
  // so oversized uploads get a 400 with a clear message instead of a 413.
  @UseInterceptors(FilesInterceptor('files', 50))
  upload(
    @Param('id') projectId: string,
    @UploadedFiles() files: UploadedBlob[] | undefined,
    @Body() body: { folder_id?: string } | undefined,
    @Req() req: Request,
  ) {
    return this.svc.upload(projectId, actorOf(req), body?.folder_id || null, files ?? []);
  }

  @Get('files/:id/download')
  download(@Param('id') id: string, @Req() req: Request) {
    return this.svc.download(id, actorOf(req));
  }

  @Get('files/:id/versions')
  versions(@Param('id') id: string, @Req() req: Request) {
    return this.svc.versions(id, actorOf(req));
  }

  @Patch('files/:id')
  updateFile(@Param('id') id: string, @Body() body: { name?: unknown; folder_id?: unknown }, @Req() req: Request) {
    return this.svc.updateFile(id, actorOf(req), body ?? {});
  }

  @Delete('files/:id')
  @HttpCode(204)
  async deleteFile(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.svc.deleteFile(id, actorOf(req));
  }

  @Post('projects/:id/folders')
  @HttpCode(201)
  createFolder(
    @Param('id') projectId: string,
    @Body() body: { name?: unknown; parent_id?: unknown },
    @Req() req: Request,
  ) {
    return this.svc.createFolder(projectId, actorOf(req), body ?? {});
  }

  @Patch('folders/:id')
  updateFolder(@Param('id') id: string, @Body() body: { name?: unknown; parent_id?: unknown }, @Req() req: Request) {
    return this.svc.updateFolder(id, actorOf(req), body ?? {});
  }

  @Delete('folders/:id')
  @HttpCode(204)
  async deleteFolder(@Param('id') id: string, @Req() req: Request): Promise<void> {
    await this.svc.deleteFolder(id, actorOf(req));
  }
}
