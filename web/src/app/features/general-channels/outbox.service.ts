import { Injectable, inject, signal } from '@angular/core';
import { GeneralChannelsApiService } from './general-channels-api.service';
import { RealtimeService } from './realtime.service';
import type { OutboxItem, Message } from './general-channels.types';

export type OnMessagesReloaded = (channelId: string, items: Message[]) => void;

/**
 * Outbox service — keeps unsent messages in memory as "pending" items.
 *
 * Flow:
 *  1. send() tries POST; if it fails with a network error keeps the item pending.
 *  2. On window 'online' or RealtimeService reconnect, retries every pending item.
 *  3. On success: removes the item and calls onMessagesReloaded to refresh history.
 */
@Injectable({ providedIn: 'root' })
export class OutboxService {
  private api = inject(GeneralChannelsApiService);
  private realtime = inject(RealtimeService);

  private readonly _items = signal<OutboxItem[]>([]);
  readonly items = this._items.asReadonly();

  private reloadCallbacks: OnMessagesReloaded[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.retryAll());
    }
    this.realtime.reconnected$.subscribe(() => this.retryAll());
  }

  /** Register a callback that receives fresh messages after a successful retry. */
  onReload(cb: OnMessagesReloaded): () => void {
    this.reloadCallbacks.push(cb);
    return () => {
      this.reloadCallbacks = this.reloadCallbacks.filter(c => c !== cb);
    };
  }

  /** Attempt to send a message. Returns the confirmed message on success, or stores it as pending. */
  async send(
    channelId: string,
    body_html: string,
    currentUserId: string,
    currentUserName: string,
  ): Promise<'sent' | 'pending'> {
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const item: OutboxItem = { temp_id: tempId, channel_id: channelId, body_html, state: 'pending' };

    try {
      const res = await this.api.postMessage(channelId, { body_html });
      // Confirmed — notify reload
      await this.reloadHistory(channelId);
      return 'sent';
    } catch (err: unknown) {
      const isNetworkFailure = this.isNetworkError(err);
      if (isNetworkFailure) {
        this._items.update(items => [...items, item]);
        return 'pending';
      }
      throw err;
    }
  }

  private async retryAll(): Promise<void> {
    const pending = this._items();
    for (const item of pending) {
      try {
        await this.api.postMessage(item.channel_id, { body_html: item.body_html });
        this._items.update(items => items.filter(i => i.temp_id !== item.temp_id));
        await this.reloadHistory(item.channel_id);
      } catch {
        /* leave pending — will retry next time */
      }
    }
  }

  private async reloadHistory(channelId: string): Promise<void> {
    try {
      const res = await this.api.listMessages(channelId);
      for (const cb of this.reloadCallbacks) {
        cb(channelId, res.items);
      }
    } catch {
      /* ignore reload failure */
    }
  }

  private isNetworkError(err: unknown): boolean {
    if (!err) return false;
    // ServiceUnavailableError from api-client wraps network errors
    if (typeof err === 'object' && 'status' in err) {
      const status = (err as { status: number }).status;
      return status === 503 || status === 0;
    }
    // TypeError: Failed to fetch
    if (err instanceof TypeError) return true;
    return false;
  }
}
