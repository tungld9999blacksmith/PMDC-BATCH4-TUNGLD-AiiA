/** Bỏ dấu tiếng Việt và hạ chữ thường để tìm kiếm không phân biệt dấu (F3.3, NFR30). */
export function foldVietnamese(text: string): string {
  return text
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** true khi mọi từ của `query` đều xuất hiện trong `text`, không phân biệt dấu. */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = foldVietnamese(text);
  return foldVietnamese(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Che một phần chuỗi, giữ `visible` ký tự cuối (VD CCCD `0********234`). */
export function maskPartial(value: string, visible = 3): string {
  if (value.length <= visible + 1) return '•'.repeat(value.length);
  return value[0] + '*'.repeat(value.length - visible - 1) + value.slice(-visible);
}
