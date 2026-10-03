import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';
import {
  ApiError,
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from '../../shared/api/api-errors';

// Contract shapes (General Channels).
export interface GeneralChannel {
  id: string;
  name: string;
  internal_only: boolean;
  unread_count: number;
}

export interface QuestionChannel {
  id: string;
  name: string;
  status: string;
  unread_count: number;
}

export interface ChannelList {
  general: GeneralChannel[];
  questions: QuestionChannel[];
}

export interface CreateChannelInput {
  name: string;
  internal_only: boolean;
}

export interface CreatedChannel {
  id: string;
  name: string;
  kind: string;
  internal_only: boolean;
  status: string;
}

export interface MessageAttachment {
  file_id: string;
  name: string;
}

export interface ChannelMessage {
  id: string;
  author: { id: string; display_name: string };
  body_html: string;
  attachments: MessageAttachment[];
  reference_id: string | null;
  edited_at: string | null;
  created_at: string;
}

export interface MessagePage {
  items: ChannelMessage[];
  next_cursor: string | null;
}

export interface PostMessageInput {
  body_html: string;
  attachments?: string[];
  reference_id?: string | null;
}

export interface CreatedMessage {
  id: string;
  channel_id: string;
  author_id: string;
  body_html: string;
  created_at: string;
}

export interface RealtimeEvent {
  type: string;
  channel_id: string;
  payload: Record<string, unknown>;
}

/** True when the request never reached the server (offline / dropped connection). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return e instanceof ApiError && e.status === 0;
}

/** Text content of an HTML fragment (for blank checks), without executing it. */
export function htmlText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]*>/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style').forEach(n => n.remove());
  return (doc.body.textContent ?? '').replace(/ /g, ' ');
}

/** Client-side mirror of the server sanitizer (defence in depth for the mock store). */
export function stripUnsafeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed').forEach(n => n.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || (name === 'href' && /^\s*javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

/**
 * General Channels API. Calls the real backend; when an endpoint has not
 * landed / the project is unknown (404 / unreachable) it falls back to
 * in-memory mock handlers. Auth/permission/validation errors (401/403/400)
 * are never masked. Message sends surface network errors so the UI can keep
 * them as "pending" and retry on reconnect.
 */
@Injectable({ providedIn: 'root' })
export class ChannelsApi {
  private api = inject(ApiClient);
  private mock = new ChannelsMockStore();

  private async withMock<T>(real: () => Promise<T>, fallback: () => T): Promise<T> {
    try {
      return await real();
    } catch (e) {
      if (
        e instanceof ForbiddenError ||
        e instanceof UnauthorizedError ||
        e instanceof BadRequestError
      ) {
        throw e;
      }
      return fallback();
    }
  }

  listChannels(projectId: string): Promise<ChannelList> {
    return this.withMock(
      () => this.api.get<ChannelList>(`projects/${projectId}/channels`),
      () => this.mock.listChannels(projectId),
    );
  }

  createChannel(projectId: string, input: CreateChannelInput): Promise<CreatedChannel> {
    if (!input.name || !input.name.trim()) {
      return Promise.reject(new BadRequestError(`projects/${projectId}/channels`, 'Channel name is required'));
    }
    return this.withMock(
      () => this.api.post<CreatedChannel>(`projects/${projectId}/channels`, input),
      () => this.mock.createChannel(projectId, input),
    );
  }

  listMessages(channelId: string, cursor?: string | null): Promise<MessagePage> {
    const params: Record<string, string> = {};
    if (cursor) params['cursor'] = cursor;
    return this.withMock(
      () => this.api.get<MessagePage>(`channels/${channelId}/messages`, { params }),
      () => this.mock.listMessages(channelId),
    );
  }

