import { CallHandler, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { QuestionMessageGuard, channelIdFromMessagePost } from './question-message.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */
function ctx(method: string, url: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ method, originalUrl: url, url }) }),
  } as any;
}

function makePrisma(channel: any) {
  return {
    channels: { findUnique: jest.fn().mockResolvedValue(channel) },
    question_resolutions: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
  } as any;
}

const handler = (): CallHandler & { handle: jest.Mock } => ({ handle: jest.fn(() => of({ id: 'm1' })) });

describe('QuestionMessageGuard', () => {
  it('only targets POST /api/channels/:id/messages', () => {
    expect(channelIdFromMessagePost('POST', '/api/channels/c1/messages')).toBe('c1');
    expect(channelIdFromMessagePost('POST', '/api/channels/c1/messages?x=1')).toBe('c1');
    expect(channelIdFromMessagePost('GET', '/api/channels/c1/messages')).toBeNull();
    expect(channelIdFromMessagePost('POST', '/api/projects/p1/files')).toBeNull();
  });

  it('passes other routes through without touching the database', async () => {
    const prisma = makePrisma(null);
    const next = handler();
    await lastValueFrom(new QuestionMessageGuard(prisma).intercept(ctx('POST', '/api/projects/p1/files'), next));
    expect(next.handle).toHaveBeenCalled();
    expect(prisma.channels.findUnique).not.toHaveBeenCalled();
  });

  it('returns 403 for a post into a resolved question', async () => {
    const prisma = makePrisma({ id: 'c1', kind: 'question', status: 'resolved' });
    const next = handler();
    await expect(
      lastValueFrom(new QuestionMessageGuard(prisma).intercept(ctx('POST', '/api/channels/c1/messages'), next)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('clears resolution marks after a post into an open question', async () => {
    const prisma = makePrisma({ id: 'c1', kind: 'question', status: 'open' });
    const next = handler();
    const out = await lastValueFrom(
      new QuestionMessageGuard(prisma).intercept(ctx('POST', '/api/channels/c1/messages'), next),
    );
    expect(out).toEqual({ id: 'm1' });
    expect(prisma.question_resolutions.deleteMany).toHaveBeenCalledWith({ where: { channel_id: 'c1' } });
  });

  it('leaves general channels alone', async () => {
    const prisma = makePrisma({ id: 'c1', kind: 'general', status: null });
    const next = handler();
    await lastValueFrom(new QuestionMessageGuard(prisma).intercept(ctx('POST', '/api/channels/c1/messages'), next));
    expect(next.handle).toHaveBeenCalled();
    expect(prisma.question_resolutions.deleteMany).not.toHaveBeenCalled();
  });
});
