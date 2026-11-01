import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { AssistantMessage, Conversation } from '../../core/api/models';
import { AssistantApi } from '../../core/api/services';
import { problemMessage, toProblem } from '../../core/http/problem';
import { DialogsService } from '../../core/ui/dialogs.service';
import { ToastService } from '../../core/ui/toast.service';
import { MockHttpError } from '../../core/mock/mock-backend';
import { PageHeaderComponent } from '../../shared/overlays';
import { RelTimePipe } from '../../shared/pipes';
import { StateViewComponent } from '../../shared/state-view';
import { SemanticCatalog } from '../dashboards/semantic-catalog.service';
import { AnswerCardComponent } from './answer-card';

const SUGGESTIONS = [
  'Tỉ lệ cảnh báo học vụ theo khoa',
  'GPA trung bình qua các học kỳ',
  'Số sinh viên theo khóa năm học 2025-2026',
  'Tỉ lệ thôi học theo ngành',
  'Số công bố theo năm',
  'Giờ giảng theo khoa',
];

/** P12 — Trợ lý hỏi-đáp trên dữ liệu được cấp quyền (US39, BR16). */
@Component({
  selector: 'aiia-assistant-page',
  standalone: true,
  imports: [FormsModule, RouterLink, PageHeaderComponent, StateViewComponent, AnswerCardComponent, RelTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assistant.page.html',
  styleUrl: './assistant.page.css',
})
export class AssistantPage {
  readonly conversationId = input<string | undefined>();
  readonly q = input<string | undefined>();
  readonly dashboardId = input<string | undefined>();

  private readonly api = inject(AssistantApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialogs = inject(DialogsService);
  private readonly catalog = inject(SemanticCatalog);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly demo = environment.useMockApi;
  protected readonly conversations = signal<Conversation[]>([]);
  protected readonly messages = signal<AssistantMessage[]>([]);
  protected readonly loading = signal(false);
  protected readonly asking = signal(false);
  protected readonly stage = signal<string | null>(null);
  protected readonly draft = signal('');
  protected readonly lastQuestion = signal('');
  protected readonly suggestions = computed(() => {
    const certified = new Set(this.catalog.metrics().filter((m) => m.status === 'CERTIFIED').map((m) => m.code));
    return certified.size ? SUGGESTIONS : [];
  });
  private stream: Subscription | null = null;
  private autoAsked = false;

  constructor() {
    this.loadConversations();
    effect(() => {
      const id = this.conversationId();
      untracked(() => (id ? this.openConversation(id) : this.messages.set([])));
    });
    effect(() => {
      const q = this.q();
      const dash = this.dashboardId();
      if ((q || dash) && !this.autoAsked && !this.conversationId()) {
        this.autoAsked = true;
        untracked(() => this.startConversation(q ?? null, dash ? Number(dash) : null));
      }
    });
  }

  private loadConversations(): void {
    this.api.conversations().subscribe({ next: (c) => this.conversations.set(c), error: () => this.conversations.set([]) });
  }

  private openConversation(id: string): void {
    this.loading.set(true);
    this.api.conversation(id).subscribe({
      next: (c) => {
        this.loading.set(false);
        this.messages.set(c.messages ?? []);
        this.scrollDown();
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.toast.error(problemMessage(toProblem(e)));
      },
    });
  }

  newConversation(): void {
    this.startConversation(null, null);
  }

  private startConversation(question: string | null, dashboardId: number | null): void {
    this.api.create(dashboardId).subscribe({
      next: (c) => {
        this.conversations.update((list) => [c, ...list]);
        void this.router.navigate(['/assistant', c.id], { replaceUrl: true }).then(() => {
          if (question) this.ask(question);
        });
      },
      error: (e: unknown) => this.toast.error(problemMessage(toProblem(e))),
    });
  }

  submit(): void {
    const text = this.draft().trim();
    if (!text || this.asking()) return;
    this.draft.set('');
    if (!this.conversationId()) this.startConversation(text, null);
    else this.ask(text);
  }

  ask(question: string, clarification?: Record<string, unknown>): void {
    const id = this.conversationId();
    if (!id) return;
    this.lastQuestion.set(question);
    this.asking.set(true);
    this.stage.set('CHECKING');
    const now = new Date().toISOString();
    if (!clarification) this.messages.update((m) => [...m, { id: -Date.now(), role: 'USER', content: question, createdAt: now }]);
    const pending: AssistantMessage = { id: -1, role: 'ASSISTANT', content: '', status: undefined, createdAt: now };
    this.messages.update((m) => [...m, pending]);
    this.scrollDown();
    this.stream?.unsubscribe();
    this.stream = this.api.ask(id, { message: question, clarification }).subscribe({
      next: (e) => {
        if (e.event === 'status') this.stage.set(e.data.stage);
        else if (e.event === 'token') this.patchPending((p) => ({ ...p, content: (p.content ?? '') + e.data.text }));
        else if (e.event === 'clarify') this.patchPending((p) => ({ ...p, clarify: e.data }));
        else if (e.event === 'final') {
          this.stage.set(null);
          this.patchPending(() => e.data);
        }
        this.scrollDown();
      },
      error: (err: unknown) => {
        this.asking.set(false);
        this.stage.set(null);
        const p = err instanceof MockHttpError ? toProblem({ error: err.response.body, status: err.response.status }) : toProblem(err);
        this.patchPending((m) => ({ ...m, status: 'FAILED', content: p.status === 429 ? 'Bạn đã hỏi quá nhiều trong một phút. Thử lại sau ít phút.' : 'Không xử lý được câu hỏi. Thử lại sau.' }));
      },
      complete: () => {
        this.asking.set(false);
        this.loadConversations();
      },
    });
  }

  private patchPending(fn: (m: AssistantMessage) => AssistantMessage): void {
    this.messages.update((list) => {
      const i = list.findIndex((m) => m.id === -1);
      if (i < 0) return list;
      const copy = [...list];
      copy[i] = fn(copy[i]);
      return copy;
    });
  }

  onClarify(patch: Record<string, unknown>): void {
    this.ask(this.lastQuestion() || this.findQuestion(), patch);
  }

  private findQuestion(): string {
    return [...this.messages()].reverse().find((m) => m.role === 'USER')?.content ?? '';
  }

  rate(m: AssistantMessage, rating: -1 | 1): void {
    if (!m.id || m.id < 0) return;
    this.api.rate(m.id, rating).subscribe(() => this.messages.update((list) => list.map((x) => (x.id === m.id ? { ...x, feedback: rating } : x))));
  }

  requestAccess(): void {
    this.dialogs.requestAccess({ resourceType: 'DATASET', resourceId: '14', resourceName: 'gold.mart_student_term_kpi (đơn vị khác)' });
  }

  useSuggestion(s: string): void {
    this.draft.set(s);
    this.submit();
  }

  private scrollDown(): void {
    queueMicrotask(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
