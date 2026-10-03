import { RealtimeService, RealtimeEvent } from './realtime.service';
import type { SessionPayload } from '../../auth/session.types';

const session = (userId: string): SessionPayload =>
  ({ userId, role: 'USER', firmId: null }) as SessionPayload;

describe('RealtimeService', () => {
  it('delivers events only to connections that may see the channel', async () => {
    const policy = {
      canSeeChannelId: jest.fn(async (s: SessionPayload) => s.userId !== 'outsider'),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RealtimeService(policy as any);
    const memberGot: RealtimeEvent[] = [];
    const outsiderGot: RealtimeEvent[] = [];
    const s1 = svc.connect(session('member')).subscribe((e) => memberGot.push(e));
    const s2 = svc.connect(session('outsider')).subscribe((e) => outsiderGot.push(e));
    expect(svc.connectionCount).toBe(2);

    const delivered = await svc.publish({
      type: 'message.created',
      channel_id: 'c1',
      payload: { id: 'm1', body_html: '<b>hi</b>' },
    });

    expect(delivered).toBe(1);
    expect(memberGot).toHaveLength(1);
    expect(memberGot[0].type).toBe('message.created');
    expect(memberGot[0].payload).toEqual({ id: 'm1', body_html: '<b>hi</b>' });
    expect(outsiderGot).toHaveLength(0);
    s1.unsubscribe();
    s2.unsubscribe();
    expect(svc.connectionCount).toBe(0);
  });

  it('delivers message.updated and message.deleted events', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RealtimeService({ canSeeChannelId: jest.fn().mockResolvedValue(true) } as any);
    const got: string[] = [];
    const sub = svc.connect(session('a')).subscribe((e) => got.push(e.type));
    await svc.publish({ type: 'message.updated', channel_id: 'c1', payload: {} });
    await svc.publish({ type: 'message.deleted', channel_id: 'c1', payload: {} });
    expect(got).toEqual(['message.updated', 'message.deleted']);
    sub.unsubscribe();
  });

  it('does not deliver to disconnected members', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new RealtimeService({ canSeeChannelId: jest.fn().mockResolvedValue(true) } as any);
    const got: RealtimeEvent[] = [];
    svc.connect(session('a')).subscribe((e) => got.push(e)).unsubscribe();
    expect(await svc.publish({ type: 'message.created', channel_id: 'c1', payload: {} })).toBe(0);
    expect(got).toHaveLength(0);
  });
});
