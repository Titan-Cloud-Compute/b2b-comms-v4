import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { MessagesController } from './messages.controller';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function setup() {
  const messages: Any[] = [];
  const attachments: Any[] = [];
  let seq = 0;
  const prisma: Any = {
    messages: {
      create: jest.fn(async ({ data }: Any) => {
        seq++;
        const row = {
          id: `m${seq}`, edited_at: null, deleted_at: null,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)), ...data,
        };
        messages.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where, take }: Any) => {
        let rows = messages.filter((m) => m.channel_id === where.channel_id && !m.deleted_at);
        if (where.createdAt?.lt) rows = rows.filter((m) => m.createdAt < where.createdAt.lt);
        rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.slice(0, take);
      }),
      findUnique: jest.fn(async ({ where }: Any) => messages.find((m) => m.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: Any) => {
        const m = messages.find((x) => x.id === where.id);
        Object.assign(m, data);
        return m;
      }),
    },
    message_attachments: {
      createMany: jest.fn(async ({ data }: Any) => {
        data.forEach((d: Any, i: number) => attachments.push({ id: `a${attachments.length + i}`, ...d }));
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where }: Any) => attachments.filter((a) => where.message_id.in.includes(a.message_id))),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'author', name: 'Ann Author', email: 'ann@x' },
      ]),
    },
    references: { findMany: jest.fn().mockResolvedValue([]) },
    files: { findMany: jest.fn().mockResolvedValue([{ id: 'f1', name: 'spec.pdf' }]) },
  };
  const policy: Any = {
    assertChannelAccess: jest.fn().mockResolvedValue({ id: 'c1', status: 'active' }),
  };
  const realtime: Any = { publish: jest.fn().mockResolvedValue(1) };
  const controller = new MessagesController(prisma, policy, realtime);
  return { controller, messages, attachments, realtime, policy };
}

const req = (userId: string | null): Any =>
  userId ? { session: { userId, role: 'USER', firmId: null } } : {};

describe('MessagesController', () => {
  it('stores sanitized rich text + attachments and broadcasts message.created', async () => {
    const { controller, messages, attachments, realtime } = setup();
    const res = await controller.create(
      'c1',
      {
        body_html: '<b>bold</b> <i>it</i><ul><li>x</li></ul><script>alert(1)</script><a href="https://e.x" onclick="evil()">l</a>',
        attachments: [{ file_id: 'f1' }],
      },
      req('author'),
    );
    expect(res).toMatchObject({ channel_id: 'c1', author_id: 'author' });
    expect(res.body_html).toContain('<b>bold</b>');
    expect(res.body_html).not.toMatch(/<script|onclick/i);
    expect(messages[0].body_html).not.toMatch(/<script|onclick/i);
    expect(attachments).toEqual([expect.objectContaining({ message_id: res.id, file_id: 'f1' })]);
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message.created', channel_id: 'c1' }),
    );
    const evt = realtime.publish.mock.calls[0][0];
    expect(evt.payload.body_html).toContain('<b>bold</b>');
    expect(evt.payload.attachments).toEqual([{ file_id: 'f1', name: 'spec.pdf' }]);
  });

  it('rejects a blank message with 400 and stores nothing', async () => {
    const { controller, messages } = setup();
    await expect(controller.create('c1', { body_html: '  <p> </p> ' }, req('author')))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create('c1', { body_html: '<script>x</script>' }, req('author')))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(messages).toHaveLength(0);
  });

  it('accepts an attachment-only message', async () => {
    const { controller } = setup();
    const res = await controller.create('c1', { body_html: '', attachments: ['f1'] }, req('author'));
    expect(res.id).toBeTruthy();
  });

  it('pages history with a cursor', async () => {
    const { controller } = setup();
    for (let i = 0; i < 3; i++) await controller.create('c1', { body_html: `m${i}` }, req('author'));
    const first = await controller.list('c1', req('author'), undefined, '2');
    expect(first.items.map((m) => m.body_html)).toEqual(['m1', 'm2']);
    expect(first.items[0].author).toEqual({ id: 'author', display_name: 'Ann Author' });
    expect(first.next_cursor).toBeTruthy();
    const second = await controller.list('c1', req('author'), first.next_cursor ?? undefined, '2');
    expect(second.items.map((m) => m.body_html)).toEqual(['m0']);
    expect(second.next_cursor).toBeNull();
  });

  it('lets the author edit (edited_at stored) and delete (deleted_at stored)', async () => {
    const { controller, messages, realtime } = setup();
    const m = await controller.create('c1', { body_html: 'hello' }, req('author'));
    const edited = await controller.update(m.id, { body_html: '<i>hello again</i>' }, req('author'));
    expect(edited.body_html).toBe('<i>hello again</i>');
    expect(messages[0].edited_at).toBeInstanceOf(Date);
    await controller.remove(m.id, req('author'));
    expect(messages[0].deleted_at).toBeInstanceOf(Date);
    const types = realtime.publish.mock.calls.map((c: Any) => c[0].type);
    expect(types).toEqual(expect.arrayContaining(['message.updated', 'message.deleted']));
    const page = await controller.list('c1', req('author'));
    expect(page.items).toHaveLength(0);
  });

  it('returns 403 when another user edits or deletes the message', async () => {
    const { controller, messages } = setup();
    const m = await controller.create('c1', { body_html: 'mine' }, req('author'));
    await expect(controller.update(m.id, { body_html: 'hijack' }, req('other')))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.remove(m.id, req('other'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(messages[0]).toMatchObject({ body_html: 'mine', edited_at: null, deleted_at: null });
  });

  it('returns 401 without a session', async () => {
    const { controller } = setup();
    await expect(controller.list('c1', req(null))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.create('c1', { body_html: 'x' }, req(null)))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
