// NFR-18: kiến trúc phân lớp routes -> controllers -> services -> Prisma, được KIỂM BẰNG TEST thay vì chỉ ghi trong tài liệu.
// Không cần database. Nếu ai đó import Prisma vào controller (hoặc để service đụng req/res), test này đỏ ngay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.js') ? [full] : [];
  });
}
const read = (f) => readFileSync(f, 'utf8');
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

// ------------------------------------------------------------------ Tầng DAO (docs/04 mục 5.2, v1.23) ------------------------------------------------------------------

// Các service ĐÃ chuyển sang DAO. Danh sách này chỉ TĂNG khi chuyển thêm service (không bao giờ bớt đi).
const DAO_SERVICES = ['pricing', 'auth', 'user', 'ticket', 'showtime', 'booking', 'payment', 'chat'];
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
  assert.match(code(join(SRC, 'dao', 'seatLock.dao.js')), /createMany/); // đúng là đang dùng createMany (trọng tài là khóa chính)
});

test('⭐ bất biến giữ ghế: MỌI bước trong transaction giữ ghế (booking.runHoldTransaction) gọi DAO với cùng `tx`', () => {
  const src = code(join(SRC, 'services', 'booking.service.js'));
  const start = src.indexOf('function runHoldTransaction');
  assert.ok(start >= 0, 'không thấy runHoldTransaction');
  const body = src.slice(src.indexOf('runInTransaction(async (tx) => {', start), src.indexOf('}, TX_OPTIONS);', start));
  assert.ok(body.length > 100, 'không cắt được thân transaction');
  const statements = body.split(/\n\s*(?=await |return |const \w+ = await )/).slice(1); // MỌI lệnh gọi DAO, kể cả trong khối if
  assert.ok(statements.length >= 7, `chỉ thấy ${statements.length} lệnh`);
  const missing = statements.filter((st) => !/\btx\b/.test(st)).map((st) => st.split('\n')[0].trim());
  assert.deepEqual(missing, []);
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

test('⭐ bất biến IPN: MỌI bước của markPaid (xác nhận thanh toán) và nhánh "ghế đã mất" dùng cùng `tx`; chỉ markOrderPaid mới đưa đơn sang PAID', () => {
  const src = code(join(SRC, 'services', 'payment.service.js'));
  const start = src.indexOf('async function markPaid(tx');
  assert.ok(start >= 0, 'không thấy markPaid');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  const statements = body.split(/\n\s*(?=await |return |const \w+ = await |if \(.*\) await )/).slice(1);
  assert.ok(statements.length >= 12, `chỉ thấy ${statements.length} lệnh`);
  // trừ các lệnh thuần tính toán / return không gọi DAO
  const missing = statements
    .filter((st) => /\b(claimPaymentSuccess|getOrderWithTickets|deleteLocksOfOrder|setOrderStatus|deleteExpiredHeldLocks|markLockSold|insertSoldLock|markOrderPaid|incrementUsedCount|addPoints)\(/.test(st))
    .filter((st) => !/\btx\b/.test(st))
    .map((st) => st.split('\n')[0].trim());
  assert.deepEqual(missing, []);
  // nhánh "ghế đã mất": transaction thứ hai trong confirmPayment cũng phải dùng tx
  const branch = src.slice(src.indexOf('const marked = await runInTransaction'), src.indexOf('return marked ?'));
  assert.ok(/claimPaymentSuccess\([^;]*\btx\)/.test(branch) && /setOrderStatus\([^;]*\btx\)/.test(branch), 'nhánh REFUND_PENDING phải dùng tx');
  // Chỉ markPaid (trong luồng IPN) được gọi markOrderPaid: không service nào khác được đưa đơn sang PAID
  const others = files(join(SRC, 'services')).filter((f) => !f.endsWith('payment.service.js') && /markOrderPaid/.test(code(f))).map(rel);
  assert.deepEqual(others, []);
  // Không nơi nào ngoài order.dao.js được GHI trạng thái PAID (đọc / lọc theo PAID ở report... thì bình thường).
  const writers = files(SRC).filter((f) => !f.endsWith('order.dao.js') && /data:\s*\{[^}]*status:\s*'PAID'/.test(code(f))).map(rel);
  assert.deepEqual(writers, []);
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
