import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { ApiClient } from '../../shared/api/api-client';
import { ActiveQuestionsComponent } from '../active-question-chats/active-questions.component';
import {
  InvitationResponse,
  ProjectDetail,
  ProjectsApi,
} from './projects-api.service';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, ActiveQuestionsComponent],
  template: `
    @if (error()) { <p class="error" role="alert" data-testid="project-error">{{ error() }}</p> }
    @if (project(); as p) {
      <section class="project-detail" data-testid="project-detail">
        <header>
          <h1 data-testid="project-heading">{{ p.organization.name }}</h1>
          <span data-testid="project-status">{{ p.status }}</span>
          @if (isAdmin() && p.status !== 'archived') {
            <button type="button" data-testid="archive-project" (click)="archive()">Archive</button>
          }
          @if (canInvite() && p.status !== 'archived') {
            <button type="button" data-testid="open-invite" (click)="inviteOpen.set(true)">Invite external contact</button>
          }
        </header>

        @if (inviteOpen()) {
          <form data-testid="invite-dialog" role="dialog" (ngSubmit)="invite()">
            <label>
              Email
              <input data-testid="invite-email" name="email" type="email" [(ngModel)]="inviteEmail" />
            </label>
            <button type="submit" data-testid="send-invite">Send invite</button>
            <button type="button" (click)="inviteOpen.set(false)">Cancel</button>
            @if (inviteError()) { <p class="error" role="alert">{{ inviteError() }}</p> }
          </form>
        }
        @if (invitation(); as inv) {
          @if (inv.delivery === 'failed') {
            <div data-testid="delivery-failed" role="alert">
              Invitation saved, but the email could not be delivered.
              <button type="button" data-testid="resend-invite" (click)="resend(inv.id)">Resend</button>
            </div>
          } @else {
            <p data-testid="invite-sent">Invitation sent to {{ inv.email }}.</p>
          }
        }

        <section data-testid="project-files" class="file-explorer">
          <h2>Files</h2>
          <a data-testid="open-file-explorer" [routerLink]="['/projects', p.id, 'files']">Open files</a>
        </section>
        <section data-testid="chat-area" class="chat-area">
          <h2>Chat</h2>
          <section data-testid="general-channels-section" class="general-channels">
            <h2>General Channels</h2>
            <ul data-testid="general-channels-list">
              @for (c of generalChannels(); track c.id) {
                <li data-testid="general-channel-item">{{ c.name }}</li>
              } @empty {
                <li class="gc-empty">No general channels yet.</li>
              }
            </ul>
          </section>
          <section data-testid="active-questions-section">
            <app-active-questions [projectId]="p.id" />
          </section>
        </section>
      </section>
    }
  `,
  styles: [`.project-detail { display: flex; flex-direction: column; gap: 1rem; }`],
})
export class ProjectDetailComponent implements OnInit {
  private api = inject(ProjectsApi);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private apiClient = inject(ApiClient);

  generalChannels = signal<{ id: string; name: string; kind?: string }[]>([]);

  project = signal<ProjectDetail | null>(null);
  error = signal<string | null>(null);
  inviteOpen = signal(false);
  inviteError = signal<string | null>(null);
  invitation = signal<InvitationResponse | null>(null);
  inviteEmail = '';

  isAdmin = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  });
  canInvite = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    void this.load(id);
  }

  private async load(id: string): Promise<void> {
    try {
      this.project.set(await this.api.get(id));
      void this.loadGeneralChannels(id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not load project');
    }
  }

  private async loadGeneralChannels(id: string): Promise<void> {
    try {
      const res = await this.apiClient.get<unknown>(`/api/projects/${id}/channels`, { kind: 'general' });
      const raw = Array.isArray(res) ? res : ((res as { items?: unknown[] } | null)?.items ?? []);
      const list = (raw as { id: string; name: string; kind?: string }[]).filter(
        (c) => !c.kind || c.kind === 'general',
      );
      this.generalChannels.set(list);
    } catch {
      // General Channels endpoint not available yet — show the empty section.
      this.generalChannels.set([]);
    }
  }

  async archive(): Promise<void> {
    const p = this.project();
    if (!p) return;
    try {
      const res = await this.api.archive(p.id);
      this.project.set({ ...p, status: res.status });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not archive project');
    }
  }

  async invite(): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.inviteError.set(null);
    if (!this.inviteEmail.trim()) {
      this.inviteError.set('Email is required');
      return;
    }
    try {
      this.invitation.set(await this.api.invite(p.id, this.inviteEmail.trim()));
      this.inviteOpen.set(false);
      this.inviteEmail = '';
    } catch (e) {
      this.inviteError.set(e instanceof Error ? e.message : 'Could not send invitation');
    }
  }

  async resend(id: string): Promise<void> {
    try {
      const res = await this.api.resendInvitation(id);
      const prev = this.invitation();
      this.invitation.set({ ...(prev ?? {}), ...res, email: prev?.email ?? res.email });
    } catch (e) {
      this.inviteError.set(e instanceof Error ? e.message : 'Could not resend invitation');
    }
  }
}
