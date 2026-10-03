import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequireAdmin } from '../../auth/roles.guard';
import {
  CreateUserSchema,
  PatchUserSchema,
  UsersAdminService,
} from './users-admin.service';

@Controller('api/users')
@RequireAdmin()
export class UsersAdminController {
  constructor(private readonly usersAdmin: UsersAdminService) {}

  @Get()
  async list(
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(pageSizeRaw ?? '20', 10) || 20));
    return this.usersAdmin.list(page, pageSize);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown) {
    const dto = CreateUserSchema.parse(body ?? {});
    return this.usersAdmin.create(dto);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() body: unknown) {
    const dto = PatchUserSchema.parse(body ?? {});
    return this.usersAdmin.patch(id, dto);
  }
}
