import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client';
import {
  ChannelsListResponse,
  CreatedChannel,
  CreatedMessage,
  MessagesResponse,
  PatchedMessage,
} from './general-channels.types';

@Injectable({ providedIn: 'root' })
export class GeneralChannelsApiService {
  private readonly api = inject(ApiClient);

  listChannels(projectId: string): Promise<ChannelsListResponse> {
    return this.api.get<ChannelsListResponse>(`/api/projects/${encodeURIComponent(projectId)}/channels`);
  }

  createChannel(projectId: string, name: string, internal_only: boolean): Promise<CreatedChannel> {
    return this.api.post<CreatedChannel>(`/api/projects/${encodeURIComponent(projectId)}/channels`, { name, internal_only });
  }

  listMessages(channelId: string, cursor?: string): Promise<MessagesResponse> {
    return this.api.get<MessagesResponse>(
      `/api/channels/${encodeURIComponent(channelId)}/messages`,
      cursor ? { cursor } : undefined,
    );
  }

  postMessage(channelId: string, body_html: string): Promise<CreatedMessage> {
    return this.api.post<CreatedMessage>(`/api/channels/${encodeURIComponent(channelId)}/messages`, { body_html });
  }

  editMessage(messageId: string, body_html: string): Promise<PatchedMessage> {
    return this.api.patch<PatchedMessage>(`/api/messages/${encodeURIComponent(messageId)}`, { body_html });
  }

  deleteMessage(messageId: string): Promise<unknown> {
    return this.api.delete(`/api/messages/${encodeURIComponent(messageId)}`);
  }
}
