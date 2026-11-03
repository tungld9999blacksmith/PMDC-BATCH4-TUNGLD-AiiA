import { ID } from './db';
import { MockBackend } from './mock-backend';

const auth = (userId: string) => ({ authorization: `Bearer demo:${userId}` });

describe('MockBackend', () => {
  let backend: MockBackend;

  beforeEach(() => (backend = new MockBackend()));

  const get = (userId: string | null, path: string) => backend.handle('GET', path, new URLSearchParams(), null, userId ? auth(userId) : {});
  const post = (userId: string, path: string, body: unknown) => backend.handle('POST', path, new URLSearchParams(), body, auth(userId));
  const createRequest = async (userId: string, resourceId: string) => {
    const res = await post(userId, '/access-requests', { resourceType: 'DATASET', resourceId, purpose: 'Đối chiếu số liệu theo học kỳ', requestedDays: 30 });
    expect(res.status).toBe(201);
    return (res.body as { id: number }).id;
  };

  it('trả 401 khi thiếu token', async () => {
    expect((await get(null, '/me')).status).toBe(401);
  });

  it('khóa facet cần cấp quyền và gợi ý yêu cầu quyền (BR10)', async () => {
    const student = backend.db.persons.find((p) => p.student?.faculty === 'CNTT' && !p.staff)!;
    const res = await get(ID.dean, `/profiles/${student.id}/facets/FINANCE`);
    expect(res.status).toBe(403);
    expect((res.body as { requestable?: unknown }).requestable).toEqual({ resourceType: 'PROFILE_FACET', resourceId: 'FINANCE' });
    expect((await get(ID.dean, `/profiles/${student.id}/facets/ACADEMIC`)).status).toBe(200);
  });

  it('hồ sơ ngoài phạm vi trả 404 để không lộ sự tồn tại (BR08)', async () => {
    const outside = backend.db.persons.find((p) => p.student && p.student.faculty !== 'CNTT' && !p.lecturer && !p.staff)!;
    expect((await get(ID.dean, `/profiles/${outside.id}`)).status).toBe(404);
  });

  it('giới hạn thời hạn yêu cầu quyền 180 ngày (BR09)', async () => {
    const res = await post(ID.analyst, '/access-requests', { resourceType: 'DATASET', resourceId: '1', purpose: 'Phân tích tỉ lệ thôi học theo ngành', requestedDays: 181 });
    expect(res.status).toBe(422);
  });

  it('không cho tự duyệt yêu cầu của chính mình (BR09)', async () => {
    const id = await createRequest(ID.steward, '3');
    expect((await post(ID.steward, `/access-requests/${id}/decision`, { decision: 'APPROVE', grantedDays: 7 })).status).toBe(403);
  });

  it('từ chối yêu cầu phải kèm lý do', async () => {
    const id = await createRequest(ID.analyst, '4');
    expect((await post(ID.steward, `/access-requests/${id}/decision`, { decision: 'REJECT' })).status).toBe(422);
    expect((await post(ID.steward, `/access-requests/${id}/decision`, { decision: 'REJECT', note: 'Cần văn bản phê duyệt của khoa' })).status).toBe(200);
  });

  it('chặn API theo vai trò ở phía máy chủ, không chỉ ở route', async () => {
    expect((await get(ID.dean, '/admin/users')).status).toBe(403);
  });
});
