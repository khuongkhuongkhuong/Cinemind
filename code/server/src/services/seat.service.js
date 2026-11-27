import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { toVnClock } from '../lib/time.js';
import { priceSeats } from './pricing.service.js';
import { loadShowtime, toDetail } from './showtime.service.js';
import { getSeatStatuses } from './ticket.service.js';

const fieldError = (field, message) => new AppError('VALIDATION_ERROR', { details: { fields: { [field]: message } } });

/**
 * Nạp suất + dựng sơ đồ ghế (dùng chung cho getSeatMap / suggestSeats / previewHold để chỉ đọc suất MỘT lần).
 * Trạng thái suy ra từ vé: SOLD -> SOLD; HELD còn hạn -> HELD; HELD đã quá hạn -> AVAILABLE ("dọn lười"); ghế hỏng -> UNAVAILABLE.
 * @returns {Promise<{ map: object, basePrice: number }>}
 * @throws {AppError} NOT_FOUND
 */
async function loadSeatMap({ showtimeId }) {
  const showtime = await loadShowtime({ showtimeId, withDetail: true });
  const now = new Date();
  const [seats, statuses] = await Promise.all([
    getSeatsOfRoom(showtime.roomId),
    getSeatStatuses({ showtimeId, now }),
  ]);
  const { seats: priced } = await priceSeats({ basePrice: showtime.basePrice, seats });
  const priceBySeat = new Map(priced.map((p) => [p.id, p]));

  return {
    basePrice: showtime.basePrice,
    map: {
      showtime: toDetail(showtime, now),
      rows: [...new Set(seats.map((s) => s.row))],
      seats: seats.map((s) => {
        const p = priceBySeat.get(s.id);
        return {
          id: s.id,
          row: s.row,
          number: s.number,
          label: `${s.row}${s.number}`,
          type: s.type,
          pairCode: s.pairCode,
          status: s.isActive ? (statuses.get(s.id) ?? 'AVAILABLE') : 'UNAVAILABLE',
          price: p.pairPrice ?? p.price, // ghế đôi: hiển thị giá cả cặp (hợp đồng mục 3.3)
        };
      }),
    },
  };
}

/**
 * Sơ đồ ghế của một suất, kèm trạng thái và giá từng ghế. ⭐
 * @param {{ showtimeId: string }} params
 * @returns {Promise<{ showtime: object, rows: string[], seats: Array<{ id: string, row: string, number: number, label: string, type: string, pairCode: string|null, status: 'AVAILABLE'|'HELD'|'SOLD'|'UNAVAILABLE', price: number }> }>}
 * @throws {AppError} NOT_FOUND
 */
export async function getSeatMap({ showtimeId }) {
  return (await loadSeatMap({ showtimeId })).map;
}

// Mẫu sơ đồ ghế khi quản trị viên thêm phòng (v1.29): hàng cuối là ghế đôi, `standardRows` hàng đầu là ghế thường, còn lại VIP.
export const ROOM_TEMPLATES = {
  SMALL: { rows: 6, perRow: 10, standardRows: 2 },
  MEDIUM: { rows: 8, perRow: 12, standardRows: 3 }, // giống dữ liệu mẫu (seed)
  LARGE: { rows: 10, perRow: 14, standardRows: 3 },
};

/** Danh sách ghế của một mẫu (hàm thuần). Ghế đôi ghép theo cặp số (1-2, 3-4...) với pairCode "H1-2". */
export function buildTemplateSeats(template) {
  const { rows, perRow, standardRows } = ROOM_TEMPLATES[template];
  return Array.from({ length: rows }, (_, r) => {
    const row = String.fromCharCode(65 + r);
    return Array.from({ length: perRow }, (__, i) => {
      const number = i + 1;
      if (r < rows - 1) return { row, number, type: r < standardRows ? 'STANDARD' : 'VIP', pairCode: null };
      const first = number % 2 === 1 ? number : number - 1;
      return { row, number, type: 'COUPLE', pairCode: `${row}${first}-${first + 1}` };
    });
  }).flat();
}

/**
 * Tạo toàn bộ ghế của một phòng mới theo mẫu. room.service gọi trong transaction tạo phòng.
 * @param {{ roomId: string, template: 'SMALL'|'MEDIUM'|'LARGE' }} params
 * @param {object} [db]
 * @returns {Promise<number>} số ghế đã tạo
 */
export async function createSeatsForRoom({ roomId, template }, db) {
  const seats = buildTemplateSeats(template).map((s) => ({ ...s, roomId }));
  return (await insertSeats(seats, db)).count;
}

