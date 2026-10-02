import { describe, expect, it } from 'vitest';
import { MAX_SEATS, dropSeats, estimateTotal, reconcileSelection, selectedSeats, selectionLabels, toggleSeat, unitOf } from './seats';

// Sơ đồ nhỏ: A1-A9 thường, G1 VIP, H1-H4 ghế đôi (hai cặp: H1-2 và H3-4).
const seat = (row, number, extra = {}) => ({
  id: `${row}${number}`, row, number, label: `${row}${number}`, type: 'STANDARD', pairCode: null, status: 'AVAILABLE', price: 90_000, ...extra,
});
const base = () => [
  ...Array.from({ length: 9 }, (_, i) => seat('A', i + 1)),
  seat('G', 1, { type: 'VIP', price: 105_000 }),
  seat('H', 1, { type: 'COUPLE', pairCode: 'H1-2', price: 200_000 }),
  seat('H', 2, { type: 'COUPLE', pairCode: 'H1-2', price: 200_000 }),
  seat('H', 3, { type: 'COUPLE', pairCode: 'H3-4', price: 200_000 }),
  seat('H', 4, { type: 'COUPLE', pairCode: 'H3-4', price: 200_000 }),
];
const find = (seats, id) => seats.find((s) => s.id === id);
const click = (selected, seats, id, max) => toggleSeat({ selected, seat: find(seats, id), seats, max });

describe('toggleSeat — ghế thường', () => {
  it('chọn rồi bỏ chọn', () => {
    const seats = base();
    const a = click(new Set(), seats, 'A1');
    expect([...a.selected]).toEqual(['A1']);
    expect(a.error).toBeNull();
    expect(click(a.selected, seats, 'A1').selected.size).toBe(0);
  });

  it('không sửa Set cũ (immutable) — React cần Set mới để vẽ lại', () => {
    const seats = base();
    const before = new Set(['A1']);
    const { selected } = click(before, seats, 'A2');
    expect(selected).not.toBe(before);
    expect(before.size).toBe(1);
  });

  it.each(['HELD', 'SOLD', 'UNAVAILABLE'])('không chọn được ghế %s', (status) => {
    const seats = base();
    find(seats, 'A3').status = status;
    const r = click(new Set(), seats, 'A3');
    expect(r.error).toBe('UNAVAILABLE');
    expect(r.selected.size).toBe(0);
  });
});

describe('⭐ giới hạn 8 ghế (BR-02)', () => {
  it('chọn được đúng 8 ghế, ghế thứ 9 bị chặn (LIMIT) và lựa chọn giữ nguyên', () => {
    const seats = base();
    let selected = new Set();
    for (let i = 1; i <= MAX_SEATS; i++) selected = click(selected, seats, `A${i}`).selected;
    expect(selected.size).toBe(8);
    const ninth = click(selected, seats, 'A9');
    expect(ninth.error).toBe('LIMIT');
    expect(ninth.selected.size).toBe(8);
  });

  it('bỏ một ghế thì chọn thêm được', () => {
    const seats = base();
    let selected = new Set();
    for (let i = 1; i <= 8; i++) selected = click(selected, seats, `A${i}`).selected;
    selected = click(selected, seats, 'A1').selected;
    expect(click(selected, seats, 'A9').error).toBeNull();
  });

  it('ghế đôi tính 2: đang có 7 ghế thì KHÔNG chọn thêm được một cặp (7 + 2 = 9)', () => {
    const seats = base();
    let selected = new Set();
    for (let i = 1; i <= 7; i++) selected = click(selected, seats, `A${i}`).selected;
    const r = click(selected, seats, 'H1');
    expect(r.error).toBe('LIMIT');
    expect(r.selected.size).toBe(7);
  });

  it('có 6 ghế thì chọn thêm được một cặp (6 + 2 = 8)', () => {
    const seats = base();
    let selected = new Set();
    for (let i = 1; i <= 6; i++) selected = click(selected, seats, `A${i}`).selected;
    const r = click(selected, seats, 'H3');
    expect(r.error).toBeNull();
    expect(r.selected.size).toBe(8);
  });
});

