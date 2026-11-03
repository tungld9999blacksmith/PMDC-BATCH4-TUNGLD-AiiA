import { parseSseChunk } from './sse';

describe('parseSseChunk', () => {
  it('tách sự kiện trọn vẹn và giữ phần dư', () => {
    const [events, rest] = parseSseChunk('event: status\ndata: {"stage":"CHECKING"}\n\nevent: token\ndata: {"te');
    expect(events).toEqual([{ event: 'status', data: '{"stage":"CHECKING"}' }]);
    expect(rest).toBe('event: token\ndata: {"te');
  });

  it('gộp nhiều dòng data, mặc định event "message", chấp nhận CRLF', () => {
    const [events, rest] = parseSseChunk('data: a\r\ndata: b\r\n\r\n');
    expect(events).toEqual([{ event: 'message', data: 'a\nb' }]);
    expect(rest).toBe('');
  });

  it('bỏ qua khối không có data (comment, heartbeat)', () => {
    const [events] = parseSseChunk(': ping\n\nevent: end\ndata: {}\n\n');
    expect(events).toEqual([{ event: 'end', data: '{}' }]);
  });
});
