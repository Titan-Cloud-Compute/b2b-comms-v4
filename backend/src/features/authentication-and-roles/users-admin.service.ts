import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';

export const CreateUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  display_name: z.string().trim().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'USER']).default('USER'),
  organization_id: z.string().optional(),
});

export const PatchUserSchema = z.object({
  display_name: z.string().trim().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'USER']).optional(),
  active: z.boolean().optional(),
  email: z.string().trim().toLowerCase().email().optional(),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;
export type PatchUserDto = z.infer<typeof PatchUserSchema>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPublic(u: any) {
  return {
    id: u.id as string,
    email: u.email as string,
    display_name: (u.display_name ?? u.name ?? u.email) as string,
    role: u.role as string,
    organization_id: (u.organization_id ?? null) as string | null,
    active: (u.active ?? null) as boolean | null,
    created_at: (u.created_at ?? u.createdAt ?? null) as Date | null,
  };
}

@Injectable()
export class UsersAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, pageSize: number): Promise<{ items: ReturnType<typeof toPublic>[]; page: number; total: number }> {
    const skip = (page - 1) * pageSize;
    const result = await this.prisma.runAsAdmin(async (tx) => {
      const [users, total] = await Promise.all([
        tx.user.findMany({ skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
        tx.user.count(),
      ]);
      return { users, total };
    });
    return { items: result.users.map(toPublic), page, total: result.total };
  }

  async create(dto: CreateUserDto): Promise<ReturnType<typeof toPublic>> {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const now = new Date();

    const user = await this.prisma.runAsAdmin(async (tx) => {
      let orgId: string | null = dto.organization_id ?? null;
      if (!orgId) {
        const org = await tx.organizations.findFirst({ where: { is_internal: true } });
        if (org) {
          orgId = org.id as string;
        } else {
          const created = await tx.organizations.create({
            data: { name: 'Internal', type: 'internal', is_internal: true },
          });
          orgId = created.id as string;
        }
      }
      return tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          display_name: dto.display_name ?? null,
          role: dto.role as UserRole,
          organization_id: orgId,
          active: true,
          created_at: now,
        },
      });
    });

    return toPublic(user);
  }

  async patch(id: string, dto: PatchUserDto): Promise<{ id: string; email: string; display_name: string; role: string; active: boolean | null }> {
    const existing = await this.prisma.runAsAdmin((tx) =>
      tx.user.findUnique({ where: { id } }),
    );
    if (!existing) throw new NotFoundException('user not found');

    const data: Record<string, unknown> = {};
    if (dto.display_name !== undefined) data['display_name'] = dto.display_name;
    if (dto.role !== undefined) data['role'] = dto.role as UserRole;
    if (dto.active !== undefined) data['active'] = dto.active;
    if (dto.email !== undefined) data['email'] = dto.email;

    const updated = await this.prisma.runAsAdmin((tx) =>
      tx.user.update({ where: { id }, data }),
    );

    return {
      id: updated.id,
      email: updated.email,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      display_name: ((updated as any).display_name ?? updated.name ?? updated.email) as string,
      role: updated.role as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      active: ((updated as any).active ?? null) as boolean | null,
    };
  }
}
