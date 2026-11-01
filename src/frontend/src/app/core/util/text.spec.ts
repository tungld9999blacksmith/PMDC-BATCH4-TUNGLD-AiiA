import { foldVietnamese, maskPartial, matchesQuery } from './text';

describe('text utils', () => {
  it('foldVietnamese bỏ dấu, đ → d và hạ chữ thường', () => {
    expect(foldVietnamese('  Nguyễn Văn Đức ')).toBe('nguyen van duc');
    expect(foldVietnamese('Học phí ĐÃ NỘP')).toBe('hoc phi da nop');
  });

  it('matchesQuery yêu cầu mọi từ khóa có mặt, không phân biệt dấu', () => {
    expect(matchesQuery('Tỉ lệ cảnh báo học vụ', 'canh bao')).toBeTrue();
    expect(matchesQuery('Tỉ lệ cảnh báo học vụ', 'cảnh  HỌC')).toBeTrue();
    expect(matchesQuery('Tỉ lệ cảnh báo học vụ', 'canh thoi')).toBeFalse();
    expect(matchesQuery('bất kỳ', '   ')).toBeTrue();
  });

  it('maskPartial giữ ký tự đầu và vài ký tự cuối', () => {
    expect(maskPartial('001203004234')).toBe('0********234');
    expect(maskPartial('0123456789', 2)).toBe('0*******89');
    expect(maskPartial('abc')).toBe('•••');
  });
});
