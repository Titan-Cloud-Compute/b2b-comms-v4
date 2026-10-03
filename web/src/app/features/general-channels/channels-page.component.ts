import {
  Component,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../shared/auth.service';
import { ApiError } from '../../shared/api/api-client';
import { GeneralChannelsApiService } from './general-channels-api.service';
import { RealtimeService, RealtimeEvent } from './realtime.service';
import { OutboxService } from './outbox.service';
import { MessageListComponent } from './message-list.component';
import { MessageComposerComponent } from './message-composer.component';
import { ChannelSummary, MessageItem } from './general-channels.types';

/**
 * ChannelsPageComponent — two-pane view for a project's general channels.
 *
 * Left pane:  "General Channels" list + "New channel" form (MANAGER/ADMIN only).
 * Right pane: message history + rich-text composer for the selected channel.
 *
 * Routes:
 *   projects/:id/channels
 *   projects/:id/channels/:channelId
 */
@Component({
  selector: 'app-channels-page',
  standalone: true,
  imports: [FormsModule, MessageListComponent, MessageComposerComponent],
  template: `
    <div class="channels-page">

      <!-- ─── Sidebar ─── -->
      <aside class="channels-sidebar">
        <h2 class="sidebar-heading">General Channels</h2>

        <ul class="channel-list" data-testid="general-channel-list">
          @for (ch of generalChannels(); track ch.id) {
            <li class="channel-item"
                [class.active]="selectedChannelId() === ch.id"
                data-testid="channel-item">
              <a class="channel-link"
                 data-testid="channel-link"
                 href="#"
                 (click)="$event.preventDefault(); onSelectChannel(ch.id)">
                # {{ ch.name }}
                @if (ch.internal_only) {
                  <span class="badge-internal" data-testid="internal-badge">Internal</span>
                }
                @if (ch.unread_count > 0) {
                  <span class="badge-unread">{{ ch.unread_count }}</span>
                }
              </a>
            </li>
          }
        </ul>

        @if (questionChannels().length > 0) {
          <h2 class="sidebar-heading">Questions</h2>
          <ul class="channel-list">
            @for (q of questionChannels(); track q.id) {
              <li class="channel-item" data-testid="question-item">
                <span>{{ q.name }}</span>
              </li>
            }
          </ul>
        }

        @if (canCreate()) {
          <button class="new-channel-btn" data-testid="new-channel-btn"
                  (click)="showForm.set(!showForm())">
            + New channel
          </button>
          @if (showForm()) {
            <form class="create-form" (ngSubmit)="createChannel()">
              <input class="form-input"
                     data-testid="channel-name-input"
                     [(ngModel)]="newName"
                     name="channelName"
                     placeholder="Channel name"
                     required />
              <label class="form-check">
                <input type="checkbox"
                       data-testid="internal-only-toggle"
                       [(ngModel)]="newInternal"
                       name="internalOnly" />
                Internal only
              </label>
              <button type="submit" class="btn-create" data-testid="create-channel-submit">
                Create
              </button>
              @if (createError()) {
                <p class="form-error" role="alert">{{ createError() }}</p>
              }
            </form>
          }
        }
      </aside>

      <!-- ─── Main message area ─── -->
      <main class="channels-main">
        @if (selectedChannelId()) {
          <app-message-list
            [messages]="messages()"
            [pendingItems]="pendingItems()"
            [currentUserId]="currentUserId()"
            [nextCursor]="nextCursor()"
            (loadOlder)="loadOlderMessages()"
            (deleteMsg)="onDeleteMessage($event)"
            (saveEdit)="onSaveEdit($event)"
          />
          <app-message-composer (send)="onSend($event)" />
        } @else {
          <div class="no-channel">Select a channel</div>
        }
      </main>

    </div>
  `,
  styles: [`
    .channels-page {
      display: flex;
      height: 100%;
      min-height: 0;
    }
    .channels-sidebar {
      width: 220px;
      min-width: 180px;
      border-right: 1px solid #e5e7eb;
      padding: 12px 8px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #f9fafb;
    }
    .sidebar-heading {
      font-size: 12px;
      font-weight: 700;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 8px 4px 4px;
    }
    .channel-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .channel-item { border-radius: 4px; }
    .channel-item.active { background: #e0e7ff; }
    .channel-link {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      text-decoration: none;
      color: #374151;
      font-size: 14px;
      border-radius: 4px;
    }
    .channel-link:hover { background: #e5e7eb; }
    .badge-internal {
      font-size: 10px;
      background: #fef3c7;
      color: #92400e;
      border-radius: 4px;
      padding: 1px 5px;
      font-weight: 600;
    }
    .badge-unread {
      font-size: 11px;
      background: #ef4444;
      color: #fff;
      border-radius: 10px;
      padding: 0 6px;
      margin-left: auto;
    }
    .new-channel-btn {
      font-size: 13px;
      padding: 4px 8px;
      border: 1px dashed #d1d5db;
      border-radius: 4px;
      background: none;
      cursor: pointer;
      color: #6b7280;
      text-align: left;
      width: 100%;
    }
    .create-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }
    .form-input {
      padding: 4px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 13px;
    }
    .form-check {
      font-size: 13px;
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .btn-create {
      padding: 4px 12px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
    }
    .form-error { color: #dc2626; font-size: 13px; margin: 0; }
    .channels-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    .no-channel {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #9ca3af;
      font-size: 14px;
    }
  `],
})
export class ChannelsPageComponent implements OnInit, OnDestroy {
  private readonly channelsApi = inject(GeneralChannelsApiService);
  private readonly outbox = inject(OutboxService);
  private readonly realtime = inject(RealtimeService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly generalChannels = signal<ChannelSummary[]>([]);
  readonly questionChannels = signal<Array<{ id: string; name: string; status: string; unread_count: number }>>([]);
  readonly selectedChannelId = signal<string | null>(null);
  readonly messages = signal<MessageItem[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly showForm = signal(false);
  readonly createError = signal<string | null>(null);

  newName = '';
  newInternal = false;

  readonly currentUserId = computed(() => this.auth.user()?.id ?? '');
  readonly canCreate = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  });
  readonly pendingItems = computed(() => {
    const chId = this.selectedChannelId();
    return chId ? this.outbox.getPending(chId) : [];
  });

  private subs: Subscription[] = [];
  private projectId = '';

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('id') ?? '';
    const channelId = this.route.snapshot.paramMap.get('channelId') ?? null;

    this.realtime.connect();

    // After a pending message is retried successfully, reload the channel history.
    this.subs.push(
      this.outbox.retrySuccess$.pipe(
        filter(cid => cid === this.selectedChannelId()),
      ).subscribe(cid => void this.loadMessages(cid)),
    );

    // Live realtime updates for the open channel.
    this.subs.push(
      this.realtime.events$.pipe(
        filter((e: RealtimeEvent) => e.channel_id === this.selectedChannelId()),
      ).subscribe((e: RealtimeEvent) => this.applyRealtimeEvent(e)),
    );

    void this.loadChannels().then(() => {
      const target = channelId
        ?? this.generalChannels().find(c => c.name === 'general')?.id
        ?? this.generalChannels()[0]?.id
        ?? null;
      if (target) void this.loadMessages(target).then(() => this.selectedChannelId.set(target));
    });
  }

  ngOnDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

  async loadChannels(): Promise<void> {
    try {
      const res = await this.channelsApi.listChannels(this.projectId);
      this.generalChannels.set(res.general ?? []);
      this.questionChannels.set(res.questions ?? []);
    } catch {
      /* silent: sidebar stays empty */
    }
  }

  onSelectChannel(id: string): void {
    this.selectedChannelId.set(id);
    void this.loadMessages(id);
  }

  async loadMessages(channelId: string, cursor?: string): Promise<void> {
    try {
      const res = await this.channelsApi.listMessages(channelId, cursor);
      if (cursor) {
        this.messages.update(prev => [...(res.items ?? []), ...prev]);
      } else {
        this.messages.set(res.items ?? []);
      }
      this.nextCursor.set(res.next_cursor ?? null);
    } catch {
      /* silent */
    }
  }

  async loadOlderMessages(): Promise<void> {
    const cursor = this.nextCursor();
    const id = this.selectedChannelId();
    if (cursor && id) await this.loadMessages(id, cursor);
  }

  async onSend(bodyHtml: string): Promise<void> {
    const id = this.selectedChannelId();
    if (!id) return;
    const result = await this.outbox.send(id, bodyHtml);
    // For non-pending sends outbox.retrySuccess$ fires synchronously-ish;
    // we additionally reload here in case the component subscription missed it.
    if (result === 'sent') {
      await this.loadMessages(id);
    }
  }

  async createChannel(): Promise<void> {
    if (!this.newName.trim()) return;
    this.createError.set(null);
    try {
      const ch = await this.channelsApi.createChannel(this.projectId, this.newName.trim(), this.newInternal);
      this.generalChannels.update(list => [...list, {
        id: ch.id,
        name: ch.name,
        internal_only: ch.internal_only,
        unread_count: 0,
      }]);
      this.showForm.set(false);
      this.newName = '';
      this.newInternal = false;
    } catch (e: unknown) {
      this.createError.set(e instanceof ApiError ? e.message : 'Could not create channel.');
    }
  }

  async onDeleteMessage(messageId: string): Promise<void> {
    try {
      await this.channelsApi.deleteMessage(messageId);
      this.messages.update(msgs => msgs.filter(m => m.id !== messageId));
    } catch {
      /* silent */
    }
  }

  async onSaveEdit(event: { id: string; body_html: string }): Promise<void> {
    try {
      const patched = await this.channelsApi.editMessage(event.id, event.body_html);
      this.messages.update(msgs =>
        msgs.map(m => m.id === event.id
          ? { ...m, body_html: patched.body_html, edited_at: patched.edited_at }
          : m,
        ),
      );
    } catch {
      /* silent */
    }
  }

  private applyRealtimeEvent(e: RealtimeEvent): void {
    const payload = e.payload as Partial<MessageItem>;
    if (e.type === 'message.created') {
      const msg = payload as MessageItem;
      this.messages.update(msgs => {
        if (msgs.some(m => m.id === msg.id)) return msgs;
        return [...msgs, msg];
      });
    } else if (e.type === 'message.updated') {
      this.messages.update(msgs =>
        msgs.map(m => m.id === payload.id ? { ...m, ...payload } : m),
      );
    } else if (e.type === 'message.deleted') {
      this.messages.update(msgs => msgs.filter(m => m.id !== payload.id));
    }
  }
}
