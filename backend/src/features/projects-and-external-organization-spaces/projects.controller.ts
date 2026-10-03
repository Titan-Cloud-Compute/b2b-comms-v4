import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ProjectsService } from './projects.service';

/** Auth: JwtAuthGuard is registered globally (APP_GUARD); role/membership rules live in ProjectsService. */
@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() req: Request, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.projects.list(req.session, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post()
  @HttpCode(201)
  create(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.projects.create(req.session, body);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.projects.get(req.session, id);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.projects.update(req.session, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Req() req: Request, @Param('id') id: string) {
    return this.projects.archive(req.session, id);
  }

  @Post(':id/members')
  @HttpCode(201)
  addMember(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.projects.addMember(req.session, id, body);
  }

  @Post(':id/invitations')
  @HttpCode(201)
  invite(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.projects.invite(req.session, id, body);
  }
}
