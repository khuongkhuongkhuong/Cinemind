import { describe, expect, it } from 'vitest';
import {
  EMPTY_MOVIE, EMPTY_SHOWTIME, movieToBody, movieToForm, pricingToBody, pricingToForm, showtimeToBody, validateMovie, validatePricing, validateShowtime,
} from './adminForms';

const goodMovie = { ...EMPTY_MOVIE, title: ' Phim A ', description: 'Mô tả', durationMin: '120', releaseDate: '2026-10-10' };

describe('movie form', () => {
  it('hợp lệ -> không lỗi', () => expect(validateMovie(goodMovie)).toEqual({}));
  it('bắt các lỗi chính (kể cả URL javascript: và //host)', () => {
    const e = validateMovie({ ...EMPTY_MOVIE, durationMin: '0', posterUrl: 'javascript:alert(1)', trailerUrl: '//evil.com' });
    expect(Object.keys(e).sort()).toEqual(['description', 'durationMin', 'posterUrl', 'releaseDate', 'title', 'trailerUrl']);
  });
  it('thời lượng lẻ hoặc trống bị từ chối', () => {
    expect(validateMovie({ ...goodMovie, durationMin: '90.5' }).durationMin).toBeTruthy();
    expect(validateMovie({ ...goodMovie, durationMin: '' }).durationMin).toBeTruthy();
  });
  it('body: trim, ô trống -> null, durationMin là số', () => {
    expect(movieToBody(goodMovie, true)).toMatchObject({ title: 'Phim A', durationMin: 120, director: null, posterUrl: null, status: 'COMING_SOON' });
  });
  it('khi SỬA không gửi status', () => expect(movieToBody(goodMovie, false)).not.toHaveProperty('status'));
  it('movieToForm lấy id thể loại', () => {
    expect(movieToForm({ ...goodMovie, durationMin: 100, genres: [{ id: 'g1', name: 'x' }], director: null }).genreIds).toEqual(['g1']);
  });
});

describe('showtime form', () => {
  const now = Date.parse('2026-10-02T00:00:00Z');
  const good = { ...EMPTY_SHOWTIME, movieId: 'm', roomId: 'r', start: '2026-10-05T18:30' };
  it('hợp lệ', () => expect(validateShowtime(good, now)).toEqual({}));
  it('giờ quá khứ bị từ chối', () => expect(validateShowtime({ ...good, start: '2026-10-01T10:00' }, now).start).toMatch(/tương lai/));
  it('thiếu phim / phòng / giờ', () => expect(Object.keys(validateShowtime(EMPTY_SHOWTIME, now)).sort()).toEqual(['movieId', 'roomId', 'start']));
  it('giá âm / lẻ bị từ chối', () => {
    expect(validateShowtime({ ...good, basePrice: '-1' }, now).basePrice).toBeTruthy();
    expect(validateShowtime({ ...good, basePrice: '1.5' }, now).basePrice).toBeTruthy();
  });
  it('body: giờ VN -> UTC; để trống giá thì KHÔNG gửi basePrice', () => {
    const b = showtimeToBody(good);
    expect(b.startTime).toBe('2026-10-05T11:30:00.000Z');
    expect(b).not.toHaveProperty('basePrice');
    expect(showtimeToBody({ ...good, basePrice: '90000' }).basePrice).toBe(90000);
  });
});

describe('pricing form', () => {
  const server = {
    priceRules: [{ format: 'F2D', dayType: 'WEEKDAY', basePrice: 70000 }, { format: 'F2D', dayType: 'WEEKEND', basePrice: 90000 }],
    surcharges: [{ seatType: 'VIP', surcharge: 20000 }],
  };
  it('đi - về giữ nguyên dữ liệu', () => expect(pricingToBody(pricingToForm(server))).toEqual(server));
  it('ô trống / không phải số bị từ chối', () => {
    const f = pricingToForm(server);
    f.rules['F2D|WEEKDAY'] = '';
    f.surcharges.VIP = 'abc';
    expect(Object.keys(validatePricing(f)).sort()).toEqual(['rule:F2D|WEEKDAY', 'sur:VIP']);
  });
});
