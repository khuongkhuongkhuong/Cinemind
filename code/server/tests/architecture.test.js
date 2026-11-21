// NFR-18: kiến trúc phân lớp routes -> controllers -> services -> Prisma, được KIỂM BẰNG TEST thay vì chỉ ghi trong tài liệu.
// Không cần database. Nếu ai đó import Prisma vào controller (hoặc để service đụng req/res), test này đỏ ngay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.js') ? [full] : [];
  });
}
const read = (f) => readFileSync(f, 'utf8').split('\r\n').join('\n'); // chuẩn hóa xuống dòng: file có thể là CRLF (Windows)
const rel = (f) => relative(SRC, f).replaceAll('\\', '/');
// Bỏ chú thích để câu chữ trong comment không bị tính là code.
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('đủ các lớp để kiểm tra (đề phòng đường dẫn sai làm test "qua" vì không quét file nào)', () => {
  for (const dir of ['controllers', 'routes', 'services', 'middlewares', 'validators']) {
    assert.ok(files(join(SRC, dir)).length > 0, `không thấy file nào trong ${dir}/`);
  }
});

test('⭐ controllers / routes / validators KHÔNG import Prisma (chỉ services được đụng database)', () => {
  const offenders = ['controllers', 'routes', 'validators']
    .flatMap((d) => files(join(SRC, d)))
    .filter((f) => /config\/prisma|@prisma\/client/.test(code(f)))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('middlewares không import Prisma trực tiếp: cần dữ liệu thì gọi service', () => {
  const offenders = files(join(SRC, 'middlewares')).filter((f) => /config\/prisma|@prisma\/client/.test(code(f))).map(rel);
  assert.deepEqual(offenders, []);
});

test('⭐ services KHÔNG đụng req / res / express (để AI Agent gọi service như tool)', () => {
  const offenders = files(join(SRC, 'services'))
    .filter((f) => /from 'express'|\breq\.|\bres\.|\(req[,)]|\(res[,)]/.test(code(f)))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('controller chỉ gọi service, không chứa truy vấn (không prisma., không $transaction)', () => {
  const offenders = files(join(SRC, 'controllers')).filter((f) => /\bprisma\b|\$transaction/.test(code(f))).map(rel);
  assert.deepEqual(offenders, []);
});

test('⭐ ai/ (kênh trợ lý AI, docs/07 mục 9) KHÔNG import Prisma và không đụng req/res: chỉ gọi services', () => {
  const dir = join(SRC, 'ai');
  if (!existsSync(dir)) return; // thư mục được tạo ở bước 3 của giai đoạn AI; có rồi thì quy tắc tự áp dụng
  const offenders = files(dir)
    .filter((f) => /config\/prisma|@prisma\/client|from 'express'|\breq\.|\bres\./.test(code(f)))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('services có import Prisma là bình thường, nhưng KHÔNG import từ controllers / routes (không phụ thuộc ngược lớp)', () => {
  const offenders = files(join(SRC, 'services')).filter((f) => /from '\.\.\/(controllers|routes)\//.test(code(f))).map(rel);
  assert.deepEqual(offenders, []);
});

// ------------------------------------------------------------------ Tầng DAO (docs/04 mục 5.2, v1.23 / v1.25) ------------------------------------------------------------------

// Các service ĐÃ chuyển sang DAO. Danh sách này chỉ TĂNG khi chuyển thêm service (không bao giờ bớt đi).
const DAO_SERVICES = ['pricing', 'auth', 'user', 'ticket', 'showtime', 'seat', 'order', 'payment', 'chat', 'movie', 'room', 'combo'];
// Service CHƯA chuyển (docs/04 v1.23: admin*, report, catalog… chưa bắt buộc). Thêm service mới => phải chọn: chuyển sang DAO hoặc ghi vào đây.
const LEGACY_SERVICES = ['adminBanner', 'adminCatalog', 'adminCinema', 'adminMovie', 'adminOrder', 'adminPricing', 'adminPromotion', 'adminUser', 'audit', 'catalog', 'promotion', 'report'];

test('mọi service đều được phân loại: đã chuyển DAO hoặc nằm trong danh sách tồn đọng (không có service mới nào lọt qua mà chưa quyết định)', () => {
  const all = files(join(SRC, 'services')).map((f) => basename(f).replace('.service.js', '')).sort();
  assert.deepEqual(all, [...DAO_SERVICES, ...LEGACY_SERVICES].sort());
});

const DIRECT_QUERY = /\b(prisma|tx)\.[a-z]\w*\.(find|create|update|delete|upsert|count|group|aggregate)/;

test('⭐ dao/ chỉ truy vấn: không ném AppError, không đụng req/res, không import service / controller', () => {
  const dir = join(SRC, 'dao');
  assert.ok(files(dir).length > 0, 'không thấy file nào trong dao/');
  const offenders = files(dir)
    .filter((f) => /AppError|from 'express'|\breq\.|\bres\.|from '\.\.\/(services|controllers|routes|ai)\//.test(code(f)))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('⭐ dao/: tham số cuối của mọi hàm xuất ra là `db = prisma` (trừ transaction.js, nơi tx là tham số bắt buộc)', () => {
  const offenders = [];
  for (const f of files(join(SRC, 'dao')).filter((x) => !x.endsWith('transaction.js'))) {
    const src = code(f);
    const exported = [...src.matchAll(/export const (\w+) = (?:async )?\(([^)]*)\)\s*=>/g)];
    assert.ok(exported.length > 0, `${rel(f)}: không đọc được hàm xuất ra`);
    for (const [, name, params] of exported) if (!/db = prisma\s*$/.test(params.trim())) offenders.push(`${rel(f)}: ${name}(${params})`);
  }
  assert.deepEqual(offenders, []);
});

test('⭐ service đã chuyển KHÔNG còn gọi prisma.<bảng> / tx.<bảng> và không import config/prisma (mở transaction qua dao/transaction.js)', () => {
  const offenders = DAO_SERVICES
    .map((n) => join(SRC, 'services', `${n}.service.js`))
    .filter((f) => DIRECT_QUERY.test(code(f)) || /config\/prisma|\$transaction|\$executeRaw/.test(code(f)))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('⭐ bất biến giữ ghế: dao/ không bao giờ dùng `skipDuplicates` (nó lặng lẽ bỏ ghế trùng và gây bán trùng)', () => {
  const offenders = files(join(SRC, 'dao')).filter((f) => /skipDuplicates/.test(code(f))).map(rel);
  assert.deepEqual(offenders, []);
  assert.match(code(join(SRC, 'dao', 'ticket.dao.js')), /createMany/); // đúng là đang dùng createMany (trọng tài là UNIQUE (showtimeId, occupiedSeatId))
});

test('⭐ bất biến giữ ghế: MỌI bước trong transaction giữ ghế (order.runHoldTransaction) gọi DAO / service với cùng `tx`', () => {
  const src = code(join(SRC, 'services', 'order.service.js'));
  const start = src.indexOf('function runHoldTransaction');
  assert.ok(start >= 0, 'không thấy runHoldTransaction');
  const body = src.slice(src.indexOf('runInTransaction(async (tx) => {', start), src.indexOf('}, TX_OPTIONS);', start));
  assert.ok(body.length > 100, 'không cắt được thân transaction');
  const statements = body.split(/\n\s*(?=await |return |const \w+ = await )/).slice(1); // MỌI lệnh gọi DAO / service, kể cả trong khối if
  assert.ok(statements.length >= 6, `chỉ thấy ${statements.length} lệnh`);
  const missing = statements.filter((st) => !/\btx\b/.test(st)).map((st) => st.split('\n')[0].trim());
  assert.deepEqual(missing, []);
  // vé của đơn được chèn bằng ticketService.holdTickets (một createMany, không skipDuplicates) — không có đường chèn vé nào khác
  assert.ok(statements.some((st) => /ticketService\.holdTickets\(/.test(st)), 'phải giữ ghế qua ticketService.holdTickets');
});

test('⭐ ticket.service: mọi lệnh DAO ghi trong holdTickets / sellTicketsOfOrder / releaseTicketsOfOrders truyền `db` (để chạy chung transaction của order.service)', () => {
  const src = code(join(SRC, 'services', 'ticket.service.js'));
  for (const name of ['holdTickets', 'sellTicketsOfOrder', 'releaseTicketsOfOrders', 'hasActiveSales']) {
    const start = src.indexOf(name);
    assert.ok(start >= 0, `không thấy ${name}`);
    const body = src.slice(start, src.indexOf('\n}\n', start) > 0 ? src.indexOf('\n}\n', start) : src.indexOf('\n', start + 200));
    const daoCalls = body.match(/(?:await )?(?:insertTickets|releaseExpiredHeldTickets|markTicketSold|listTicketsOfOrder|releaseHeldTicketsOfOrders|countActiveSalesOfShowtime)\([^;]*\);?/g) ?? [];
    assert.ok(daoCalls.length > 0, `${name}: không thấy lệnh DAO`);
    assert.deepEqual(daoCalls.filter((c) => !/\bdb\)/.test(c)), [], `${name}: có lệnh DAO không truyền db`);
  }
});

test('⭐ chat: mọi bước trong MỖI transaction (ghi tin + cập nhật trạng thái phiên) gọi DAO với cùng `tx`', () => {
  const src = code(join(SRC, 'services', 'chat.service.js'));
  const bodies = [...src.matchAll(/runInTransaction\(async \(tx\) => \{([\s\S]*?)\n  \}\);/g)].map((m) => m[1]);
  assert.equal(bodies.length, 2, 'chat.service phải có đúng 2 transaction (chat và confirm)');
  for (const body of bodies) {
    const statements = body.split(/\n\s*(?=await )/).slice(1);
    assert.equal(statements.length, 2);
    assert.deepEqual(statements.filter((st) => !/\btx\b/.test(st)).map((st) => st.split('\n')[0].trim()), []);
  }
});

test('⭐ bất biến IPN: MỌI bước của order.markPaid và của transaction xác nhận (payment) dùng cùng tx / db; chỉ markOrderPaid mới đưa đơn sang PAID', () => {
  // (1) order.service.markPaid(…, db): mọi lệnh đụng dữ liệu phải truyền db
  const order = code(join(SRC, 'services', 'order.service.js'));
  const start = order.indexOf('export async function markPaid(');
  assert.ok(start >= 0, 'không thấy markPaid');
  const body = order.slice(start, order.indexOf('\n}\n', start));
  const statements = body.split(/\n\s*(?=await |return |const \w+ = await |if \(.*\) await )/).slice(1);
  assert.ok(statements.length >= 7, `chỉ thấy ${statements.length} lệnh`);
  const missing = statements
    .filter((st) => /\b(getOrderById|releaseTicketsOfOrders|setOrderStatus|sellTicketsOfOrder|markOrderPaid|recordUsage|addPoints)\(/.test(st))
    .filter((st) => !/\bdb\b/.test(st))
    .map((st) => st.split('\n')[0].trim());
  assert.deepEqual(missing, []);
  assert.ok(/ticketService\.sellTicketsOfOrder\(/.test(body), 'markPaid phải bán vé qua ticketService.sellTicketsOfOrder');

  // (2) payment.service: transaction xác nhận và nhánh "ghế đã mất" đều dùng tx
  const pay = code(join(SRC, 'services', 'payment.service.js'));
  const cs = pay.indexOf('async function confirmInTransaction(tx');
  assert.ok(cs >= 0, 'không thấy confirmInTransaction');
  const confirmBody = pay.slice(cs, pay.indexOf('\n}\n', cs));
  assert.ok(/claimPaymentSuccess\([^;]*\btx\)/.test(confirmBody) && /orderService\.markPaid\([^;]*\btx\)/.test(confirmBody), 'xác nhận thanh toán phải dùng tx');
  const branch = pay.slice(pay.indexOf('const marked = await runInTransaction'), pay.indexOf('return marked ?'));
  assert.ok(/claimPaymentSuccess\([^;]*\btx\)/.test(branch) && /markRefundPending\([^;]*\btx\)/.test(branch), 'nhánh REFUND_PENDING phải dùng tx');

  // (3) Chỉ order.service gọi markOrderPaid; chỉ payment.service gọi orderService.markPaid
  assert.deepEqual(files(join(SRC, 'services')).filter((f) => !f.endsWith('order.service.js') && /markOrderPaid/.test(code(f))).map(rel), []);
  assert.deepEqual(files(SRC).filter((f) => !f.endsWith('payment.service.js') && !f.endsWith('order.service.js') && /\bmarkPaid\(/.test(code(f))).map(rel), []);
  // Không nơi nào ngoài order.dao.js được GHI trạng thái PAID (đọc / lọc theo PAID ở report... thì bình thường).
  const writers = files(SRC).filter((f) => !f.endsWith('order.dao.js') && /data:\s*\{[^}]*status:\s*'PAID'/.test(code(f))).map(rel);
  assert.deepEqual(writers, []);
});

// ------------------------------------------------------------------ Vé là lớp trung gian Suất chiếu – Ghế (docs/03 v1.3) ------------------------------------------------------------------

test('⭐ không còn dấu vết của SeatLock trong src/ (đã bỏ bảng; trạng thái giữ / bán nằm trên Ticket.status)', () => {
  assert.deepEqual(files(SRC).filter((f) => /seatLock|SeatLock/.test(read(f))).map(rel), []);
});

test('⭐ schema.prisma có UNIQUE (showtimeId, occupiedSeatId) trên Ticket — trọng tài chống trùng ghế — và hai file schema (docs/ và code/) giống hệt', () => {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const ticket = schema.slice(schema.indexOf('model Ticket {'), schema.indexOf('}', schema.indexOf('model Ticket {')));
  assert.match(ticket, /@@unique\(\[showtimeId, occupiedSeatId\]\)/);
  assert.match(ticket, /occupiedSeatId\s+String\?/); // nullable: vé RELEASED để NULL nên không chặn ai
  assert.doesNotMatch(schema, /model SeatLock|enum LockStatus/);
  const docs = new URL('../../../docs/schema.prisma', import.meta.url);
  if (existsSync(docs)) assert.equal(readFileSync(docs, 'utf8').replace(/\r\n/g, '\n'), schema.replace(/\r\n/g, '\n'));
});

test('⭐ occupiedSeatId CHỈ do dao/ticket.dao.js ghi / đọc trong src/ (cột kỹ thuật, luôn cùng câu lệnh với status)', () => {
  assert.deepEqual(files(SRC).filter((f) => !f.endsWith('ticket.dao.js') && /occupiedSeatId/.test(code(f))).map(rel), []);
  assert.match(code(join(SRC, 'dao', 'ticket.dao.js')), /occupiedSeatId/);
});

// Bảng sở hữu (docs/04 mục 5.2, v1.25): mỗi service CHỈ được import DAO của thực thể nó phụ trách; cần thực thể khác thì gọi service của nó.
const OWNERSHIP = {
  showtime: ['showtime'], seat: ['seat'], ticket: ['ticket'], order: ['order', 'orderCombo'], payment: ['payment'],
  pricing: ['priceRule', 'seatTypeSurcharge'], auth: ['refreshToken'], user: ['user'], promotion: ['promotion'],
  movie: ['movie'], room: ['room'], combo: ['combo'], chat: ['chatSession', 'chatMessage'], catalog: ['cinema'],
};

test('⭐ bảng sở hữu: mỗi service chỉ import DAO của thực thể mình phụ trách (service khác -> không import DAO nào)', () => {
  const offenders = [];
  for (const f of files(join(SRC, 'services'))) {
    const name = basename(f).replace('.service.js', '');
    const imported = [...code(f).matchAll(/from '\.\.\/dao\/(\w+)\.dao\.js'/g)].map((m) => m[1]);
    const allowed = OWNERSHIP[name] ?? [];
    for (const dao of imported) if (!allowed.includes(dao)) offenders.push(`${name}.service import ${dao}.dao`);
  }
  assert.deepEqual(offenders, []);
});

test('mỗi DAO được ít nhất một service phụ trách import (không có DAO mồ côi) và không file nào ngoài services/ import DAO (trừ jobs / scripts không có)', () => {
  const imported = new Set(files(join(SRC, 'services')).flatMap((f) => [...code(f).matchAll(/from '\.\.\/dao\/(\w+)\.dao\.js'/g)].map((m) => m[1])));
  const daos = files(join(SRC, 'dao')).map((f) => basename(f).replace('.dao.js', '')).filter((n) => n !== 'transaction.js' && n !== 'transaction');
  assert.deepEqual(daos.filter((n) => !imported.has(n)), []);
});

test('controllers / routes / validators / ai KHÔNG import dao/ (chỉ gọi service)', () => {
  const offenders = ['controllers', 'routes', 'validators', 'ai']
    .map((d) => join(SRC, d))
    .filter((d) => existsSync(d))
    .flatMap(files)
    .filter((f) => /from '\.\.\/(\.\.\/)?dao\//.test(code(f)))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('vòng import showtime.service <-> seat.service (docs/04 v1.25) an toàn: không dùng import của nhau ở mức module (chỉ trong thân hàm)', () => {
  for (const [file, other] of [['showtime', 'seat'], ['seat', 'showtime']]) {
    const lines = code(join(SRC, 'services', `${file}.service.js`)).split('\n');
    // dòng "import * as xService" / "import { ... } from './other.service.js'" chỉ được dùng bên trong function / arrow có thân; top-level không gọi hàm của other
    const topLevelCalls = lines.filter((l) => /^(const|let|var)\s+\w+\s*=\s*(await\s+)?\w*(Service|seat|showtime)\w*\./.test(l) && new RegExp(`${other}`, 'i').test(l));
    assert.deepEqual(topLevelCalls, [], `${file}.service gọi ${other}.service ở mức module`);
  }
});
