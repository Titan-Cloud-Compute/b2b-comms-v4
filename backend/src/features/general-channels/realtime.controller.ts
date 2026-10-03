import { Controller, Req, Sse, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, interval, map, merge } from 'rxjs';
import { RealtimeService } from './realtime.service';

export interface SseMessage {
  type?: string;
  data: string | object;
}

/** Heartbeat period keeping proxies from closing idle streams. */
export const HEARTBEAT_MS = 25_000;

/**
 * GET /api/realtime/socket — authenticated server-sent-event stream.
 * Unauthenticated callers are rejected with 401 by the global JwtAuthGuard
 * (and defensively here). Each event's data is { type, channel_id, payload }.
 */
@Controller('api/realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Sse('socket')
  socket(@Req() req: Request): Observable<SseMessage> {
    const session = req.session;
    if (!session) throw new UnauthorizedException('not authenticated');
    const events = this.realtime.connect(session).pipe(
      map((e): SseMessage => ({ type: e.type, data: e })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): SseMessage => ({ type: 'ping', data: { type: 'ping' } })),
    );
    return merge(events, heartbeat);
  }
}