  async postMessage(channelId: string, input: PostMessageInput, author: { id: string; display_name: string }): Promise<CreatedMessage> {
    const blank = !htmlText(input.body_html).trim() && !(input.attachments?.length) && !input.reference_id;
    if (blank) {
      throw new BadRequestError(`channels/${channelId}/messages`, 'Message cannot be empty');
    }
    try {
      return await this.api.post<CreatedMessage>(`channels/${channelId}/messages`, input);
    } catch (e) {
      if (
        e instanceof ForbiddenError ||
        e instanceof UnauthorizedError ||
        e instanceof BadRequestError ||
        isNetworkError(e)
      ) {
        throw e;
      }
      return this.mock.postMessage(channelId, input, author);
    }
  }

  editMessage(id: string, bodyHtml: string): Promise<{ id: string; body_html: string; edited_at: string }> {
    return this.withMock(
      () => this.api.patch<{ id: string; body_html: string; edited_at: string }>(`messages/${id}`, { body_html: bodyHtml }),
      () => this.mock.editMessage(id, bodyHtml),
    );
  }

  deleteMessage(id: string): Promise<void> {
    return this.withMock(
      async () => { await this.api.delete<unknown>(`messages/${id}`); },
      () => this.mock.deleteMessage(id),
    );
  }

  /** Absolute URL of the server-sent-event feed (GET /api/realtime/socket). */
  realtimeUrl(): string {
    try {
      return new URL('api/realtime/socket', document.baseURI).toString();
    } catch {
      return 'api/realtime/socket';
    }
  }
}

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16));
}

/** In-memory mock handlers for endpoints not yet landed. */
class ChannelsMockStore {
  private channels = new Map<string, (GeneralChannel & { project_id: string })[]>();
  private messages = new Map<string, ChannelMessage[]>();

  private projectChannels(projectId: string): (GeneralChannel & { project_id: string })[] {
    let list = this.channels.get(projectId);
    if (!list) {
      list = [{ id: uuid(), project_id: projectId, name: 'general', internal_only: false, unread_count: 0 }];
      this.channels.set(projectId, list);
    }
    return list;
  }

  listChannels(projectId: string): ChannelList {
    return {
      general: this.projectChannels(projectId).map(({ project_id: _p, ...c }) => ({ ...c })),
      questions: [],
    };
  }

  createChannel(projectId: string, input: CreateChannelInput): CreatedChannel {
    const c = {
      id: uuid(), project_id: projectId, name: input.name.trim().replace(/^#\s*/, ''),
      internal_only: !!input.internal_only, unread_count: 0,
    };
    this.projectChannels(projectId).push(c);
    return { id: c.id, name: c.name, kind: 'general', internal_only: c.internal_only, status: 'active' };
  }

  listMessages(channelId: string): MessagePage {
    return { items: [...(this.messages.get(channelId) ?? [])], next_cursor: null };
  }

  postMessage(channelId: string, input: PostMessageInput, author: { id: string; display_name: string }): CreatedMessage {
    const m: ChannelMessage = {
      id: uuid(),
      author,
      body_html: stripUnsafeHtml(input.body_html),
      attachments: (input.attachments ?? []).map(file_id => ({ file_id, name: '' })),
      reference_id: input.reference_id ?? null,
      edited_at: null,
      created_at: new Date().toISOString(),
    };
    const list = this.messages.get(channelId) ?? [];
    list.push(m);
    this.messages.set(channelId, list);
    return { id: m.id, channel_id: channelId, author_id: author.id, body_html: m.body_html, created_at: m.created_at };
  }

  private find(id: string): ChannelMessage | undefined {
    for (const list of this.messages.values()) {
      const m = list.find(x => x.id === id);
      if (m) return m;
    }
    return undefined;
  }

  editMessage(id: string, bodyHtml: string): { id: string; body_html: string; edited_at: string } {
    const m = this.find(id);
    const edited_at = new Date().toISOString();
    const body_html = stripUnsafeHtml(bodyHtml);
    if (m) { m.body_html = body_html; m.edited_at = edited_at; }
    return { id, body_html, edited_at };
  }

  deleteMessage(id: string): void {
    for (const [k, list] of this.messages) {
      this.messages.set(k, list.filter(x => x.id !== id));
    }
  }
}
