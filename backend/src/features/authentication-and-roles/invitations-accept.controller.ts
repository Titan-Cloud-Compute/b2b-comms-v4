import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  sessionCookieOptions,
} from '../../auth/session-cookie';
import { InvitationsAcceptService } from './invitations-accept.service';

@Controller('api/invitations')
export class InvitationsAcceptController {
  constructor(
    private readonly service: InvitationsAcceptService,
    private readonly jwtService: JwtService,
  ) {}

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  async accept(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dto = (body ?? {}) as Record<string, unknown>;

    const token =
      typeof dto.token === 'string' ? dto.token.trim() : '';
    const password =
      typeof dto.password === 'string' ? dto.password : '';
    const displayName =
      typeof dto.display_name === 'string'
        ? dto.display_name.trim() || undefined
        : undefined;

    if (!token) {
      throw new BadRequestException({
        error: 'Invitation token is required',
        fields: { token: 'required' },
      });
    }
    if (password.length < 8) {
      throw new BadRequestException({
        error: 'Password must be at least 8 characters',
        fields: { password: 'min 8 characters' },
      });
    }

    const { user, project_id } = await this.service.accept(
      token,
      password,
      displayName,
    );

    const jwtToken = await this.jwtService.signAsync({
      userId: user.id,
      role: user.role,
      firmId: null,
      organizationId: user.organization_id,
    });
    res.cookie(
      SESSION_COOKIE_NAME,
      jwtToken,
      sessionCookieOptions(SESSION_MAX_AGE_MS),
    );

    return { user, project_id };
  }
}
