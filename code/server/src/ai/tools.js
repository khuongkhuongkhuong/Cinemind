import { z } from 'zod';
import * as catalog from '../services/catalog.service.js';
import * as showtimes from '../services/showtime.service.js';
import * as booking from '../services/booking.service.js';
import * as payment from '../services/payment.service.js';
import { toVnClock } from '../lib/time.js';
import { AppError } from '../utils/AppError.js';

/**
 * Khai báo các tool của trợ lý (docs/07 mục 2) — NƠI DUY NHẤT ánh xạ tool -> service.
 *
 * Hai loại:
 *  - `read`:  chạy tự do trong vòng lặp Agent, kết quả đưa lại cho LLM như DỮ LIỆU.
 *  - `write`: KHÔNG BAO GIỜ chạy trong vòng lặp. Agent chỉ gọi `preview` (đọc DB, dựng tóm tắt bằng dữ liệu thật và
 *             báo lỗi sớm); thao tác thật `execute` chỉ chạy khi chính người dùng bấm xác nhận (docs/07 mục 8).
 *
 * `userId` luôn do server truyền vào (lấy từ phiên đăng nhập). Schema đều `.strict()`: LLM không thể nhét thêm
 * trường lạ như `userId`; có nhét thì bị từ chối (VALIDATION_ERROR).
 */

const vnd = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;
const hhmm = (d) => toVnClock(new Date(d)).toISOString().slice(11, 16);
const uuid = (label) => z.uuid().describe(label);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD').describe('Ngày chiếu, định dạng YYYY-MM-DD (giờ Việt Nam)');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:mm');
const orderIdField = uuid('orderId của đơn đang giữ');

/** Đơn của CHÍNH người dùng (service tự kiểm quyền: người khác -> FORBIDDEN) và còn ở trạng thái chờ thanh toán. */
async function pendingOrderOf(userId, orderId) {
  const order = await booking.getOrder({ userId, orderId });
  if (order.status !== 'PENDING') throw new AppError('ORDER_NOT_PENDING');
  return order;
}
const seatLabels = (order) => order.seats.map((s) => s.label).join(', ');

