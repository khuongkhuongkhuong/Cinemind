// Logic chọn ghế (hàm thuần, không phụ thuộc React) — 05-ui-pages mục P05, BR-02, BR-05.
// Giao diện chỉ GIÚP người dùng chọn đúng ngay từ đầu; server vẫn kiểm tra lại tất cả và là nguồn quyết định.

export const MAX_SEATS = 8; // BR-02: tối đa 8 ghế mỗi đơn (ghế đôi tính 2)

/** Ghế đôi: hai ghế cùng `pairCode` luôn được chọn / bỏ chọn cùng nhau (BR-05). */
export const isCouple = (seat) => seat.type === 'COUPLE' && Boolean(seat.pairCode);

/** Các ghế tạo thành "một lựa chọn" khi bấm vào `seat`: chính nó, hoặc cả cặp nếu là ghế đôi. */
export function unitOf(seat, seats) {
  if (!isCouple(seat)) return [seat];
  return seats.filter((s) => s.pairCode === seat.pairCode);
}

/**
 * Bấm một ghế: chọn / bỏ chọn.
 * - Chỉ ghế AVAILABLE mới chọn được.
 * - Ghế đôi chọn / bỏ cả cặp; cả hai ghế của cặp đều phải còn trống.
 * - Không quá MAX_SEATS ghế (ghế đôi tính 2).
 * @param {{ selected: Set<string>, seat: object, seats: object[], max?: number }} params
 * @returns {{ selected: Set<string>, error: null | 'UNAVAILABLE' | 'LIMIT' | 'PAIR_UNAVAILABLE' }}
 *   `selected` là Set MỚI (không sửa Set cũ) — phù hợp với state của React.
 */
export function toggleSeat({ selected, seat, seats, max = MAX_SEATS }) {
  const unit = unitOf(seat, seats);
  const next = new Set(selected);

  if (unit.every((s) => selected.has(s.id))) { // đang chọn -> bỏ chọn
    unit.forEach((s) => next.delete(s.id));
    return { selected: next, error: null };
  }
  if (seat.status !== 'AVAILABLE') return { selected, error: 'UNAVAILABLE' };
  if (unit.length > 1 && unit.some((s) => s.status !== 'AVAILABLE')) return { selected, error: 'PAIR_UNAVAILABLE' };

  const adding = unit.filter((s) => !selected.has(s.id));
  if (selected.size + adding.length > max) return { selected, error: 'LIMIT' };
  adding.forEach((s) => next.add(s.id));
  return { selected: next, error: null };
}

/**
 * Sau mỗi lần làm mới sơ đồ (mỗi 10–15 giây), bỏ khỏi lựa chọn những ghế KHÔNG CÒN trống (người khác vừa giữ / mua).
 * Giữ nguyên các ghế còn hợp lệ. Nếu một nửa của ghế đôi mất thì bỏ luôn nửa còn lại (không bao giờ để lẻ một ghế đôi).
 * @returns {{ selected: Set<string>, lost: string[] }} `lost` là nhãn các ghế bị mất (để thông báo cho người dùng)
 */
export function reconcileSelection(selected, seats) {
  const byId = new Map(seats.map((s) => [s.id, s]));
  const lost = [];
  const next = new Set();
  for (const id of selected) {
    const seat = byId.get(id);
    if (!seat) { lost.push(id); continue; }
    const unit = unitOf(seat, seats);
    if (unit.every((s) => s.status === 'AVAILABLE')) next.add(id);
    else lost.push(seat.label);
  }
  // Ghế đôi mất một nửa thì bỏ cả cặp
  for (const id of [...next]) {
    const seat = byId.get(id);
    if (isCouple(seat) && !unitOf(seat, seats).every((s) => next.has(s.id))) next.delete(id);
  }
  return { selected: next, lost };
}

/** Bỏ khỏi lựa chọn các ghế mà server báo vừa bị lấy (details.seatIds của SEAT_UNAVAILABLE), kể cả nửa còn lại của ghế đôi. */
export function dropSeats(selected, seatIdsToDrop, seats) {
  const byId = new Map(seats.map((s) => [s.id, s]));
  const next = new Set(selected);
  for (const id of seatIdsToDrop) {
    const seat = byId.get(id);
    (seat ? unitOf(seat, seats) : [{ id }]).forEach((s) => next.delete(s.id));
  }
  return next;
}

/** Danh sách ghế đã chọn theo thứ tự hàng → số ghế. */
export function selectedSeats(selected, seats) {
  return seats.filter((s) => selected.has(s.id)).sort((a, b) => a.row.localeCompare(b.row) || a.number - b.number);
}

/**
 * Tạm tính để hiển thị khi đang chọn ghế. Chỉ là ƯỚC TÍNH từ giá server đã trả trong sơ đồ ghế; con số chính thức
 * (có combo, giảm giá) luôn do server tính khi tạo đơn. Ghế đôi: `price` trên mỗi ghế là giá CẢ CẶP nên chỉ cộng một lần cho mỗi cặp.
 */
export function estimateTotal(selected, seats) {
  const counted = new Set();
  let total = 0;
  for (const seat of selectedSeats(selected, seats)) {
    if (isCouple(seat)) {
      if (counted.has(seat.pairCode)) continue;
      counted.add(seat.pairCode);
    }
    total += seat.price;
  }
  return total;
}

/** Nhãn ghế đã chọn, gộp "H1-2" cho ghế đôi: ["G7", "H1-2"]. */
export function selectionLabels(selected, seats) {
  const seen = new Set();
  const labels = [];
  for (const seat of selectedSeats(selected, seats)) {
    if (isCouple(seat)) {
      if (seen.has(seat.pairCode)) continue;
      seen.add(seat.pairCode);
      labels.push(seat.pairCode);
    } else {
      labels.push(seat.label);
    }
  }
  return labels;
}

export const SEAT_TYPE_LABEL = { STANDARD: 'Thường', VIP: 'VIP', COUPLE: 'Đôi' };
