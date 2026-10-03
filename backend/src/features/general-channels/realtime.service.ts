import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import type { SessionPayload } from '../../auth/session.types';
import { ChannelAccessPolicy } from './channel-access.policy';

export type RealtimeEventType = 'message.created' | 'message.updated' | 'message.deleted' | 'channel.created';

export interface RealtimeEvent {
  type: RealtimeEventType | string;
  channel_id: string;
  payload: Record<string, unknown>;
}

interface Connection {
  session: SessionPayload;
  out: Subscriber<RealtimeEvent>;
}

/**
 * In-process fan-out for the real-time feed. Every open
 * GET /api/realtime/socket stream registers a connection; publish() delivers
 * the event only to connections whose user may see the event's channel
 * (project membership + internal-only rule), so it reaches exactly the online
 * members of that channel.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger('RealtimeService');
  private readonly connections = new Set<Connection>();

  constructor(private readonly policy: ChannelAccessPolicy) {}

  /** Number of currently connected streams (diagnostics/tests). */
  get connectionCount(): number {
    return this.connections.size;
  }

  connect(session: SessionPayload): Observable<RealtimeEvent> {
    return new Observable<RealtimeEvent>((out) => {
      const conn: Connection = { session, out };
      this.connections.add(conn);
      return () => {
        this.connections.delete(conn);
      };
    });
  }

  async publish(event: RealtimeEvent): Promise<number> {
    const targets = Array.from(this.connections);
    const allowed = await Promise.all(
      targets.map(async (c) => {
        try {
          return await this.policy.canSeeChannelId(c.session, event.channel_id);
        } catch (err) {
          this.logger.warn(`access check failed: ${err instanceof Error ? err.message : err}`);
          return false;
        }
      }),
    );
    let delivered = 0;
    targets.forEach((c, i) => {
      if (allowed[i] && this.connections.has(c)) {
        c.out.next(event);
        delivered++;
      }
    });
    return delivered;
  }
}
