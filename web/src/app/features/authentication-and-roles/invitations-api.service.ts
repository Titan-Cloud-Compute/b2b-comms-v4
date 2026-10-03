import { Injectable, inject } from '@angular/core';
import { ApiClient } from '../../shared/api/api-client.service';

export interface AcceptInviteInput {
  token: string;
  password: string;
  display_name: string;
}

export interface AcceptInviteResponse {
  user: {
    id: string;
    email: string;
    role: string;
    organization_id: string;
  };
  project_id: string;
}

@Injectable({ providedIn: 'root' })
export class InvitationsApi {
  private api = inject(ApiClient);

  accept(input: AcceptInviteInput): Promise<AcceptInviteResponse> {
    return this.api.post<AcceptInviteResponse>('invitations/accept', input);
  }
}
