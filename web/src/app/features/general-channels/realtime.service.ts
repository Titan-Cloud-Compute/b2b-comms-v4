import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export interface RealtimeEvent {
  type: string;
  channel_id: string;
  payload: unknown;
}

/**
 * RealtimeService — manages a single Server-Sent Events connection to /api/realtime/socket.
 *
 * - Reconnects automatically after errors (3 s back-off).
 * - Emits reconnected$ on every open AFTER the first successful open so that
 *   the OutboxService can retry pending messages when connectivity is restored.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private es: EventSource | null = null;
  private openCount = 0;

  readonly events$ = new Subject<RealtimeEvent>();
  readonly reconnected$ = new Subject<void>();
  readonly connected = signal(false);

  connect(): void {
    if (this.es) return;
    this.openSource();
  }

  private openSource(): void {
    try {
      const es = new EventSource('/api/realtime/socket', { withCredentials: true });
      this.es = es;

      es.addEventListener('open', () => {
        this.connected.set(true);
        if (this.openCount > 0) {
          this.reconnected$.next();
        }
        this.openCount++;
      });

      es.addEventListener('message', (evt) => {
        try {
          const data = JSON.parse(evt.data) as RealtimeEvent;
          this.events$.next(data);
        } catch {
          /* ignore malformed events */
        }
      });

      es.addEventListener('error', () => {
        this.connected.set(false);
        es.close();
        this.es = null;
        setTimeout(() => this.openSource(), 3000);
      });
    } catch {
      setTimeout(() => this.openSource(), 3000);
    }
  }

  disconnect(): void {
    this.es?.close();
    this.es = null;
  }
}
