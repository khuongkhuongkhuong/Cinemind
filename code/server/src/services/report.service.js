import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { toVnClock } from '../lib/time.js';
import { vnDayRange } from './showtime.service.js';

const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 3600_000;

/** Date -> "YYYY-MM-DD" theo giờ Việt Nam (ngày kinh doanh tính theo giờ địa phương, không phải UTC). */
const vnDateKey = (date) => toVnClock(date).toISOString().slice(0, 10);

/** Liệt kê mọi ngày "YYYY-MM-DD" từ `from` đến `to` (gồm cả hai đầu). */
function eachDay(from, to) {
  const days = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/**
 * Báo cáo doanh thu (FR-37). CHỈ tính đơn PAID — đơn hoàn tiền / hủy / hết hạn / đang chờ không tính.
 * - `revenue`: tổng tiền khách thực trả (sau giảm giá). `ticketCount`: số ghế (ghế đôi tính 2). `orderCount`: số đơn.
 * - Ngày tính theo `paidAt` (lúc thu tiền), giờ Việt Nam.
 * - `groupBy = day` điền cả những ngày không có doanh thu (revenue = 0) để vẽ biểu đồ liên tục; `movie` / `cinema`
 *   chỉ liệt kê nhóm có doanh thu, xếp theo doanh thu giảm dần.
 * Gộp trong bộ nhớ (không SQL thô) cho dễ đọc và đủ nhanh với quy mô đồ án; dữ liệu lớn thì chuyển sang GROUP BY ở DB.
 *
 * @param {{ from: string, to: string, groupBy: 'day'|'movie'|'cinema' }} params from/to: YYYY-MM-DD (giờ VN), gồm cả ngày `to`
 * @returns {Promise<Array<{ key: string, label: string, revenue: number, ticketCount: number, orderCount: number }>>}
 * @throws {AppError} VALIDATION_ERROR (from > to, hoặc khoảng quá 366 ngày)
 */
export async function getRevenueReport({ from, to, groupBy }) {
  const days = eachDay(from, to);
  if (days.length === 0) throw new AppError('VALIDATION_ERROR', { details: { fields: { from: '`from` phải trước hoặc bằng `to`.' } } });
  if (days.length > MAX_RANGE_DAYS) throw new AppError('VALIDATION_ERROR', { details: { fields: { to: `Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày.` } } });

  const orders = await prisma.order.findMany({
    where: { status: 'PAID', paidAt: { gte: vnDayRange(from).from, lt: vnDayRange(to).to } },
    select: {
      total: true, paidAt: true, _count: { select: { seats: true } },
      showtime: { select: { movie: { select: { id: true, title: true } }, room: { select: { cinema: { select: { id: true, name: true } } } } } },
    },
  });

  const groups = new Map();
  const add = (key, label, o) => {
    const g = groups.get(key) ?? { key, label, revenue: 0, ticketCount: 0, orderCount: 0 };
    g.revenue += o.total;
    g.ticketCount += o._count.seats;
    g.orderCount += 1;
    groups.set(key, g);
  };
  for (const o of orders) {
    if (groupBy === 'day') add(vnDateKey(o.paidAt), vnDateKey(o.paidAt), o);
    else if (groupBy === 'movie') add(o.showtime.movie.id, o.showtime.movie.title, o);
    else add(o.showtime.room.cinema.id, o.showtime.room.cinema.name, o);
  }

  if (groupBy === 'day') {
    return days.map((d) => groups.get(d) ?? { key: d, label: d, revenue: 0, ticketCount: 0, orderCount: 0 });
  }
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label));
}
