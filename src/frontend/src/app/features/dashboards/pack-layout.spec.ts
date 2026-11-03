import type { Widget } from '../../core/api/models';
import { packLayout } from './dashboard-builder.page';

const w = (id: number, width: number, height = 2) => ({ id, type: 'BAR', title: `W${id}`, querySpec: { metrics: ['student_count'] }, position: { x: 99, y: 99, w: width, h: height } }) as Widget;

describe('packLayout', () => {
  it('xếp widget theo hàng 12 cột và xuống dòng khi tràn', () => {
    const out = packLayout([w(1, 6), w(2, 6, 3), w(3, 4), w(4, 12)]);
    expect(out.map((x) => x.position)).toEqual([
      { x: 0, y: 0, w: 6, h: 2 },
      { x: 6, y: 0, w: 6, h: 3 },
      { x: 0, y: 3, w: 4, h: 2 },
      { x: 0, y: 5, w: 12, h: 2 },
    ]);
  });

  it('giới hạn độ rộng tối đa 12 cột', () => {
    expect(packLayout([w(1, 20)])[0].position.w).toBe(12);
  });
});
