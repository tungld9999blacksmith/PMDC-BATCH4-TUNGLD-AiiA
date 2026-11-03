/** Bộ sinh số ngẫu nhiên có seed để dữ liệu mock tái lập được giữa các lần tải. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number, digits = 2): number {
    return Number((this.next() * (max - min) + min).toFixed(digits));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  sample<T>(items: readonly T[], n: number): T[] {
    const copy = [...items];
    const out: T[] = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0]);
    return out;
  }
}

/** UUID v4 hình thức, xác định theo (nhóm, số thứ tự). */
export function mockUuid(group: number, n: number): string {
  const g = group.toString(16).padStart(4, '0');
  return `00000000-${g}-4000-9000-${n.toString(16).padStart(12, '0')}`;
}