/**
 * Xóa mọi ghế của một phòng (chỉ dùng khi xóa phòng chưa từng có suất chiếu).
 * @param {string} roomId
 * @param {object} [db]
 */
export const removeSeatsOfRoom = (roomId, db) => deleteSeatsOfRoom(roomId, db);

/**
 * Tổng số ghế (kể cả ghế hỏng) của một phòng.
 * @param {string} roomId
 * @param {object} [db]
 * @returns {Promise<number>}
 */
export const countSeatsOfRoom = async (roomId, db) => (await getSeatsOfRoom(roomId, db)).length;

/**
 * Số ghế DÙNG ĐƯỢC (chưa hỏng) của mỗi phòng.
 * @param {string[]} roomIds
 * @param {object} [db]
 * @returns {Promise<Map<string, number>>} roomId -> số ghế
 */
export async function countActiveSeatsByRoom(roomIds, db = prisma) {
  const rows = await db.seat.groupBy({ by: ['roomId'], where: { roomId: { in: roomIds }, isActive: true }, _count: { _all: true } });
  return new Map(rows.map((c) => [c.roomId, c._count._all]));
}

/**
 * Ghế khách chọn, đã kiểm tra hợp lệ để GIỮ GHẾ: thuộc phòng, không hỏng, ghế đôi đủ cặp (BR-05).
 * @param {{ roomId: string, seatIds: string[] }} params
 * @returns {Promise<object[]>} các dòng Seat
 * @throws {AppError} NOT_FOUND | SEAT_UNAVAILABLE | COUPLE_SEAT_INCOMPLETE
 */
export async function getSeatsForBooking({ roomId, seatIds }) {
  const seats = await findSeatsInRoom({ roomId, seatIds });
  if (seats.length !== seatIds.length) {
    throw new AppError('NOT_FOUND', { message: 'Có ghế không thuộc phòng chiếu của suất này.' });
  }
  const broken = seats.filter((s) => !s.isActive);
  if (broken.length) {
    throw new AppError('SEAT_UNAVAILABLE', {
      details: { seatIds: broken.map((s) => s.id), seatLabels: broken.map((s) => `${s.row}${s.number}`) },
    });
  }
  // BR-05: ghế đôi phải đủ cả cặp (2 ghế cùng pairCode đều có trong lựa chọn)
  const perPair = {};
  for (const s of seats) if (s.type === 'COUPLE') perPair[s.pairCode] = (perPair[s.pairCode] ?? 0) + 1;
  if (Object.values(perPair).some((n) => n !== 2)) throw new AppError('COUPLE_SEAT_INCOMPLETE');
  return seats;
}

/**
 * Gợi ý tối đa `limit` (mặc định 3) phương án ghế LIỀN NHAU, cùng hàng, cùng loại, đang trống.
 * - Ghế đôi (`seatType = 'COUPLE'`): `quantity` phải chẵn; các CẶP đứng liền nhau. Không chọn ghế đôi nếu không yêu cầu.
 * - `preference`: `CENTER` (giữa phòng, hơi lùi về sau — mặc định) · `BACK` (hàng sau) · `AISLE` (sát lối đi, đầu / cuối hàng).
 * - `totalPrice` do server tính bằng ĐÚNG hàm tính giá của đặt vé (BR-11, BR-13) nên khớp tổng tiền đơn sau khi giữ ghế.
 * Chỉ là GỢI Ý: ghế vẫn có thể bị người khác lấy trước khi giữ; `holdSeats` mới là trọng tài.
 * @param {{ showtimeId: string, quantity: number, preference?: 'CENTER'|'BACK'|'AISLE', seatType?: 'STANDARD'|'VIP'|'COUPLE', limit?: number }} params
 * @returns {Promise<Array<{ seatIds: string[], labels: string[], row: string, seatType: string, totalPrice: number }>>} [] nếu không có phương án nào
 * @throws {AppError} NOT_FOUND | SHOWTIME_CLOSED | SEAT_LIMIT_EXCEEDED | VALIDATION_ERROR
 */
