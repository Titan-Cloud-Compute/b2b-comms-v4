/**
 * Messages controller spec — covers all done_when scenarios:
 *
 * 1. POST returns 201 {id,channel_id,author_id,body_html,created_at}; row stored;
 *    one message_attachments row per file_id.
 * 2. Strong/em/ul/ol/li/a/mention spans survive sanitization.
 * 3. XSS payload: no <script and no onerror in stored body_html.
 * 4. Blank body + no attachments → 400; no row stored.
 * 5. GET returns items[] newest-first with author.display_name, attachments[].name,
 *    reference_id, edited_at; next_cursor pages correctly; deleted messages excluded.
 * 6. PATCH by author → 200 with edited_at; PATCH by other user → 403; Admin → 403.
 * 7. DELETE by author → 204 (deleted_at set); DELETE by other → 403; Admin → 403.
 * 8. No session → 401.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
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

const req = (session: any) => ({ session }) as unknown as Request;

describe('MessagesController', () => {
  let db: FakeDb;
  let access: ChannelAccessService;
  let service: MessagesService;
  let ctrl: MessagesController;

  let admin: any, author: any, otherUser: any;
  let project: any, channel: any;

  const s = (u: any) => ({ userId: u.id, role: u.role, organizationId: u.organization_id });

  beforeEach(async () => {
    db = fakePrisma();
    access = new ChannelAccessService(db as any);
    service = new MessagesService(db as any, access);
    ctrl = new MessagesController(service);

    const internalOrg = await db.organizations.create({
      data: { name: 'Internal Co', is_internal: true },
    });

    admin = await db.user.create({
      data: { email: 'admin@x.io', role: 'ADMIN', organization_id: internalOrg.id },
    });
    author = await db.user.create({
      data: { email: 'author@x.io', role: 'USER', organization_id: internalOrg.id, display_name: 'Alice' },
    });
    otherUser = await db.user.create({
      data: { email: 'other@x.io', role: 'USER', organization_id: internalOrg.id, display_name: 'Bob' },
    });

    project = await db.projects.create({
      data: { name: 'Proj', status: 'active', organization_id: internalOrg.id },
    });

    const now = new Date();
    for (const u of [admin, author, otherUser]) {
      await db.project_members.create({ data: { project_id: project.id, user_id: u.id, added_at: now } });
    }

    channel = await db.channels.create({
      data: {
        project_id: project.id,
        kind: 'general',
        name: 'general',
        internal_only: false,
        status: 'active',
        created_by: admin.id,
        created_at: new Date(),
      },
    });
  });

  // ── 1. POST returns 201 and stores row + attachments ─────────────────────

  it('POST returns {id,channel_id,author_id,body_html,created_at} and stores a messages row', async () => {
    const res = await ctrl.create(req(s(author)), channel.id, { body_html: '<b>hello</b>' });
    expect(res).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        channel_id: channel.id,
        author_id: author.id,
        body_html: expect.any(String),
        created_at: expect.any(Date),
      }),
    );
    expect(db.messages.rows).toHaveLength(1);
    expect(db.messages.rows[0].channel_id).toBe(channel.id);
  });

  it('POST with file_id stores one message_attachments row per attachment', async () => {
    const file = await db.files.create({
      data: { name: 'doc.pdf', project_id: project.id, deleted_at: null },
    });

    const res = await ctrl.create(req(s(author)), channel.id, {
      body_html: '<b>see attached</b>',
      attachments: [file.id],
    });

    expect(db.message_attachments.rows).toHaveLength(1);
    expect(db.message_attachments.rows[0].message_id).toBe(res.id);
    expect(db.message_attachments.rows[0].file_id).toBe(file.id);
  });

  // ── 2. Allowed tags survive sanitization ─────────────────────────────────

  it('body_html preserves strong/em/ul/ol/li/a and mention spans', async () => {
    const html =
      '<strong>bold</strong><em>italic</em><ul><li>item</li></ul>' +
      '<a href="https://ex.com">link</a>' +
      '<span class="mention" data-mention-user-id="u-1">@alice</span>';

    const res = await ctrl.create(req(s(author)), channel.id, { body_html: html });
    const stored = res.body_html as string;

    expect(stored).toContain('<strong>bold</strong>');
    expect(stored).toContain('<em>italic</em>');
    expect(stored).toContain('<li>item</li>');
    expect(stored).toContain('href="https://ex.com"');
    expect(stored).toContain('data-mention-user-id="u-1"');
  });

  // ── 3. XSS sanitization ──────────────────────────────────────────────────

  it('stores body_html with no <script and no onerror after XSS payload', async () => {
    const payload = '<script>alert(1)</script><img src=x onerror=alert(1)><b>hi</b>';
    const res = await ctrl.create(req(s(author)), channel.id, { body_html: payload });

    expect(res.body_html).not.toMatch(/<script/i);
    expect(res.body_html).not.toMatch(/onerror/i);
    expect(res.body_html).toContain('<b>hi</b>');
    // also verify stored row
    expect(db.messages.rows[0].body_html).not.toMatch(/<script/i);
    expect(db.messages.rows[0].body_html).not.toMatch(/onerror/i);
  });

  // ── 4. Blank body + no attachments → 400 ────────────────────────────────

  it('blank body_html with no attachments returns 400 and stores no row', async () => {
    await expect(
      ctrl.create(req(s(author)), channel.id, { body_html: '<p><br></p>' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.messages.rows).toHaveLength(0);
  });

  it('empty string body_html with no attachments returns 400', async () => {
    await expect(
      ctrl.create(req(s(author)), channel.id, { body_html: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blank body with a file attachment is accepted', async () => {
    const file = await db.files.create({
      data: { name: 'img.png', project_id: project.id, deleted_at: null },
    });
    const res = await ctrl.create(req(s(author)), channel.id, {
      body_html: '',
      attachments: [file.id],
    });
    expect(res.id).toBeDefined();
  });

  // ── 5. GET — ordering, enrichment, cursor pagination, deleted excluded ────

  it('GET returns items newest-first with author.display_name, attachments, reference_id, edited_at', async () => {
    const file = await db.files.create({
      data: { name: 'attach.pdf', project_id: project.id, deleted_at: null },
    });

    // Older message
    const msg1 = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>first</b>',
        created_at: new Date('2024-01-01T10:00:00Z'),
        edited_at: null,
        deleted_at: null,
      },
    });
    await db.message_attachments.create({
      data: { message_id: msg1.id, file_id: file.id },
    });
    // Add a reference for msg1
    await db.references.create({
      data: { message_id: msg1.id, file_version_id: 'fv-1', author_id: author.id, updated_at: new Date() },
    });

    // Newer message
    await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<em>second</em>',
        created_at: new Date('2024-01-02T10:00:00Z'),
        edited_at: null,
        deleted_at: null,
      },
    });

    // Deleted message (should be excluded)
    await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<em>deleted</em>',
        created_at: new Date('2024-01-03T10:00:00Z'),
        edited_at: null,
        deleted_at: new Date(),
      },
    });

    const res = await ctrl.list(req(s(author)), channel.id, {});
    const { items } = res as any;

    expect(items).toHaveLength(2); // deleted excluded
    // newest first
    expect(items[0].body_html).toContain('second');
    expect(items[1].body_html).toContain('first');

    // author
    expect(items[0].author.display_name).toBe('Alice');
    expect(items[0].author.id).toBe(author.id);

    // attachments on the older message (now items[1])
    expect(items[1].attachments).toHaveLength(1);
    expect(items[1].attachments[0].name).toBe('attach.pdf');
    expect(items[1].attachments[0].file_id).toBe(file.id);

    // reference_id on items[1]
    expect(items[1].reference_id).toBeDefined();
    expect(items[1].reference_id).not.toBeNull();

    // edited_at
    expect(items[0].edited_at).toBeNull();
    expect(items[0].created_at).toBeDefined();
  });

  it('GET next_cursor pages correctly', async () => {
    // Create 3 messages with distinct timestamps
    for (let i = 1; i <= 3; i++) {
      await db.messages.create({
        data: {
          channel_id: channel.id,
          author_id: author.id,
          body_html: `<b>msg${i}</b>`,
          created_at: new Date(`2024-01-0${i}T10:00:00Z`),
          edited_at: null,
          deleted_at: null,
        },
      });
    }

    // Page 1: limit=2, newest first → msg3, msg2
    const page1 = await ctrl.list(req(s(author)), channel.id, { limit: '2' });
    const items1 = (page1 as any).items;
    expect(items1).toHaveLength(2);
    expect(items1[0].body_html).toContain('msg3');
    expect(items1[1].body_html).toContain('msg2');
    expect((page1 as any).next_cursor).toBeTruthy();

    // Page 2: use cursor → msg1
    const page2 = await ctrl.list(req(s(author)), channel.id, {
      cursor: (page1 as any).next_cursor,
      limit: '2',
    });
    const items2 = (page2 as any).items;
    expect(items2).toHaveLength(1);
    expect(items2[0].body_html).toContain('msg1');
    expect((page2 as any).next_cursor).toBeNull();
  });

  // ── 6. PATCH ──────────────────────────────────────────────────────────────

  it('PATCH by author returns 200 with edited_at set', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>original</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });

    const res = await ctrl.update(req(s(author)), msg.id, { body_html: '<b>updated</b>' });
    expect((res as any).id).toBe(msg.id);
    expect((res as any).body_html).toContain('updated');
    expect((res as any).edited_at).toBeInstanceOf(Date);
    expect(db.messages.rows[0].edited_at).toBeInstanceOf(Date);
  });

  it('PATCH by other user returns 403', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>original</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });

    await expect(
      ctrl.update(req(s(otherUser)), msg.id, { body_html: '<b>hack</b>' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PATCH by Admin (not author) returns 403', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>original</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });

    await expect(
      ctrl.update(req(s(admin)), msg.id, { body_html: '<b>admin edit</b>' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 7. DELETE ─────────────────────────────────────────────────────────────

  it('DELETE by author returns void and sets deleted_at', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>bye</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });

    const res = await ctrl.remove(req(s(author)), msg.id);
    expect(res).toBeUndefined();
    expect(db.messages.rows[0].deleted_at).toBeInstanceOf(Date);
  });

  it('DELETE by other user returns 403', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>bye</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });

    await expect(ctrl.remove(req(s(otherUser)), msg.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.messages.rows[0].deleted_at).toBeNull();
  });

  it('DELETE by Admin (not author) returns 403', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>bye</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });

    await expect(ctrl.remove(req(s(admin)), msg.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── 8. No session → 401 ──────────────────────────────────────────────────

  it('POST with no session returns 401', async () => {
    await expect(
      ctrl.create(req(undefined), channel.id, { body_html: '<b>hi</b>' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.messages.rows).toHaveLength(0);
  });

  it('GET with no session returns 401', async () => {
    await expect(ctrl.list(req(undefined), channel.id, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('PATCH with no session returns 401', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>hi</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });
    await expect(
      ctrl.update(req(undefined), msg.id, { body_html: '<b>x</b>' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('DELETE with no session returns 401', async () => {
    const msg = await db.messages.create({
      data: {
        channel_id: channel.id,
        author_id: author.id,
        body_html: '<b>hi</b>',
        created_at: new Date(),
        edited_at: null,
        deleted_at: null,
      },
    });
    await expect(ctrl.remove(req(undefined), msg.id)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // ── Extra: PATCH on deleted/missing message → 404 ────────────────────────

  it('PATCH on missing message returns 404', async () => {
    await expect(
      ctrl.update(req(s(author)), 'no-such-id', { body_html: '<b>x</b>' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DELETE on missing message returns 404', async () => {
    await expect(ctrl.remove(req(s(author)), 'no-such-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
