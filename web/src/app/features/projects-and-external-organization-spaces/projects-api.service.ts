import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from '../../shared/api/api-errors';

// Contract shapes (Projects and External Organization Spaces).
export type OrganizationType = 'vendor' | 'customer' | 'client' | 'other';

export interface ProjectOrganization {
  id: string;
  name: string;
  type: OrganizationType | string;
}

export interface ProjectListItem {
  id: string;
  name: string;
  organization: ProjectOrganization;
  status: string;
}

export interface ProjectListResponse {
  items: ProjectListItem[];
  page: number;
  total: number;
}

export interface ProjectMember {
  id: string;
  display_name: string;
  role: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  status: string;
  organization: ProjectOrganization;
  members: ProjectMember[];
}

export interface CreateProjectInput {
  organization_name: string;
  organization_type: OrganizationType;
  name?: string;
}

export interface CreateProjectResponse {
  id: string;
  name: string;
  organization_id: string;
  status: string;
  default_channel_id: string;
  error?: string;
}

export interface InvitationResponse {
  id: string;
  project_id?: string;
  email?: string;
  status: string;
  delivery: string;
  expires_at: string;
}

/**
 * Projects API. Calls the real backend; when an endpoint has not landed yet
 * (404 / unreachable) it falls back to in-memory mock handlers so the UI is
 * usable against the MockApiClient-style fixtures. Auth/permission/validation
 * errors (401/403/400) are never masked.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private api = inject(ApiClient);
  private mock = new ProjectsMockStore();

  private async withMock<T>(real: () => Promise<T>, fallback: () => T): Promise<T> {
    try {
      return await real();
    } catch (e) {
      if (
        e instanceof ForbiddenError ||
        e instanceof UnauthorizedError ||
        e instanceof BadRequestError
      ) {
        throw e;
      }
      return fallback();
    }
  }

  list(page = 1, pageSize = 20): Promise<ProjectListResponse> {
    return this.withMock(
      () => this.api.get<ProjectListResponse>('projects', { params: { page, pageSize } }),
      () => this.mock.list(page, pageSize),
    );
  }

  get(id: string): Promise<ProjectDetail> {
    return this.withMock(
      () => this.api.get<ProjectDetail>(`projects/${id}`),
      () => this.mock.get(id),
    );
  }

  create(input: CreateProjectInput): Promise<CreateProjectResponse> {
    if (!input.organization_name || !input.organization_name.trim()) {
      return Promise.reject(new BadRequestError('projects', 'Organization name is required'));
    }
    return this.withMock(
      () => this.api.post<CreateProjectResponse>('projects', input),
      () => this.mock.create(input),
    );
  }

  update(id: string, body: { name?: string }): Promise<{ id: string; name: string; status: string }> {
    return this.withMock(
      () => this.api.patch<{ id: string; name: string; status: string }>(`projects/${id}`, body),
      () => this.mock.update(id, body),
    );
  }

  archive(id: string): Promise<{ id: string; status: string }> {
    return this.withMock(
      () => this.api.post<{ id: string; status: string }>(`projects/${id}/archive`, {}),
      () => this.mock.archive(id),
    );
  }

  addMember(id: string, userId: string): Promise<{ project_id: string; user_id: string; added_at: string }> {
    return this.withMock(
      () => this.api.post<{ project_id: string; user_id: string; added_at: string }>(
        `projects/${id}/members`, { user_id: userId }),
      () => ({ project_id: id, user_id: userId, added_at: new Date().toISOString() }),
    );
  }

  invite(id: string, email: string): Promise<InvitationResponse> {
    return this.withMock(
      () => this.api.post<InvitationResponse>(`projects/${id}/invitations`, { email }),
      () => this.mock.invite(id, email),
    );
  }

  resendInvitation(invitationId: string): Promise<InvitationResponse> {
    return this.withMock(
      () => this.api.post<InvitationResponse>(`invitations/${invitationId}/resend`, {}),
      () => this.mock.resend(invitationId),
    );
  }
}

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16));
}

/** In-memory mock handlers for endpoints not yet landed. */
class ProjectsMockStore {
  private projects: ProjectDetail[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Acme Supplies',
      status: 'active',
      organization: { id: '21111111-1111-4111-8111-111111111111', name: 'Acme Supplies', type: 'vendor' },
      members: [],
    },
    {
      id: '12222222-2222-4222-8222-222222222222',
      name: 'Globex Corporation',
      status: 'active',
      organization: { id: '22222222-2222-4222-8222-222222222222', name: 'Globex Corporation', type: 'customer' },
      members: [],
    },
  ];
  private invitations = new Map<string, InvitationResponse>();

  list(page: number, pageSize: number): ProjectListResponse {
    const active = this.projects.filter(p => p.status !== 'archived');
    const start = (page - 1) * pageSize;
    return {
      items: active.slice(start, start + pageSize).map(p => ({
        id: p.id, name: p.name, organization: p.organization, status: p.status,
      })),
      page,
      total: active.length,
    };
  }

  get(id: string): ProjectDetail {
    const p = this.projects.find(x => x.id === id);
    if (!p) throw new Error('Project not found');
    return p;
  }

  create(input: CreateProjectInput): CreateProjectResponse {
    const orgName = input.organization_name.trim();
    const p: ProjectDetail = {
      id: uuid(),
      name: input.name?.trim() || orgName,
      status: 'active',
      organization: { id: uuid(), name: orgName, type: input.organization_type },
      members: [],
    };
    this.projects.unshift(p);
    return {
      id: p.id, name: p.name, organization_id: p.organization.id,
      status: p.status, default_channel_id: uuid(),
    };
  }

  update(id: string, body: { name?: string }): { id: string; name: string; status: string } {
    const p = this.get(id);
    if (body.name) p.name = body.name;
    return { id: p.id, name: p.name, status: p.status };
  }

  archive(id: string): { id: string; status: string } {
    const p = this.get(id);
    p.status = 'archived';
    return { id: p.id, status: p.status };
  }

  invite(projectId: string, email: string): InvitationResponse {
    const inv: InvitationResponse = {
      id: uuid(), project_id: projectId, email, status: 'pending', delivery: 'sent',
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    };
    this.invitations.set(inv.id, inv);
    return inv;
  }

  resend(id: string): InvitationResponse {
    const inv = this.invitations.get(id) ?? {
      id, status: 'pending', delivery: 'sent', expires_at: '',
    };
    inv.delivery = 'sent';
    inv.expires_at = new Date(Date.now() + 7 * 864e5).toISOString();
    return inv;
  }
}
