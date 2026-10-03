import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiClient } from '../../shared/api/api-client.service';

/** Public screen: an invited contact sets a password to accept their invitation. */
@Component({
  selector: 'app-accept-invite',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="accept-invite">
      <h1>Accept invitation</h1>
      <form (ngSubmit)="onSubmit()">
        <label for="accept-display-name">Name</label>
        <input id="accept-display-name" name="displayName" type="text" [(ngModel)]="displayName" />
        <label for="accept-password">Password</label>
        <input id="accept-password" name="password" type="password" required [(ngModel)]="password" />
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <button type="submit" [disabled]="isLoading()">Accept invitation</button>
      </form>
    </main>
  `,
})
export class AcceptInviteComponent {
  private api = inject(ApiClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  displayName = '';
  password = '';
  error = signal<string | null>(null);
  isLoading = signal(false);

  async onSubmit() {
    if (!this.password) {
      this.error.set('Password is required');
      return;
    }
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const token = this.route.snapshot.paramMap.get('token') ?? '';
      await this.api.post('invitations/accept', {
        token,
        password: this.password,
        display_name: this.displayName || undefined,
      });
      this.router.navigateByUrl('/projects');
    } catch (err) {
      const msg = (err as { message?: string })?.message;
      this.error.set(msg || 'This invitation is invalid or has expired.');
    } finally {
      this.isLoading.set(false);
    }
  }
}