export async function suggestSeats({ showtimeId, quantity, preference = 'CENTER', seatType, limit = 3 }) {
  if (!Number.isInteger(quantity) || quantity < 1) throw fieldError('quantity', 'Số ghế phải là số nguyên từ 1.');
  if (quantity > 8) throw new AppError('SEAT_LIMIT_EXCEEDED'); // BR-02
  if (!['CENTER', 'BACK', 'AISLE'].includes(preference)) throw fieldError('preference', 'preference phải là CENTER, BACK hoặc AISLE.');
  if (seatType && !['STANDARD', 'VIP', 'COUPLE'].includes(seatType)) throw fieldError('seatType', 'Loại ghế không hợp lệ.');
  const wantCouple = seatType === 'COUPLE';
  if (wantCouple && quantity % 2 !== 0) throw fieldError('quantity', 'Ghế đôi phải chọn theo cặp (số ghế chẵn).'); // BR-05

  const { map, basePrice } = await loadSeatMap({ showtimeId });
  if (!map.showtime.isOpenForSale) throw new AppError('SHOWTIME_CLOSED'); // BR-04

  // Mỗi "đơn vị" là một ghế lẻ, hoặc một CẶP ghế đôi (hai ghế cùng pairCode liền nhau, đều trống).
  const rowsOf = new Map();
  for (const s of map.seats) {
    if (s.status !== 'AVAILABLE') continue;
    if (wantCouple ? s.type !== 'COUPLE' : s.type === 'COUPLE' || (seatType && s.type !== seatType)) continue;
    if (!rowsOf.has(s.row)) rowsOf.set(s.row, []);
    rowsOf.get(s.row).push(s);
  }
  const units = (seats) => {
    const sorted = [...seats].sort((a, b) => a.number - b.number);
    if (!wantCouple) return sorted.map((s) => ({ seats: [s], number: s.number, type: s.type }));
    const pairs = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].pairCode && sorted[i].pairCode === sorted[i + 1].pairCode && sorted[i + 1].number === sorted[i].number + 1) {
        pairs.push({ seats: [sorted[i], sorted[i + 1]], number: sorted[i].number, type: 'COUPLE' });
        i++;
      }
    }
    return pairs;
  };

  const allRows = map.rows;
  const maxNumber = Math.max(...map.seats.map((s) => s.number));
  const need = wantCouple ? quantity / 2 : quantity;
  const candidates = [];
  for (const row of allRows) {
    const list = units(rowsOf.get(row) ?? []);
    for (let i = 0; i + need <= list.length; i++) {
      const window = list.slice(i, i + need);
      const contiguous = window.every((u, k) => k === 0 || u.number === window[k - 1].number + (wantCouple ? 2 : 1));
      const sameType = window.every((u) => u.type === window[0].type);
      if (!contiguous || !sameType) continue;
      const seats = window.flatMap((u) => u.seats);
      const first = seats[0].number; const last = seats[seats.length - 1].number;
      const rowIndex = allRows.indexOf(row);
      const colDist = Math.abs((first + last) / 2 - (maxNumber + 1) / 2);
      const idealRow = 0.6 * (allRows.length - 1);
      const score = preference === 'BACK' ? (allRows.length - 1 - rowIndex) * 3 + colDist
        : preference === 'AISLE' ? (first === 1 || last === maxNumber ? 0 : 1 + Math.min(first - 1, maxNumber - last)) * 3 + Math.abs(rowIndex - idealRow)
          : colDist + 1.5 * Math.abs(rowIndex - idealRow);
      candidates.push({ row, seats, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.row.localeCompare(b.row));

  // Ưu tiên các hàng KHÁC NHAU để khách có lựa chọn thật sự; còn thiếu thì lấy thêm phương án cùng hàng.
  const picked = [];
  const usedRows = new Set();
  const max = Math.min(Math.max(1, limit), 10); // trần 10 phương án để không tràn ngữ cảnh của LLM
  for (const c of candidates) if (!usedRows.has(c.row) && picked.length < max) { picked.push(c); usedRows.add(c.row); }
  for (const c of candidates) if (picked.length < max && !picked.includes(c)) picked.push(c);

  return Promise.all(picked.map(async (c) => ({
    seatIds: c.seats.map((s) => s.id),
    labels: c.seats.map((s) => s.label),
    row: c.row,
    seatType: c.seats[0].type,
    totalPrice: (await priceSeats({ basePrice, seats: c.seats.map((s) => ({ id: s.id, type: s.type, pairCode: s.pairCode })) })).total,
  })));
}

/**
 * Xem trước một yêu cầu giữ ghế (KHÔNG ghi gì vào database): ghế nào, giá bao nhiêu, suất nào — đọc từ DB.
 * Trợ lý AI dùng để dựng phần tóm tắt trong hộp xác nhận bằng dữ liệu THẬT, và để báo lỗi sớm
 * (ghế đã bị lấy, quá 8 ghế, ghế đôi lẻ, suất đóng bán) thay vì mời khách xác nhận một việc chắc chắn thất bại.
 * Chỉ là xem trước: `holdSeats` vẫn kiểm tra lại và là trọng tài khi giữ thật.
 * @param {{ showtimeId: string, seatIds: string[] }} params
 * @returns {Promise<{ showtime: { id: string, movieTitle: string, cinemaName: string, roomName: string, startTime: Date,
 *   startTimeLocal: string, dateLocal: string, format: string, audio: string }, seats: Array<{ id: string, label: string, type: string }>,
 *   totalPrice: number }>}
 * @throws {AppError} NOT_FOUND | SHOWTIME_CLOSED | SEAT_LIMIT_EXCEEDED | SEAT_UNAVAILABLE | COUPLE_SEAT_INCOMPLETE | VALIDATION_ERROR
 */
export async function previewHold({ showtimeId, seatIds }) {
  if (!Array.isArray(seatIds) || seatIds.length === 0) throw fieldError('seatIds', 'Cần ít nhất một ghế.');
  if (new Set(seatIds).size !== seatIds.length) throw fieldError('seatIds', 'Có ghế bị chọn trùng.');
  if (seatIds.length > 8) throw new AppError('SEAT_LIMIT_EXCEEDED'); // BR-02

  const { map, basePrice } = await loadSeatMap({ showtimeId });
  if (!map.showtime.isOpenForSale) throw new AppError('SHOWTIME_CLOSED'); // BR-04
  const byId = new Map(map.seats.map((s) => [s.id, s]));
  if (seatIds.some((id) => !byId.has(id))) throw new AppError('NOT_FOUND', { message: 'Có ghế không thuộc phòng chiếu của suất này.' });
  const chosen = seatIds.map((id) => byId.get(id));

  const taken = chosen.filter((s) => s.status !== 'AVAILABLE');
  if (taken.length) {
    throw new AppError('SEAT_UNAVAILABLE', {
      message: `Ghế ${taken.map((s) => s.label).join(', ')} không còn trống, vui lòng chọn ghế khác.`,
      details: { seatIds: taken.map((s) => s.id), seatLabels: taken.map((s) => s.label) },
    });
  }
  const perPair = {};
  for (const s of chosen) if (s.type === 'COUPLE') perPair[s.pairCode] = (perPair[s.pairCode] ?? 0) + 1;
  if (Object.values(perPair).some((n) => n !== 2)) throw new AppError('COUPLE_SEAT_INCOMPLETE'); // BR-05

  const local = toVnClock(map.showtime.startTime).toISOString();
  const d = map.showtime;
  return {
    showtime: {
      id: d.id, movieTitle: d.movie.title, cinemaName: d.cinema.name, roomName: d.room.name, startTime: d.startTime,
      startTimeLocal: local.slice(11, 16), dateLocal: local.slice(0, 10), format: d.format, audio: d.audio,
    },
    seats: chosen.map((s) => ({ id: s.id, label: s.label, type: s.type })),
    totalPrice: (await priceSeats({ basePrice, seats: chosen.map((s) => ({ id: s.id, type: s.type, pairCode: s.pairCode })) })).total,
  };
}

// =============================================================================================
// TRUY VẤN NỘI BỘ (@internal) — bảng Seat. Mỗi hàm MỘT thao tác đọc / ghi; chỉ file này gọi chúng (docs/04 v1.26).
// Tham số cuối `db = prisma`: truyền `tx` khi chạy trong transaction. Lỗi CSDL (vd P2002) đi xuyên ra cho hàm nghiệp vụ xử lý.
// =============================================================================================

/**
 * Toàn bộ ghế của một phòng, theo hàng rồi số.
 * @internal
 */
export const getSeatsOfRoom = (roomId, db = prisma) => db.seat.findMany({ where: { roomId }, orderBy: [{ row: 'asc' }, { number: 'asc' }] });

/**
 * Các ghế (trong danh sách id) THUỘC phòng đã cho; ghế không thuộc phòng thì không có trong kết quả.
 * @internal
 */
export const findSeatsInRoom = ({ roomId, seatIds }, db = prisma) => db.seat.findMany({ where: { id: { in: seatIds }, roomId } });

/** Thêm nhiều ghế trong một câu lệnh. @internal */
export const insertSeats = (rows, db = prisma) => db.seat.createMany({ data: rows });

/** Xóa mọi ghế của một phòng. @internal */
export const deleteSeatsOfRoom = (roomId, db = prisma) => db.seat.deleteMany({ where: { roomId } });
