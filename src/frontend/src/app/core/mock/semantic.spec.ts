import { isSuppressed } from '../api/models';
import { createDb } from './db';
import { SUPPRESSION_K, SemanticError, execute } from './semantic';

const NOW = Date.UTC(2026, 10, 1, 8, 0, 0);

describe('mock semantic layer', () => {
  it('chỉ trả nhóm thuộc phạm vi đơn vị của người gọi (BR08, BR11)', () => {
    const db = createDb(2026, NOW);
    const { result } = execute(db, { metrics: ['student_count'], dimensions: ['faculty'] }, { scope: ['CNTT'], allowUncertified: false });
    const faculties = (result.rows ?? []).map((r) => r[0]);
    expect(faculties.length).toBeGreaterThan(0);
    expect(faculties.every((f) => f === 'CNTT')).toBeTrue();
  });

  it('ẩn ô có ít hơn k người và đếm số ô bị ẩn (BR12)', () => {
    const db = createDb(2026, NOW);
    const { result } = execute(db, { metrics: ['avg_gpa'], dimensions: ['program', 'cohort', 'term'] }, { scope: null, allowUncertified: false });
    const hidden = (result.rows ?? []).filter((r) => isSuppressed(r[3])).length;
    expect(SUPPRESSION_K).toBe(5);
    expect(hidden).toBeGreaterThan(0);
    expect(result.suppressedCells).toBe(hidden);
  });

  it('từ chối metric chưa chứng nhận khi không cho phép (BR16)', () => {
    const db = createDb(2026, NOW);
    db.metrics.find((m) => m.code === 'avg_gpa')!.status = 'DRAFT';
    expect(() => execute(db, { metrics: ['avg_gpa'] }, { scope: null, allowUncertified: false })).toThrowError(SemanticError);
    expect(() => execute(db, { metrics: ['avg_gpa'] }, { scope: null, allowUncertified: true })).not.toThrow();
  });

  it('từ chối dimension không thuộc dataset nền của metric', () => {
    const db = createDb(2026, NOW);
    expect(() => execute(db, { metrics: ['publication_count'], dimensions: ['cohort'] }, { scope: null, allowUncertified: false })).toThrowError(SemanticError);
  });
});
