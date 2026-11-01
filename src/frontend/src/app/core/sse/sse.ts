import { Observable } from 'rxjs';

export interface RawSseEvent {
  event: string;
  data: string;
}

/**
 * Tách luồng text/event-stream thành các sự kiện. Giữ phần dư chưa trọn vẹn giữa các chunk.
 * Trả về [các sự kiện đã trọn vẹn, phần dư].
 */
export function parseSseChunk(buffer: string): [RawSseEvent[], string] {
  const events: RawSseEvent[] = [];
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return [events, rest];
}

/**
 * Gọi endpoint SSE bằng fetch (hỗ trợ POST và header Authorization, EventSource không làm được).
 * Hủy subscription sẽ hủy request.
 */
export function streamSse<T extends { event: string; data: unknown }>(
  url: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; token?: string | null },
): Observable<T> {
  return new Observable<T>((subscriber) => {
    const controller = new AbortController();
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.token) headers['Authorization'] = `Bearer ${init.token}`;

    fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          subscriber.error(new Error(`SSE ${response.status}`));
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const [events, rest] = parseSseChunk(buffer + decoder.decode(value, { stream: true }));
          buffer = rest;
          for (const e of events) subscriber.next({ event: e.event, data: JSON.parse(e.data) } as T);
        }
        subscriber.complete();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) subscriber.error(error);
      });

    return () => controller.abort();
  });
}
