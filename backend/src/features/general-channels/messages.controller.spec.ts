/**
 * Messages controller spec — covers all done_when scenarios:
 *
 * 1. POST /api/channels/:id/messages → 201 {id,channel_id,author_id,body_html,created_at};
 *    row and attachment rows stored.
 * 2. Body with script/onerror is sanitized; no <script, no onerror in stored body_html.
 * 3. Blank body with no attachments → 400, no message row.
 * 4. GET returns items[] newest-first with author.display_name, attachments[].name,
 *    reference_id, edited_at; excludes deleted; next_cursor pages correctly.
 * 5. PATCH by author → 200 with edited_at set.
 * 6. DELETE by author → 204 with deleted_at set.
 * 7. PATCH by other user → 403 (including admin).
 * 8. DELETE by other user → 403 (including admin).
 * 9. No session → 401.
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ChannelAccessService } from './channel-access.service';
import { fakePrisma, FakeDb } from './testing/fake-prisma';

/* eslint-disable @typescript-eslint/no-explicit-any */
const req = (session: any) => ({ session }) as unknown as Request;

describe('MessagesController', () => {
  let db: FakeDb;
  let access: ChannelAccessService;
  let service: MessagesService;
  let ctrl: MessagesController;

  let internalOrg: any;
  let externalOrg: any;
  let author: any, other: any, admin: any;
  let project: any;
  let channel: any;

  const s = (u: any) => ({ userId: u.id, role: u.role, organizationId: u.organization_id });

  beforeEach(async () => {
    db = fakePrisma();
    access = new ChannelAccessService(db as any);
    service = new MessagesService(db as any, access);
    ctrl = new MessagesController(service);

    internalOrg = await db.organizations.create({ data: { name: 'Internal Co', is_internal: true } });
    externalOrg = await db.organizations.create({ data: { name: 'External Co', is_internal: false } });

    author = await db.user.create({
      data: { email: 'author@x.io', role: 'USER', organization_id: internalOrg.id, display_name: 'Alice' },
    });
    other = await db.user.create({
      data: { email: 'other@x.io', role: 'USER', organization_id: internalOrg.id, display_name: 'Bob' },
    });
    admin = await db.user.create({
      data: { email: 'admin@x.io', role: 'ADMIN', organization_id: internalOrg.id, display_name: 'Charlie' },
    });

    project = await db.projects.create({
      data: { name: 'Proj', status: 'active', organization_id: externalOrg.id },
    });

    const now = new Date();
    for (const u of [author, other, admin]) {
      await db.project_members.create({ data: { project_id: project.id, user_id: u.id, added_at: now } });
    }

    channel = await db.channels.create({
      data: {
        project_id: project.id,
        kind: 'general',
        name: 'general',
        internal_only: false,
        status: 'active',
        created_by: author.id,
        created_at: new Date(),
      },
    });
  });

  // ── 1. POST → 201 with stored rows ──────────────────────────────────────

  it('POST returns 201 with {id,channel_id,author_id,body_html,created_at}', async () => {
    const res = await ctrl.create(req(s(author)), channel.id, { body_html: '<b>hello</b>' });
    expect(res).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        channel_id: channel.id,
        author_id: author.id,
        body_html: expect.stringContaining('hello'),
        created_at: expect.any(Date),
      }),
    );
    expect((db as any).messages.rows).toHaveLength(1);
  });

  it('POST with file_id stores message_attachments row', async () => {
    const file = await (db as any).files.create({
      data: { project_id: project.id, name: 'doc.pdf', deleted_at: null },
    });
    await ctrl.create(req(s(author)), channel.id, {
      body_html: '<b>with attachment</b>',
      attachments: [file.id],
    });
    expect((db as any).message_attachments.rows).toHaveLength(1);
    expect((db as any).message_attachments.rows[0].file_id).toBe(file.id);
  });

  // ── 2. Sanitization ──────────────────────────────────────────────────────

  it('stores sanitized html — no <script, no onerror, <b>hi</b> preserved', async () => {
    const malicious = '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>';
    const res = await ctrl.create(req(s(author)), channel.id, { body_html: malicious });
    expect(res.body_html).not.toMatch(/<script/i);
    expect(res.body_html).not.toMatch(/onerror/i);
    expect(res.body_html).toContain('<b>hi</b>');
  });

  // ── 3. Blank message → 400 ──────────────────────────────────────────────

  it('blank body with no attachments → 400, no message row stored', async () => {
    await expect(
      ctrl.create(req(s(author)), channel.id, { body_html: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((db as any).messages.rows).toHaveLength(0);
  });

  it('body of only tags with no text → 400, no message row stored', async () => {
    await expect(
      ctrl.create(req(s(author)), channel.id, { body_html: '<p><br></p>' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((db as any).messages.rows).toHaveLength(0);
  });

  // ── 4. GET: ordering, author.display_name, attachments, reference_id, cursor ──

  it('GET returns items newest-first with author.display_name', async () => {
    const t1 = new Date('2024-01-01T10:00:00Z');
    const t2 = new Date('2024-01-01T11:00:00Z');
    await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>first</b>', created_at: t1 },
    });
    await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>second</b>', created_at: t2 },
    });

    const res = await ctrl.list(req(s(author)), channel.id);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].body_html).toContain('second');
    expect(res.items[1].body_html).toContain('first');
    expect(res.items[0].author.display_name).toBe('Alice');
  });

  it('GET excludes deleted messages', async () => {
    await (db as any).messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>visible</b>',
        created_at: new Date('2024-01-01T10:00:00Z'),
      },
    });
    await (db as any).messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>deleted</b>',
        created_at: new Date('2024-01-01T11:00:00Z'),
        deleted_at: new Date(),
      },
    });

    const res = await ctrl.list(req(s(author)), channel.id);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].body_html).toContain('visible');
  });

  it('GET returns attachments[].name', async () => {
    const file = await (db as any).files.create({
      data: { project_id: project.id, name: 'report.pdf', deleted_at: null },
    });
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>x</b>', created_at: new Date() },
    });
    await (db as any).message_attachments.create({
      data: { message_id: msg.id, file_id: file.id },
    });

    const res = await ctrl.list(req(s(author)), channel.id);
    expect(res.items[0].attachments).toHaveLength(1);
    expect(res.items[0].attachments[0].name).toBe('report.pdf');
    expect(res.items[0].attachments[0].file_id).toBe(file.id);
  });

  it('GET returns reference_id when a references row exists', async () => {
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>ref</b>', created_at: new Date() },
    });
    const ref = await (db as any).references.create({
      data: { message_id: msg.id, author_id: author.id },
    });

    const res = await ctrl.list(req(s(author)), channel.id);
    expect(res.items[0].reference_id).toBe(ref.id);
  });

  it('GET returns edited_at when set', async () => {
    const editedAt = new Date('2024-06-01T12:00:00Z');
    await (db as any).messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>edited</b>',
        created_at: new Date(),
        edited_at: editedAt,
      },
    });
    const res = await ctrl.list(req(s(author)), channel.id);
    expect(res.items[0].edited_at).toEqual(editedAt);
  });

  it('GET paginates with next_cursor', async () => {
    // Create 3 messages
    for (let i = 0; i < 3; i++) {
      await (db as any).messages.create({
        data: {
          channel_id: channel.id,
          author_id: author.id,
          body_html: `<b>msg${i}</b>`,
          created_at: new Date(Date.now() + i * 1000),
        },
      });
    }

    // Fetch page 1 with limit=2
    const page1 = await ctrl.list(req(s(author)), channel.id, undefined, '2');
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();

    // Fetch page 2 using cursor
    const page2 = await ctrl.list(req(s(author)), channel.id, page1.next_cursor!, '2');
    expect(page2.items).toHaveLength(1);
    expect(page2.next_cursor).toBeNull();
  });

  // ── 5. PATCH by author → 200 with edited_at ──────────────────────────────

  it('PATCH by author returns 200 with id, body_html, edited_at', async () => {
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>old</b>', created_at: new Date() },
    });

    const res = await ctrl.update(req(s(author)), msg.id, { body_html: '<b>new</b>' });
    expect(res).toEqual(
      expect.objectContaining({
        id: msg.id,
        body_html: expect.stringContaining('new'),
        edited_at: expect.any(Date),
      }),
    );
  });

  // ── 6. DELETE by author → 204, deleted_at set ────────────────────────────

  it('DELETE by author returns undefined (204) and sets deleted_at', async () => {
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>bye</b>', created_at: new Date() },
    });

    const res = await ctrl.remove(req(s(author)), msg.id);
    expect(res).toBeUndefined();
    const stored = (db as any).messages.rows.find((r: any) => r.id === msg.id);
    expect(stored.deleted_at).toBeInstanceOf(Date);
  });

  // ── 7. PATCH by other user → 403 ─────────────────────────────────────────

  it('PATCH by other user returns 403', async () => {
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>x</b>', created_at: new Date() },
    });
    await expect(
      ctrl.update(req(s(other)), msg.id, { body_html: '<b>hack</b>' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PATCH by admin returns 403 (admin cannot edit others messages)', async () => {
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>x</b>', created_at: new Date() },
    });
    await expect(
      ctrl.update(req(s(admin)), msg.id, { body_html: '<b>admin edit</b>' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 8. DELETE by other user → 403 ────────────────────────────────────────

  it('DELETE by other user returns 403', async () => {
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>x</b>', created_at: new Date() },
    });
    await expect(ctrl.remove(req(s(other)), msg.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DELETE by admin returns 403 (admin cannot delete others messages)', async () => {
    const msg = await (db as any).messages.create({
      data: { channel_id: channel.id, author_id: author.id, body_html: '<b>x</b>', created_at: new Date() },
    });
    await expect(ctrl.remove(req(s(admin)), msg.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 9. No session → 401 ──────────────────────────────────────────────────

  it('POST without session returns 401', async () => {
    await expect(
      ctrl.create(req(undefined), channel.id, { body_html: '<b>hi</b>' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('GET without session returns 401', async () => {
    await expect(ctrl.list(req(undefined), channel.id)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('PATCH without session returns 401', async () => {
    await expect(ctrl.update(req(undefined), 'some-id', { body_html: '<b>x</b>' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('DELETE without session returns 401', async () => {
    await expect(ctrl.remove(req(undefined), 'some-id')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ── Extra: 404 on unknown message ─────────────────────────────────────────

  it('PATCH on unknown message returns 404', async () => {
    await expect(
      ctrl.update(req(s(author)), 'no-such-message', { body_html: '<b>x</b>' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DELETE on unknown message returns 404', async () => {
    await expect(ctrl.remove(req(s(author)), 'no-such-message')).rejects.toBeInstanceOf(NotFoundException);
  });
});
