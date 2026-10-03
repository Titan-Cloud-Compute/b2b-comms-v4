import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { InvitationsApi } from './invitations-api.service';
import { BadRequestError } from '../../shared/api/api-errors';

@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="accept-invite-page">
      <div class="accept-invite-container">
        <h2>Accept Invitation</h2>
        <p>Create your account to get started.</p>

        <form (ngSubmit)="onSubmit()" class="accept-invite-form">
          @if (serverError()) {
            <div role="alert" class="error-message">{{ serverError() }}</div>
          }

          <div class="form-group">
            <label for="accept-display-name">Display Name</label>
            <input
              type="text"
              id="accept-display-name"
              [(ngModel)]="displayName"
              name="displayName"
              required
            />
          </div>

          <div class="form-group">
            <label for="accept-password">Password</label>
            <input
              type="password"
              id="accept-password"
              [(ngModel)]="password"
              name="password"
              required
              minlength="8"
            />
          </div>

          <button type="submit" [disabled]="isLoading()">
            @if (isLoading()) {
              Submitting...
            } @else {
              Accept Invitation
            }
          </button>
        </form>
      </div>
    </div>
  `
})
export class AcceptInviteComponent {
  displayName = '';
  password = '';
  serverError = signal<string | null>(null);
  isLoading = signal(false);

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private invitationsApi = inject(InvitationsApi);

  async onSubmit() {
    this.serverError.set(null);
    this.isLoading.set(true);

    const token = this.route.snapshot.paramMap.get('token') ?? '';

    try {
      const result = await this.invitationsApi.accept({
        token,
        password: this.password,
        display_name: this.displayName,
      });
      this.auth.setUser({
        id: result.user.id,
        email: result.user.email,
        name: this.displayName,
        role: result.user.role as 'USER' | 'MANAGER' | 'ADMIN' | 'SUPER_ADMIN',
        organizationId: result.user.organization_id,
      });
      this.router.navigate(['/projects', result.project_id]);
    } catch (err) {
      if (err instanceof BadRequestError) {
        const body = (err as BadRequestError).body as Record<string, unknown> | null;
        this.serverError.set(typeof body?.['error'] === 'string' ? body['error'] : 'Invalid request');
      } else {
        this.serverError.set('Something went wrong. Please try again.');
      }
    } finally {
      this.isLoading.set(false);
    }
  }
}
