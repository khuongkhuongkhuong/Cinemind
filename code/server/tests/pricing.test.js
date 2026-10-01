import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcSeatPrices, getDayType } from '../src/services/pricing.service.js';

const surcharges = { STANDARD: 0, VIP: 15000, COUPLE: 20000 };

test('ghế thường = giá gốc; VIP = giá gốc + 15.000 (BR-11, BR-13)', () => {
  const { seats, total } = calcSeatPrices({
    basePrice: 90000,
    surcharges,
    seats: [{ id: 'a', type: 'STANDARD' }, { id: 'b', type: 'VIP' }],
  });
  assert.deepEqual(seats.map((s) => s.price), [90000, 105000]);
  assert.equal(total, 195000);
});

test('ghế đôi: cả cặp = giá gốc x 2 + 20.000, mỗi ghế lưu một nửa (BR-13)', () => {
  const { seats, total } = calcSeatPrices({
    basePrice: 90000,
    surcharges,
    seats: [
      { id: 'h1', type: 'COUPLE', pairCode: 'H1-2' },
      { id: 'h2', type: 'COUPLE', pairCode: 'H1-2' },
    ],
  });
  assert.equal(total, 200000); // khớp mẫu trong 04-api-contract (price 200000 cả cặp)
  assert.deepEqual(seats.map((s) => s.price), [100000, 100000]);
  assert.equal(seats[0].pairPrice, 200000);
});

test('tổng các ghế luôn bằng giá cặp kể cả khi giá cặp lẻ (không mất 1 đồng)', () => {
  const { total } = calcSeatPrices({
    basePrice: 75001,
    surcharges: { ...surcharges, COUPLE: 21 },
    seats: [
      { id: 'h1', type: 'COUPLE', pairCode: 'H1-2' },
      { id: 'h2', type: 'COUPLE', pairCode: 'H1-2' },
    ],
  });
  assert.equal(total, 75001 * 2 + 21);
});

test('hai cặp đôi khác nhau được tính độc lập', () => {
  const { total } = calcSeatPrices({
    basePrice: 75000,
    surcharges,
    seats: ['H1-2', 'H1-2', 'H3-4', 'H3-4'].map((pairCode, i) => ({ id: `h${i}`, type: 'COUPLE', pairCode })),
  });
  assert.equal(total, 2 * (75000 * 2 + 20000));
});

test('loại ngày theo giờ VN: T5 là WEEKDAY, T6 là WEEKEND', () => {
  // 2026-10-01 là Thứ Năm; 2026-10-02 là Thứ Sáu
  assert.equal(getDayType({ startTime: new Date('2026-10-01T11:30:00Z') }), 'WEEKDAY');
  assert.equal(getDayType({ startTime: new Date('2026-10-02T11:30:00Z') }), 'WEEKEND');
});

test('ranh giới múi giờ: 18:00 UTC thứ Năm = 01:00 sáng thứ Sáu giờ VN -> WEEKEND', () => {
  assert.equal(getDayType({ startTime: new Date('2026-10-01T18:00:00Z') }), 'WEEKEND');
});