describe('⭐ ghế đôi luôn đi theo cặp (BR-05)', () => {
  it('bấm một ghế thì chọn cả hai; bấm lại thì bỏ cả hai', () => {
    const seats = base();
    const on = click(new Set(), seats, 'H2');
    expect([...on.selected].sort()).toEqual(['H1', 'H2']);
    expect(click(on.selected, seats, 'H1').selected.size).toBe(0);
  });

  it('hai cặp khác nhau độc lập', () => {
    const seats = base();
    const a = click(new Set(), seats, 'H1').selected;
    const b = click(a, seats, 'H3').selected;
    expect([...b].sort()).toEqual(['H1', 'H2', 'H3', 'H4']);
    expect([...click(b, seats, 'H1').selected].sort()).toEqual(['H3', 'H4']);
  });

  it('một nửa của cặp không còn trống thì KHÔNG chọn được cặp đó (PAIR_UNAVAILABLE)', () => {
    const seats = base();
    find(seats, 'H2').status = 'HELD';
    const r = click(new Set(), seats, 'H1');
    expect(r.error).toBe('PAIR_UNAVAILABLE');
    expect(r.selected.size).toBe(0);
  });

  it('unitOf trả cả cặp cho ghế đôi, một ghế cho ghế thường', () => {
    const seats = base();
    expect(unitOf(find(seats, 'H1'), seats).map((s) => s.id)).toEqual(['H1', 'H2']);
    expect(unitOf(find(seats, 'A1'), seats).map((s) => s.id)).toEqual(['A1']);
  });
});

describe('⭐ reconcileSelection — sơ đồ làm mới mỗi 10–15 giây, người khác có thể vừa lấy ghế', () => {
  it('bỏ ghế vừa bị giữ, giữ nguyên ghế còn trống, và báo nhãn ghế bị mất', () => {
    const seats = base();
    const selected = new Set(['A1', 'A2', 'G1']);
    find(seats, 'A2').status = 'HELD';
    const r = reconcileSelection(selected, seats);
    expect([...r.selected].sort()).toEqual(['A1', 'G1']);
    expect(r.lost).toEqual(['A2']);
  });

  it('ghế đã bán cũng bị bỏ', () => {
    const seats = base();
    find(seats, 'A1').status = 'SOLD';
    expect(reconcileSelection(new Set(['A1']), seats).lost).toEqual(['A1']);
  });

  it('một nửa ghế đôi mất thì bỏ luôn cả cặp (không để lẻ ghế đôi)', () => {
    const seats = base();
    find(seats, 'H2').status = 'SOLD';
    const r = reconcileSelection(new Set(['H1', 'H2', 'A1']), seats);
    expect([...r.selected]).toEqual(['A1']);
    expect(r.lost.length).toBeGreaterThan(0);
  });

  it('không có gì thay đổi thì không mất gì', () => {
    const seats = base();
    const r = reconcileSelection(new Set(['A1', 'H3', 'H4']), seats);
    expect(r.lost).toEqual([]);
    expect(r.selected.size).toBe(3);
  });

  it('ghế không còn trong sơ đồ (id lạ) cũng bị bỏ', () => {
    expect(reconcileSelection(new Set(['KHONG-CO']), base()).selected.size).toBe(0);
  });
});

describe('dropSeats — xử lý SEAT_UNAVAILABLE từ server', () => {
  it('bỏ đúng các ghế server báo, giữ ghế còn lại', () => {
    const seats = base();
    const r = dropSeats(new Set(['A1', 'A2', 'A3']), ['A2'], seats);
    expect([...r].sort()).toEqual(['A1', 'A3']);
  });
  it('bỏ một nửa ghế đôi thì bỏ cả cặp', () => {
    const seats = base();
    expect([...dropSeats(new Set(['H1', 'H2', 'A1']), ['H2'], seats)]).toEqual(['A1']);
  });
});

describe('tạm tính và nhãn', () => {
  it('cộng giá từng ghế; ghế đôi chỉ cộng MỘT lần cho mỗi cặp (giá trên mỗi ghế là giá cả cặp)', () => {
    const seats = base();
    expect(estimateTotal(new Set(['A1', 'G1']), seats)).toBe(90_000 + 105_000);
    expect(estimateTotal(new Set(['H1', 'H2']), seats)).toBe(200_000);
    expect(estimateTotal(new Set(['H1', 'H2', 'H3', 'H4', 'A1']), seats)).toBe(200_000 * 2 + 90_000);
    expect(estimateTotal(new Set(), seats)).toBe(0);
  });

  it('nhãn gộp ghế đôi và xếp theo hàng, số ghế', () => {
    const seats = base();
    expect(selectionLabels(new Set(['H2', 'H1', 'A2', 'G1', 'A1']), seats)).toEqual(['A1', 'A2', 'G1', 'H1-2']);
    expect(selectedSeats(new Set(['G1', 'A1']), seats).map((s) => s.id)).toEqual(['A1', 'G1']);
  });
});
