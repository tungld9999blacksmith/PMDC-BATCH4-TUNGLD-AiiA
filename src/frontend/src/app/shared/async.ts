import { DestroyRef, WritableSignal, inject, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import type { Problem } from '../core/api/models';
import { problemMessage, toProblem } from '../core/http/problem';

export interface Async<T> {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  error: Problem | null;
}

/** Trạng thái tải dùng chung cho các trang: loading → ready | error. */
export class Loader<T> {
  readonly state: WritableSignal<Async<T>> = signal({ status: 'idle', data: null, error: null });
  private sub: Subscription | null = null;

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => this.sub?.unsubscribe());
  }

  get data(): T | null {
    return this.state().data;
  }

  /** keepData = giữ dữ liệu cũ khi làm mới (tránh nhấp nháy). */
  load(source: Observable<T>, keepData = false): void {
    this.sub?.unsubscribe();
    this.state.update((s) => ({ status: 'loading', data: keepData ? s.data : null, error: null }));
    this.sub = source.subscribe({
      next: (data) => this.state.set({ status: 'ready', data, error: null }),
      error: (e: unknown) => this.state.update((s) => ({ status: 'error', data: keepData ? s.data : null, error: toProblem(e) })),
    });
  }

  set(data: T): void {
    this.state.set({ status: 'ready', data, error: null });
  }

  message(): string {
    const e = this.state().error;
    return e ? problemMessage(e) : '';
  }
}

export function loader<T>(): Loader<T> {
  return new Loader<T>(inject(DestroyRef));
}