export const TOOLS = [
  // ============================================================ ĐỌC ============================================================
  {
    name: 'search_movies', kind: 'read',
    description: 'Tìm phim theo tên (không cần gõ dấu), trạng thái hoặc tên thể loại. Dùng khi khách hỏi về phim hoặc muốn xem có phim gì.',
    schema: z.object({
      query: z.string().max(100).optional().describe('Một phần tên phim'),
      status: z.enum(['NOW_SHOWING', 'COMING_SOON']).optional().describe('NOW_SHOWING = đang chiếu, COMING_SOON = sắp chiếu'),
      genre: z.string().max(50).optional().describe('Tên thể loại, ví dụ "Hành động"'),
    }).strict(),
    run: ({ input }) => catalog.searchMovies({ ...input, limit: 8 }),
  },
  {
    name: 'get_movie_details', kind: 'read',
    description: 'Xem chi tiết một phim: mô tả, đạo diễn, diễn viên, thời lượng, phân loại độ tuổi.',
    schema: z.object({ movieId: uuid('id của phim') }).strict(),
    run: async ({ input }) => {
      const m = await catalog.getMovieById(input);
      return {
        id: m.id, title: m.title, description: String(m.description ?? '').slice(0, 600), director: m.director, actors: m.actors,
        language: m.language, durationMin: m.durationMin, ageRating: m.ageRating, status: m.status, releaseDate: m.releaseDate,
        genres: m.genres.map((g) => g.name),
      };
    },
  },
  {
    name: 'list_cinemas', kind: 'read',
    description: 'Liệt kê các rạp, có thể lọc theo tên thành phố (không cần gõ dấu).',
    schema: z.object({ city: z.string().max(50).optional().describe('Tên thành phố, ví dụ "Hà Nội"') }).strict(),
    run: async ({ input }) => {
      if (input.city) return catalog.listCinemasByCityName({ cityName: input.city });
      const [cinemas, cities] = await Promise.all([catalog.listCinemas({}), catalog.listCities()]);
      const cityOf = new Map(cities.map((c) => [c.id, c.name]));
      return cinemas.map((c) => ({ ...c, cityName: cityOf.get(c.cityId) }));
    },
  },
  {
    name: 'find_showtimes', kind: 'read',
    description: 'Tìm suất chiếu còn mở bán trong một ngày, kèm số ghế còn trống. Lọc được theo phim, thành phố hoặc rạp, khung giờ, định dạng. Giờ là giờ Việt Nam.',
    schema: z.object({
      date,
      movieId: uuid('id của phim').optional(),
      city: z.string().max(50).optional().describe('Tên thành phố'),
      cinemaId: uuid('id của rạp').optional(),
      timeFrom: time.optional().describe('Từ giờ (HH:mm)'),
      timeTo: time.optional().describe('Đến giờ (HH:mm)'),
      format: z.enum(['F2D', 'F3D', 'IMAX']).optional(),
    }).strict(),
    run: ({ input }) => {
      const { city, ...rest } = input;
      return showtimes.findShowtimes({ ...rest, cityName: city, limit: 15 });
    },
  },
  {
    name: 'get_seat_map', kind: 'read',
    description: 'Xem tóm tắt ghế của một suất: còn bao nhiêu ghế mỗi loại, giá từng loại, danh sách ghế trống theo hàng. Để gợi ý chỗ ngồi hãy ưu tiên suggest_seats.',
    schema: z.object({ showtimeId: uuid('id của suất chiếu') }).strict(),
    run: async ({ input }) => {
      const map = await showtimes.getSeatMap(input);
      const free = map.seats.filter((s) => s.status === 'AVAILABLE');
      const byType = {}; const price = {}; const byRow = {};
      for (const s of map.seats) price[s.type] ??= s.price;
      for (const s of free) {
        byType[s.type] = (byType[s.type] ?? 0) + 1;
        (byRow[s.row] ??= []).push(s.label);
      }
      return {
        showtimeId: map.showtime.id, isOpenForSale: map.showtime.isOpenForSale, movie: map.showtime.movie.title,
        cinema: map.showtime.cinema.name, room: map.showtime.room.name, availableCount: free.length,
        availableByType: byType, priceByType: price, note: 'priceByType: ghế đôi là giá CẢ CẶP', availableSeatsByRow: byRow,
      };
    },
  },
  {
    name: 'suggest_seats', kind: 'read',
    description: 'Gợi ý tối đa 3 phương án ghế LIỀN NHAU, cùng hàng, cùng loại (kèm tổng tiền do hệ thống tính). Dùng khi khách nói số người và sở thích chỗ ngồi.',
    schema: z.object({
      showtimeId: uuid('id của suất chiếu'),
      quantity: z.number().int().min(1).max(8).describe('Số ghế (ghế đôi phải chẵn)'),
      preference: z.enum(['CENTER', 'BACK', 'AISLE']).optional().describe('CENTER = giữa phòng, BACK = hàng sau, AISLE = sát lối đi'),
      seatType: z.enum(['STANDARD', 'VIP', 'COUPLE']).optional().describe('Chỉ đặt khi khách muốn loại ghế cụ thể'),
    }).strict(),
    run: ({ input }) => showtimes.suggestSeats(input),
  },
  {
    name: 'list_combos', kind: 'read',
    description: 'Liệt kê combo bắp nước đang bán và giá.',
    schema: z.object({}).strict(),
    run: async () => (await catalog.listCombos()).map(({ id, name, description, price }) => ({ id, name, description, price })),
  },
  {
    name: 'get_order', kind: 'read',
    description: 'Xem một đơn hàng của chính khách (trạng thái, ghế, combo, tổng tiền, hạn giữ ghế).',
    schema: z.object({ orderId: orderIdField }).strict(),
    run: async ({ userId, input }) => {
      const o = await booking.getOrder({ userId, orderId: input.orderId });
      return {
        id: o.id, code: o.code, status: o.status, expiresAt: o.expiresAt, total: o.total, discount: o.discount,
        movie: o.showtime.movie.title, cinema: o.showtime.cinema.name, startTime: o.showtime.startTime,
        seats: o.seats.map((s) => s.label), combos: o.combos.map((c) => `${c.name} ×${c.quantity}`),
      };
    },
  },
  {
    name: 'list_my_tickets', kind: 'read',
    description: 'Liệt kê các đơn / vé của chính khách (mặc định các vé đã thanh toán), mới nhất trước.',
    schema: z.object({ status: z.enum(['PAID', 'PENDING', 'CANCELLED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED']).optional() }).strict(),
    run: async ({ userId, input }) => {
      const { items } = await booking.listMyOrders({ userId, ...input, page: 1, pageSize: 10 });
      return items;
    },
  },

  // ============================================================ GHI (chỉ chạy khi khách xác nhận) ============================================================
  {
    name: 'hold_seats', kind: 'write',
    description: 'Đề xuất GIỮ GHẾ (10 phút) cho khách. Dùng ids lấy từ suggest_seats hoặc get_seat_map. Khách sẽ phải bấm xác nhận.',
    schema: z.object({ showtimeId: uuid('id của suất chiếu'), seatIds: z.array(uuid('id ghế')).min(1).max(8) }).strict(),
    preview: async ({ input }) => {
      const p = await showtimes.previewHold(input);
      const s = p.showtime;
      return {
        summary: `Giữ ghế ${p.seats.map((x) => x.label).join(', ')} — ${s.movieTitle}, ${s.cinemaName}, ${s.roomName}, ${s.startTimeLocal} ngày ${s.dateLocal.split('-').reverse().join('/')}. Tổng: ${vnd(p.totalPrice)}. Ghế được giữ 10 phút.`,
      };
    },
    execute: async ({ userId, input }) => {
      const order = await booking.holdSeats({ userId, ...input, source: 'AI_CHAT' });
      return {
        order, orderId: order.id,
        text: `Đã giữ ghế ${seatLabels(order)} — ${order.showtime.movie.title} lúc ${hhmm(order.showtime.startTime)}. Tổng ${vnd(order.total)}. Ghế được giữ đến ${hhmm(order.expiresAt)}. Bạn muốn thêm combo, nhập mã giảm giá hay tạo link thanh toán?`,
      };
    },
  },
  {
    name: 'set_combos', kind: 'write',
    description: 'Đề xuất CHỌN COMBO bắp nước cho đơn đang giữ (thay cả danh sách; mảng rỗng = bỏ hết). Khách sẽ phải bấm xác nhận.',
    schema: z.object({
      orderId: orderIdField,
      items: z.array(z.object({ comboId: uuid('id combo'), quantity: z.number().int().min(1).max(10) }).strict()).max(8),
    }).strict(),
    preview: async ({ userId, input }) => {
      const order = await pendingOrderOf(userId, input.orderId);
      if (input.items.length === 0) return { summary: `Bỏ hết combo khỏi đơn ${order.code}.` };
      const combos = new Map((await catalog.listCombos()).map((c) => [c.id, c]));
      const missing = input.items.filter((i) => !combos.has(i.comboId));
      if (missing.length) {
        throw new AppError('VALIDATION_ERROR', { message: 'Có combo không tồn tại hoặc đã ngừng bán.', details: { fields: { items: 'Combo không hợp lệ.' } } });
      }
      const lines = input.items.map((i) => `${combos.get(i.comboId).name} ×${i.quantity}`);
      const total = input.items.reduce((sum, i) => sum + combos.get(i.comboId).price * i.quantity, 0);
      return { summary: `Chọn combo cho đơn ${order.code}: ${lines.join(', ')}. Tiền combo: ${vnd(total)}.` };
    },
    execute: async ({ userId, input }) => {
      const order = await booking.setCombos({ userId, ...input });
      return { order, orderId: order.id, text: `Đã cập nhật combo. Tổng đơn hiện tại: ${vnd(order.total)}.` };
    },
  },
  {
    name: 'apply_promotion', kind: 'write',
    description: 'Đề xuất ÁP MÃ KHUYẾN MÃI cho đơn đang giữ. Khách sẽ phải bấm xác nhận.',
    schema: z.object({ orderId: orderIdField, code: z.string().trim().min(3).max(30) }).strict(),
    preview: async ({ userId, input }) => {
      const order = await pendingOrderOf(userId, input.orderId);
      return { summary: `Áp mã ${input.code.toUpperCase()} cho đơn ${order.code} (hiện ${vnd(order.total)}).` };
    },
    execute: async ({ userId, input }) => {
      const order = await booking.applyPromotion({ userId, ...input });
      return { order, orderId: order.id, text: `Đã áp mã ${input.code.toUpperCase()}: giảm ${vnd(order.discount)}. Tổng đơn: ${vnd(order.total)}.` };
    },
  },
  {
    name: 'create_payment_link', kind: 'write',
    description: 'Đề xuất TẠO LINK THANH TOÁN VNPay cho đơn đang giữ. Khách sẽ phải bấm xác nhận, rồi tự bấm link để thanh toán.',
    schema: z.object({ orderId: orderIdField }).strict(),
    preview: async ({ userId, input }) => {
      const order = await pendingOrderOf(userId, input.orderId);
      return { summary: `Tạo link thanh toán ${vnd(order.total)} cho đơn ${order.code} (ghế ${seatLabels(order)}). Bạn sẽ tự bấm link để thanh toán trên VNPay trước khi hết thời gian giữ ghế.` };
    },
    execute: async ({ userId, input }) => {
      const pay = await payment.createPayment({ userId, orderId: input.orderId });
      return {
        orderId: input.orderId, paymentUrl: pay.paymentUrl,
        text: `Link thanh toán đã sẵn sàng. Hãy bấm vào link để thanh toán trước ${hhmm(pay.expiresAt)}. Vé sẽ có trong "Vé của tôi" sau khi thanh toán thành công.`,
      };
    },
  },
  {
    name: 'cancel_order', kind: 'write',
    description: 'Đề xuất HỦY đơn đang giữ (chưa thanh toán) và nhả ghế. Khách sẽ phải bấm xác nhận.',
    schema: z.object({ orderId: orderIdField }).strict(),
    preview: async ({ userId, input }) => {
      const order = await pendingOrderOf(userId, input.orderId);
      return { summary: `Hủy đơn ${order.code} (ghế ${seatLabels(order)}, ${vnd(order.total)}). Ghế sẽ được nhả ngay.` };
    },
    execute: async ({ userId, input }) => {
      const order = await booking.cancelOrder({ userId, orderId: input.orderId });
      return { order, orderId: order.id, text: 'Đã hủy đơn và nhả ghế.' };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** @param {string} name @returns {object|undefined} */
export const getTool = (name) => BY_NAME.get(name);

/** JSON Schema gọn (bỏ `$schema` và biểu thức chính quy dài của uuid) để đưa cho LLM. */
function toInputSchema(schema) {
  const json = z.toJSONSchema(schema);
  delete json.$schema;
  const clean = (node) => {
    if (Array.isArray(node)) return node.forEach(clean);
    if (node && typeof node === 'object') {
      if (node.format === 'uuid') delete node.pattern;
      Object.values(node).forEach(clean);
    }
  };
  clean(json);
  return json;
}

/** Danh sách tool theo giao diện LLM: [{ name, description, inputSchema }]. */
export const toolSpecs = () => TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: toInputSchema(t.schema) }));
