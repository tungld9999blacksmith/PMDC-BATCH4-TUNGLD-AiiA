export const environment = {
  production: true,
  apiBase: '/api/v1',
  /**
   * Platform API mới hiện thực /health. Bật mock để giao diện chạy đầy đủ trên dữ liệu tổng hợp;
   * tắt khi backend hiện thực các endpoint trong docs/api/openapi.yaml.
   */
  useMockApi: true,
  mockLatencyMs: 200,
};
