import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../shared/auth.service';
import { GeneralChannelsApiService } from './general-channels-api.service';
import { RealtimeService } from './realtime.service';
import { OutboxService } from './outbox.service';
import { MessageComposerComponent } from './message-composer.component';
import { MessageListComponent } from './message-list.component';
import type { Channel, Message, QuestionChannel } from './general-channels.types';

@Component({
  selector: 'app-channels-page',
  standalone: true,
  imports: [FormsModule, MessageComposerComponent, MessageListComponent],
  template: `
    <div class="channels-layout">

      <!-- Sidebar -->
      <aside class="channels-sidebar">
        <h2>General Channels</h2>
        <ul data-testid="general-channel-list">
          @for (ch of generalChannels(); track ch.id) {
            <li>
              <a
                data-testid="channel-link"
                [class.active]="activeChannelId() === ch.id"
                (click)="selectChannel(ch.id)"
                href="javascript:void(0)"
              >
                # {{ ch.name }}
                @if (ch.internal_only) {
                  <span data-testid="internal-badge" class="badge-internal">Internal</span>
                }
                @if (ch.unread_count > 0) {
                  <span class="badge-unread">{{ ch.unread_count }}</span>
                }
              </a>
            </li>
          }
        </ul>

        @if (canCreateChannel()) {
          <button
            type="button"
            data-testid="new-channel-btn"
            (click)="showCreateForm.set(!showCreateForm())"
          >
            New channel
          </button>

          @if (showCreateForm()) {
            <form data-testid="create-channel-form" (ngSubmit)="createChannel()">
              <input
                data-testid="channel-name-input"
                name="channelName"
                placeholder="Channel name"
                [(ngModel)]="newChannelName"
                required
              />
              <label>
                <input
                  data-testid="internal-only-toggle"
                  type="checkbox"
                  name="internalOnly"
                  [(ngModel)]="newChannelInternal"
                />
                Internal only
              </label>
              <button type="submit" data-testid="create-channel-submit">Create</button>
              <button type="button" (click)="showCreateForm.set(false)">Cancel</button>
              @if (createError()) {
                <p data-testid="create-channel-error" class="error" role="alert">{{ createError() }}</p>
              }
            </form>
          }
        }

        @if (questionChannels().length > 0) {
          <h2>Questions</h2>
          <ul data-testid="question-channel-list">
            @for (q of questionChannels(); track q.id) {
              <li>
                <a
                  data-testid="channel-link"
                  [class.active]="activeChannelId() === q.id"
                  (click)="selectChannel(q.id)"
                  href="javascript:void(0)"
                >
                  # {{ q.name }}
                  @if (q.unread_count > 0) {
                    <span class="badge-unread">{{ q.unread_count }}</span>
                  }
                </a>
              </li>
            }
          </ul>
        }
      </aside>

      <!-- Message area -->
      <main class="channels-main">
        @if (activeChannelId(); as channelId) {
          <div class="channel-header">
            <h3># {{ activeChannelName() }}</h3>
          </div>

          @if (loadError()) {
            <p class="error" role="alert" data-testid="load-error">{{ loadError() }}</p>
          }

          <app-message-list
            [messages]="messages"
            [pendingItems]="outboxItems"
            [nextCursor]="nextCursor"
            [currentUserId]="currentUserId()"
            (loadOlder)="fetchOlderMessages($event)"
            (editMessage)="onEditMessage($event)"
            (deleteMsg)="onDeleteMessage($event)"
          />

          <app-message-composer (send)="onSend($event)" />

          @if (sendError()) {
            <p class="error" role="alert" data-testid="send-error">{{ sendError() }}</p>
          }
        } @else {
          <p class="no-channel">Select a channel to start messaging.</p>
        }
      </main>
    </div>
  `,
  styles: [`
    .channels-layout { display: flex; height: 100%; min-height: 500px; }
    .channels-sidebar { width: 240px; border-right: 1px solid #e0e0e0; padding: 12px; overflow-y: auto; }
    .channels-sidebar h2 { font-size: 0.9rem; text-transform: uppercase; color: #666; margin: 12px 0 4px; }
    .channels-sidebar ul { list-style: none; padding: 0; margin: 0 0 12px; }
    .channels-sidebar li a { display: block; padding: 4px 8px; border-radius: 4px; text-decoration: none; color: inherit; cursor: pointer; }
    .channels-sidebar li a.active { background: #e8f0fe; font-weight: 600; }
    .badge-internal { background: #e3f2fd; color: #1565c0; font-size: 0.7em; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }
    .badge-unread { background: #e53e3e; color: #fff; font-size: 0.7em; padding: 1px 5px; border-radius: 8px; margin-left: 4px; }
    .channels-main { flex: 1; display: flex; flex-direction: column; }
    .channel-header { padding: 8px 12px; border-bottom: 1px solid #e0e0e0; }
    .channel-header h3 { margin: 0; }
    .no-channel { padding: 24px; color: #888; }
    .error { color: #c00; margin: 4px 0; }
    button[data-testid="new-channel-btn"] { margin-top: 8px; }
    form[data-testid="create-channel-form"] { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  `],
})
export class ChannelsPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private api = inject(GeneralChannelsApiService);
  private realtime = inject(RealtimeService);
  private outboxSvc = inject(OutboxService);
  private destroyRef = inject(DestroyRef);

  // Channels
  readonly generalChannels = signal<Channel[]>([]);
  readonly questionChannels = signal<QuestionChannel[]>([]);
  readonly activeChannelId = signal<string | null>(null);

  // Messages
  readonly messages = signal<Message[]>([]);
  readonly nextCursor = signal<string | null | undefined>(null);

  // Outbox
  readonly outboxItems = this.outboxSvc.items;

  // UI state
  readonly showCreateForm = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly sendError = signal<string | null>(null);
  readonly createError = signal<string | null>(null);
  newChannelName = '';
  newChannelInternal = false;

  readonly currentUserId = computed(() => this.auth.user()?.id ?? '');

  readonly activeChannelName = computed(() => {
    const id = this.activeChannelId();
    if (!id) return '';
    return (
      this.generalChannels().find(c => c.id === id)?.name ??
      this.questionChannels().find(c => c.id === id)?.name ??
      id
    );
  });

  readonly canCreateChannel = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
  });

  ngOnInit(): void {
    const projectId = this.route.snapshot.paramMap.get('projectId') ?? '';
    const channelId = this.route.snapshot.paramMap.get('channelId');

    this.loadChannels(projectId, channelId);

    // Listen for realtime events
    this.realtime.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(ev => {
      if (ev.channel_id !== this.activeChannelId()) return;
      if (ev.type === 'message.created') {
        const msg = ev.payload as Message;
        this.messages.update(msgs => {
          if (msgs.find(m => m.id === msg.id)) return msgs;
          return [...msgs, msg];
        });
      } else if (ev.type === 'message.updated') {
        const updated = ev.payload as Message;
        this.messages.update(msgs => msgs.map(m => m.id === updated.id ? { ...m, ...updated } : m));
      } else if (ev.type === 'message.deleted') {
        const deleted = ev.payload as { id: string };
        this.messages.update(msgs => msgs.filter(m => m.id !== deleted.id));
      }
    });

    // On reconnect, re-fetch messages
    this.realtime.reconnected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const id = this.activeChannelId();
      if (id) this.loadMessages(id);
    });

    // Register outbox reload callback
    const unregister = this.outboxSvc.onReload((channelId, items) => {
      if (channelId === this.activeChannelId()) {
        this.messages.set(items);
      }
    });
    this.destroyRef.onDestroy(unregister);
  }

  private async loadChannels(projectId: string, preferredChannelId: string | null): Promise<void> {
    try {
      const res = await this.api.listChannels(projectId);
      this.generalChannels.set(res.general ?? []);
      this.questionChannels.set(res.questions ?? []);

      // Auto-select: preferredChannelId or the channel named "general"
      const target =
        preferredChannelId ??
        (res.general ?? []).find(c => c.name === 'general')?.id ??
        (res.general ?? [])[0]?.id ??
        null;
      if (target) this.selectChannel(target);
    } catch (err: unknown) {
      this.loadError.set('Failed to load channels.');
    }
  }

  selectChannel(channelId: string): void {
    this.activeChannelId.set(channelId);
    this.messages.set([]);
    this.nextCursor.set(null);
    this.loadError.set(null);
    this.loadMessages(channelId);
  }

  private async loadMessages(channelId: string, cursor?: string | null): Promise<void> {
    try {
      const res = await this.api.listMessages(channelId, cursor);
      if (cursor) {
        this.messages.update(msgs => [...(res.items ?? []), ...msgs]);
      } else {
        this.messages.set(res.items ?? []);
      }
      this.nextCursor.set(res.next_cursor);
    } catch (err: unknown) {
      this.loadError.set('Failed to load messages.');
    }
  }

  fetchOlderMessages(cursor: string | null | undefined): void {
    const id = this.activeChannelId();
    if (id && cursor) this.loadMessages(id, cursor);
  }

  async onSend(html: string): Promise<void> {
    const channelId = this.activeChannelId();
    if (!channelId) return;
    this.sendError.set(null);
    try {
      const result = await this.outboxSvc.send(
        channelId,
        html,
        this.currentUserId(),
        this.auth.user()?.name ?? '',
      );
      // On immediate success, reload messages (outbox reload cb fires too, but this is direct)
      if (result === 'sent') {
        await this.loadMessages(channelId);
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Failed to send message.';
      this.sendError.set(msg);
    }
  }

  async createChannel(): Promise<void> {
    const projectId = this.route.snapshot.paramMap.get('projectId') ?? '';
    if (!this.newChannelName.trim()) return;
    this.createError.set(null);
    try {
      const res = await this.api.createChannel(projectId, {
        name: this.newChannelName.trim(),
        internal_only: this.newChannelInternal,
      });
      const newCh: Channel = {
        id: res.id,
        name: res.name,
        internal_only: res.internal_only,
        unread_count: 0,
      };
      this.generalChannels.update(chs => [...chs, newCh]);
      this.newChannelName = '';
      this.newChannelInternal = false;
      this.showCreateForm.set(false);
      this.selectChannel(res.id);
    } catch (err: unknown) {
      this.createError.set((err as { message?: string })?.message ?? 'Failed to create channel.');
    }
  }

  async onEditMessage(ev: { id: string; body_html: string }): Promise<void> {
    try {
      const res = await this.api.patchMessage(ev.id, ev.body_html);
      this.messages.update(msgs =>
        msgs.map(m => m.id === ev.id ? { ...m, body_html: res.body_html, edited_at: res.edited_at } : m),
      );
    } catch (err: unknown) {
      /* surface error inline or ignore */
    }
  }

  async onDeleteMessage(messageId: string): Promise<void> {
    try {
      await this.api.deleteMessage(messageId);
      this.messages.update(msgs => msgs.filter(m => m.id !== messageId));
    } catch (err: unknown) {
      /* ignore */
    }
  }
}
