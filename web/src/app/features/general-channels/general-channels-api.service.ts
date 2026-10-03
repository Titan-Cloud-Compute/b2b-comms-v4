import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client';
import type {
  ChannelsResponse,
  CreateChannelInput,
  CreateChannelResponse,
  MessagesResponse,
  PostMessageInput,
  PostMessageResponse,
  PatchMessageResponse,
} from './general-channels.types';

@Injectable({ providedIn: 'root' })
export class GeneralChannelsApiService {
  private api = inject(ApiClient);

  listChannels(projectId: string): Promise<ChannelsResponse> {
    return this.api.get<ChannelsResponse>(`api/projects/${projectId}/channels`);
  }

  createChannel(projectId: string, input: CreateChannelInput): Promise<CreateChannelResponse> {
    return this.api.post<CreateChannelResponse>(`api/projects/${projectId}/channels`, input);
  }

  listMessages(channelId: string, cursor?: string | null): Promise<MessagesResponse> {
    return this.api.get<MessagesResponse>(
      `api/channels/${channelId}/messages`,
      cursor ? { cursor } : undefined,
    );
  }

  postMessage(channelId: string, input: PostMessageInput): Promise<PostMessageResponse> {
    return this.api.post<PostMessageResponse>(`api/channels/${channelId}/messages`, input);
  }

  patchMessage(messageId: string, body_html: string): Promise<PatchMessageResponse> {
    return this.api.patch<PatchMessageResponse>(`api/messages/${messageId}`, { body_html });
  }

  deleteMessage(messageId: string): Promise<void> {
    return this.api.delete<void>(`api/messages/${messageId}`);
  }
}
