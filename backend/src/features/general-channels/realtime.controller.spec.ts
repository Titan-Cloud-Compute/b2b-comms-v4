import { UnauthorizedException } from '@nestjs/common';
import { RealtimeController, SseMessage } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import type { SessionPayload } from '../../auth/session.types';

describe('RealtimeController', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new RealtimeService({ canSeeChannelId: jest.fn().mockResolvedValue(true) } as any);
  const controller = new RealtimeController(svc);

  it('rejects unauthenticated callers with 401', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => controller.socket({} as any)).toThrow(UnauthorizedException);
  });

  it('streams message.created events as SSE messages', async () => {
    const session = { userId: 'u1', role: 'USER', firmId: null } as SessionPayload;
    const got: SseMessage[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = controller.socket({ session } as any).subscribe((m) => got.push(m));
    await svc.publish({ type: 'message.created', channel_id: 'c1', payload: { id: 'm1' } });
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('message.created');
    expect(got[0].data).toEqual({ type: 'message.created', channel_id: 'c1', payload: { id: 'm1' } });
    sub.unsubscribe();
    expect(svc.connectionCount).toBe(0);
  });
});
