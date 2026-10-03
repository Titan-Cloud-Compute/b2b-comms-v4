import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ApiClient, ServiceUnavailableError } from '../../shared/api/api-client';
import { OutboxItem } from './general-channels.types';
import { RealtimeService } from './realtime.service';

/**
 * OutboxService — manages messages that could not be delivered immediately.
 *
 * - When navigator.onLine is false (or a network error occurs), the message is
 *   added to an in-memory pending queue and shown with a "pending" badge.
 * - On window "online" or a RealtimeService reconnect, every pending message is
 *   retried in order. On 201 it is removed from the queue and retrySuccess$
 *   is emitted so the owning component can re-fetch history.
 */
@Injectable({ providedIn: 'root' })
export class OutboxService {
  private readonly api = inject(ApiClient);
  private readonly realtime = inject(RealtimeService);

  private readonly _pending = signal<OutboxItem[]>([]);

  /** Emits the channelId whenever a pending message is successfully delivered. */
  readonly retrySuccess$ = new Subject<string>();

  constructor() {
    window.addEventListener('online', () => void this.retryAll());
    this.realtime.reconnected$.subscribe(() => void this.retryAll());
  }

  /** Returns current pending items for a given channel (reactive). */
  getPending(channelId: string): OutboxItem[] {
    return this._pending().filter(i => i.channel_id === channelId);
  }

  /**
   * Attempt to send a message.
   * - 'sent'    — delivered to the server.
   * - 'pending' — queued for retry (offline or network error).
   */
  async send(channelId: string, bodyHtml: string): Promise<'sent' | 'pending'> {
    if (!navigator.onLine) {
      this.enqueue(channelId, bodyHtml);
      return 'pending';
    }
    try {
      await this.api.post(`/api/channels/${encodeURIComponent(channelId)}/messages`, { body_html: bodyHtml });
      this.retrySuccess$.next(channelId);
      return 'sent';
    } catch (e: unknown) {
      if (isNetworkError(e)) {
        this.enqueue(channelId, bodyHtml);
        return 'pending';
      }
      throw e;
    }
  }

  private enqueue(channelId: string, bodyHtml: string): void {
    const item: OutboxItem = {
      temp_id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      channel_id: channelId,
      body_html: bodyHtml,
      state: 'pending',
    };
    this._pending.update(list => [...list, item]);
  }

  private async retryAll(): Promise<void> {
    const items = this._pending().slice();
    for (const item of items) {
      if (!navigator.onLine) break;
      try {
        await this.api.post(
          `/api/channels/${encodeURIComponent(item.channel_id)}/messages`,
          { body_html: item.body_html },
        );
        this._pending.update(list => list.filter(i => i.temp_id !== item.temp_id));
        this.retrySuccess$.next(item.channel_id);
      } catch (e: unknown) {
        if (!isNetworkError(e)) {
          // Permanent failure: drop so we don't retry forever.
          this._pending.update(list => list.filter(i => i.temp_id !== item.temp_id));
        }
        // Network errors keep the item in the queue for the next retry round.
      }
    }
  }
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof ServiceUnavailableError && (e.body as { service?: string } | null)?.service === 'network') {
    return true;
  }
  if (e instanceof TypeError) return true;
  return false;
}
