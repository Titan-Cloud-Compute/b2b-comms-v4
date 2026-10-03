import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AcceptResult {
  user: {
    id: string;
    email: string;
    role: string;
    organization_id: string | null;
  };
  project_id: string | null;
}

const INVALID_MSG = 'This invitation is invalid, expired or already used';

@Injectable()
export class InvitationsAcceptService {
  constructor(private readonly prisma: PrismaService) {}

  async accept(
    token: string,
    password: string,
    displayName?: string,
  ): Promise<AcceptResult> {
    const tokenHash = createHash('sha256').update(token.trim()).digest('hex');
    const now = new Date();

    const invitation = await this.prisma.runAsAdmin((tx) =>
      tx.invitations.findFirst({ where: { token_hash: tokenHash } }),
    );

    if (
      !invitation ||
      invitation.status !== 'pending' ||
      !invitation.expires_at ||
      invitation.expires_at.getTime() <= now.getTime()
    ) {
      throw new BadRequestException({ error: INVALID_MSG });
    }

    const email = (invitation.email as string).toLowerCase();

    const existingUser = await this.prisma.runAsAdmin((tx) =>
      tx.user.findUnique({ where: { email } }),
    );
    if (existingUser) {
      throw new BadRequestException({ error: INVALID_MSG });
    }

    const project = invitation.project_id
      ? await this.prisma.runAsAdmin((tx) =>
          tx.projects.findUnique({ where: { id: invitation.project_id as string } }),
        )
      : null;
    const organizationId: string | null = (project as { organization_id?: string | null } | null)?.organization_id ?? null;

    const passwordHash = await bcrypt.hash(password, 10);

    let createdUser: AcceptResult['user'];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await this.prisma.runAsAdmin((tx) =>
        tx.user.create({
          data: {
            email,
            passwordHash,
            display_name: displayName ?? email,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            role: 'USER' as any,
            organization_id: organizationId,
            active: true,
            created_at: now,
          },
        }),
      );
      createdUser = {
        id: raw.id as string,
        email: raw.email as string,
        role: (raw.role as string) ?? 'USER',
        organization_id: (raw.organization_id as string | null) ?? null,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException({ error: INVALID_MSG });
      }
      throw err;
    }

    return {
      user: createdUser,
      project_id: (invitation.project_id as string | null) ?? null,
    };
  }
}
