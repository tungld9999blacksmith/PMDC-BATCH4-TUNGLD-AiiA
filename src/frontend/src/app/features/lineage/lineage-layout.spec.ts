import type { LineageGraph } from '../../core/api/models';
import { layoutLineage } from './lineage.page';

describe('layoutLineage', () => {
  it('đặt nút phía trước bên trái tâm, phía sau bên phải', () => {
    const g: LineageGraph = {
      center: { id: 2 },
      nodes: [
        { id: 1, type: 'SOURCE', name: 'SRC-SIS' },
        { id: 2, type: 'DATASET', name: 'silver.students' },
        { id: 3, type: 'METRIC', name: 'student_count' },
        { id: 4, type: 'DASHBOARD', name: 'Đào tạo' },
      ],
      edges: [
        { from: 1, to: 2 },
        { from: 2, to: 3 },
        { from: 3, to: 4 },
      ],
    };
    const { placed, width } = layoutLineage(g);
    const x = (id: number) => placed.find((p) => p.node.id === id)!.x;
    expect(x(1)).toBeLessThan(x(2));
    expect(x(2)).toBeLessThan(x(3));
    expect(x(3)).toBeLessThan(x(4));
    expect(placed.find((p) => p.node.id === 2)!.depth).toBe(0);
    expect(width).toBeGreaterThan(x(4));
  });

  it('đồ thị rỗng không lỗi', () => {
    expect(layoutLineage({}).placed).toEqual([]);
  });
});
