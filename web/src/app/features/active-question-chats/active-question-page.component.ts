import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient, ApiError } from '../../shared/api/api-client';
import {
  QuestionMessage,
  QuestionStatus,
  Side,
  parseSides,
  questionsApi,
  registerActiveQuestionMocks,
} from './active-questions.api';

/** A single active question: messages, composer, two-sided resolve / withdraw. */
@Component({
  selector: 'app-active-question-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="aq" data-testid="aq-question-page">
      <a [routerLink]="['/projects', projectId, 'questions']" class="aq-back">← Active Questions</a>
      <header class="aq-head">
        <h2 data-testid="aq-title-text">{{ name() || 'Active question' }}</h2>
        <span class="aq-badge" data-testid="aq-status" [class.resolved]="status() === 'resolved'">{{ status() }}</span>
      </header>
      @if (awaitingOther()) {
        <p class="aq-awaiting" data-testid="aq-awaiting">awaiting the other party's resolution</p>
      }
      @if (status() === 'open' && otherSideResolved()) {
        <p class="aq-awaiting" data-testid="aq-other-resolved">The other party marked this resolved — confirm to close it.</p>
      }
      <button type="button" data-testid="aq-resolve-toggle" [disabled]="busy() || status() === 'resolved'" (click)="toggleResolve()">
        {{ status() === 'resolved' ? 'Resolved' : (mySideResolved() ? 'Withdraw' : 'Mark resolved') }}
      </button>
      @if (error()) { <p class="aq-error" role="alert" data-testid="aq-error">{{ error() }}</p> }
      <ol class="aq-messages" data-testid="aq-messages">
        @for (m of messages(); track m.id) {
          <li data-testid="aq-message" [innerHTML]="m.body_html"></li>
        }
      </ol>
      @if (status() === 'open') {
        <form class="aq-composer" (ngSubmit)="send()">
          <textarea name="draft" data-testid="aq-composer" [(ngModel)]="draft" rows="3" placeholder="Write a message…"></textarea>
          <button type="submit" data-testid="aq-send" [disabled]="busy()">Send</button>
        </form>
      } @else {
        <p class="aq-closed" data-testid="aq-closed">This question is resolved. No further messages can be posted.</p>
      }
    </section>
  `,
  styles: [`
    .aq { max-width: 720px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .aq-head { display: flex; align-items: center; gap: 8px; }
    .aq-badge { font-size: 12px; padding: 1px 6px; border-radius: 8px; border: 1px solid currentColor; text-transform: lowercase; }
    .aq-messages { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .aq-composer { display: flex; flex-direction: column; gap: 8px; }
    .aq-error { color: #b00020; }
  `],
})
export class ActiveQuestionPageComponent implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);

  projectId = '';
  questionId = '';
  draft = '';
  readonly name = signal('');
  readonly status = signal<QuestionStatus>('open');
  readonly resolvedSides = signal<Side[]>([]);
  readonly mySide = signal<Side>('internal');
  readonly messages = signal<QuestionMessage[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly mySideResolved = computed(() => this.resolvedSides().includes(this.mySide()));
  readonly otherSideResolved = computed(() => this.resolvedSides().some((s) => s !== this.mySide()));
  readonly awaitingOther = computed(
    () => this.status() === 'open' && this.mySideResolved() && !this.otherSideResolved(),
  );

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('id') ?? '';
    this.questionId = this.route.snapshot.paramMap.get('channelId') ?? '';
    registerActiveQuestionMocks(this.api, this.projectId, this.questionId);
    void this.load();
  }

  private fail(e: unknown, fallback: string): void {
    this.error.set(e instanceof ApiError ? e.message : fallback);
  }

  async load(): Promise<void> {
    try {
      const q = await questionsApi.get(this.api, this.questionId);
      this.name.set(q.name);
      this.status.set(q.status === 'resolved' ? 'resolved' : 'open');
      this.resolvedSides.set(parseSides(q.resolved_sides));
      this.mySide.set(q.my_side === 'external' ? 'external' : 'internal');
      this.messages.set(q.messages ?? []);
    } catch (e) {
      this.fail(e, 'Could not load this question.');
    }
  }

  async toggleResolve(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const res = this.mySideResolved()
        ? await questionsApi.unresolve(this.api, this.questionId)
        : await questionsApi.resolve(this.api, this.questionId);
      this.status.set(res.status === 'resolved' ? 'resolved' : 'open');
      this.resolvedSides.set(parseSides(res.resolved_sides));
    } catch (e) {
      this.fail(e, 'Could not update the resolution.');
    } finally {
      this.busy.set(false);
    }
  }

  async send(): Promise<void> {
    const body = this.draft.trim();
    if (!body) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const msg = await questionsApi.postMessage(this.api, this.questionId, body);
      this.messages.update((list) => [...list, msg]);
      this.draft = '';
      // A new message clears any pending resolution marks.
      this.resolvedSides.set([]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) this.status.set('resolved');
      this.fail(e, 'Could not send the message.');
    } finally {
      this.busy.set(false);
    }
  }
}
