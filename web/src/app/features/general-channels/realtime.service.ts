import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { RealtimeEvent } from './general-channels.types';

/**
 * Wraps the EventSource SSE connection to /api/realtime/socket.
 * Exposes an `events$` subject and a `connected` signal.
 * Emits a synthetic `reconnected` notification on every open after the first.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private zone = inject(NgZone);
  private es: EventSource | null = null;
  private openCount = 0;

  readonly events$ = new Subject<RealtimeEvent>();
  /** True when the SSE connection is open. */
  readonly connected = signal(false);
  /** Fires whenever the connection (re)opens after the first open. */
  readonly reconnected$ = new Subject<void>();

  constructor() {
    this.connect();
  }

  private connect(): void {
    try {
      this.es = new EventSource('api/realtime/socket', { withCredentials: true });
    } catch {
      return;
    }

    this.es.onopen = () => {
      this.zone.run(() => {
        this.connected.set(true);
        this.openCount++;
        if (this.openCount > 1) {
          this.reconnected$.next();
        }
      });
    };

    this.es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as RealtimeEvent;
        this.zone.run(() => this.events$.next(data));
      } catch {
        /* ignore malformed events */
      }
    };

    this.es.onerror = () => {
      this.zone.run(() => this.connected.set(false));
    };
  }

  ngOnDestroy(): void {
    this.es?.close();
  }
}
