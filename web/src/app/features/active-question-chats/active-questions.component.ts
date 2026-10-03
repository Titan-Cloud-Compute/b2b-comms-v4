import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../shared/api/api-client';
import { QuestionSummary, parseSides, questionsApi, registerActiveQuestionMocks } from './active-questions.api';

/** Active Questions section: list of a project's question chats + "new question" form. */
@Component({
  selector: 'app-active-questions',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="aq" data-testid="aq-list-page">
      <a [routerLink]="['/projects', projectId]" class="aq-back">← Back to project</a>
      <h2>Active Questions</h2>
      @if (error()) { <p class="aq-error" role="alert" data-testid="aq-error">{{ error() }}</p> }
      <ul class="aq-items" data-testid="aq-list">
        @for (q of items(); track q.id) {
          <li data-testid="aq-item">
            <a [routerLink]="['/projects', projectId, 'questions', q.id]">{{ q.name }}</a>
            <span class="aq-badge" [class.resolved]="q.status === 'resolved'">{{ q.status }}</span>
            @if (q.status === 'open' && sidesOf(q).length === 1) { <small>awaiting the other party's resolution</small> }
            @if (q.unread_count > 0) { <span class="aq-unread">{{ q.unread_count }}</span> }
          </li>
        } @empty {
          <li class="aq-empty">No active questions yet.</li>
        }
      </ul>
      <form class="aq-form" data-testid="aq-create-form" (ngSubmit)="create()">
        <label>Title <input name="title" data-testid="aq-title" [(ngModel)]="title" maxlength="200" /></label>
        <label>First message <textarea name="message" data-testid="aq-first-message" [(ngModel)]="message" rows="3"></textarea></label>
        <button type="submit" data-testid="aq-create" [disabled]="busy()">Open question</button>
      </form>
    </section>
  `,
  styles: [`
    .aq { max-width: 720px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .aq-items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .aq-items li { display: flex; gap: 8px; align-items: center; }
    .aq-badge { font-size: 12px; padding: 1px 6px; border-radius: 8px; border: 1px solid currentColor; }
    .aq-form { display: flex; flex-direction: column; gap: 8px; }
    .aq-error { color: #b00020; }
  `],
})
export class ActiveQuestionsComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  projectId = '';
  title = '';
  message = '';
  readonly items = signal<QuestionSummary[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('id') ?? '';
    registerActiveQuestionMocks(this.api, this.projectId);
    void this.load();
  }

  sidesOf(q: QuestionSummary) {
    return parseSides(q.resolved_sides);
  }

  async load(): Promise<void> {
    try {
      const res = await questionsApi.list(this.api, this.projectId);
      this.items.set(res?.items ?? []);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not load questions.');
    }
  }

  async create(): Promise<void> {
    const title = this.title.trim();
    const message = this.message.trim();
    if (!title || !message) {
      this.error.set('A title and a first message are required.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const q = await questionsApi.create(this.api, this.projectId, title, message);
      this.title = '';
      this.message = '';
      await this.router.navigate(['/projects', this.projectId, 'questions', q.id]);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'Could not open the question.');
    } finally {
      this.busy.set(false);
    }
  }
}
