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

// ------------------------------------------------------------------ Truy vấn nằm trong service (docs/04 mục 5.2, v1.26) ------------------------------------------------------------------

// Mỗi service phụ trách MỘT thực thể và chỉ truy vấn bảng (model Prisma) của thực thể đó. Tên = tên accessor của Prisma Client (db.<tên>).
const MODELS = {
  showtime: ['showtime'], seat: ['seat'], ticket: ['ticket'], order: ['order', 'orderCombo'], payment: ['payment'],
  pricing: ['priceRule', 'seatTypeSurcharge'], auth: ['refreshToken'], user: ['user'], promotion: ['promotion'],
  movie: ['movie'], room: ['room'], combo: ['combo'], chat: ['chatSession', 'chatMessage'],
};
// Service còn truy vấn NHIỀU bảng bằng prisma trực tiếp (tồn đọng, docs/04 v1.26: admin*, report, audit, catalog). Thêm service mới => phải chọn một trong hai.
const LEGACY_SERVICES = ['adminBanner', 'adminCatalog', 'adminCinema', 'adminMovie', 'adminOrder', 'adminPricing', 'adminPromotion', 'adminUser', 'audit', 'catalog', 'report'];
const serviceName = (f) => basename(f).replace('.service.js', '');
const serviceFiles = () => files(join(SRC, 'services'));

test('⭐ không còn thư mục src/dao/ (tầng DAO đã bỏ, truy vấn nằm trong service cùng thực thể)', () => {
  assert.equal(existsSync(join(SRC, 'dao')), false);
  assert.deepEqual(files(SRC).filter((f) => /\/dao\/|\.dao\.js/.test(read(f)) && !f.endsWith('architecture.test.js')).map(rel), []);
});

test('mọi service đều được phân loại: có bảng sở hữu (MODELS) hoặc nằm trong danh sách tồn đọng (không có service mới nào lọt qua mà chưa quyết định)', () => {
  const all = serviceFiles().map(serviceName).sort();
  assert.deepEqual(all, [...Object.keys(MODELS), ...LEGACY_SERVICES].sort());
});

test('⭐ service chỉ truy vấn bảng của thực thể mình (cần thực thể khác thì gọi hàm public của service đó) và không gọi prisma.$transaction (dùng runInTransaction)', () => {
  const offenders = [];
  for (const f of serviceFiles()) {
    const name = serviceName(f);
    if (!MODELS[name]) continue;
    const src = code(f);
    for (const m of src.matchAll(/\b(?:prisma|db|tx)\.(\w+)\.(?:find\w*|create\w*|update\w*|delete\w*|upsert|count|groupBy|aggregate)\b/g)) {
      if (!MODELS[name].includes(m[1])) offenders.push(name + '.service truy vấn bảng ' + m[1]);
    }
    if (/\$transaction/.test(src)) offenders.push(name + '.service gọi $transaction trực tiếp');
  }
  assert.deepEqual([...new Set(offenders)], []);
});

/** Các hàm có JSDoc @internal của một file service: [{ name, params }]. */
function internalFunctions(file) {
  const src = read(file);
  const out = [];
  for (const m of src.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)@internal((?:(?!\*\/)[\s\S])*?)\*\/\s*\nexport\s+(?:async\s+function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:async\s+)?\()/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0; let close = open;
    for (let i = open; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) { close = i; break; } }
    out.push({ name: m[3] || m[4], params: src.slice(open + 1, close).trim() });
  }
  return out;
}

test('⭐ có hàm @internal trong các service (đề phòng regex quét sai làm test "qua" vì không thấy hàm nào)', () => {
  const total = serviceFiles().flatMap((f) => internalFunctions(f));
  assert.ok(total.length >= 40, 'chỉ thấy ' + total.length + ' hàm @internal');
  for (const n of ['insertTickets', 'releaseExpiredHeldTickets', 'insertOrder', 'claimPaymentSuccess', 'claimPendingAction', 'lockRoom']) {
    assert.ok(total.some((f) => f.name === n), 'không thấy hàm @internal ' + n);
  }
});

test('⭐ hàm @internal chỉ được gọi trong file khai báo: không file nào khác trong src/ import chúng (cần dữ liệu thì gọi hàm public của service phụ trách)', () => {
  const offenders = [];
  for (const declaring of serviceFiles()) {
    const internal = internalFunctions(declaring).map((f) => f.name);
    if (internal.length === 0) continue;
    const base = basename(declaring);
    for (const f of files(SRC)) {
      if (f === declaring) continue;
      const src = code(f);
      for (const m of src.matchAll(new RegExp("import\\s*\\{([^}]*)\\}\\s*from\\s*'[^']*/" + base.replace('.', '\\.') + "'", 'g'))) {
        for (const item of m[1].split(',')) {
          const name = item.trim().split(/\s+as\s+/)[0];
          if (internal.includes(name)) offenders.push(rel(f) + ' import ' + name + ' từ ' + base);
        }
      }
      for (const m of src.matchAll(new RegExp("import\\s*\\*\\s*as\\s+(\\w+)\\s+from\\s*'[^']*/" + base.replace('.', '\\.') + "'", 'g'))) {
        for (const name of internal) if (new RegExp('\\b' + m[1] + '\\.' + name + '\\b').test(src)) offenders.push(rel(f) + ' dùng ' + m[1] + '.' + name);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('⭐ mọi hàm @internal có tham số cuối db = prisma (truyền tx khi trong transaction), trừ lockRoom(tx, roomId) vì tx là bắt buộc', () => {
  const offenders = [];
  for (const f of serviceFiles()) {
    for (const fn of internalFunctions(f)) {
      if (fn.name === 'lockRoom') { assert.equal(fn.params, 'tx, roomId'); continue; }
      if (!/db = prisma\s*$/.test(fn.params)) offenders.push(serviceName(f) + '.' + fn.name + '(' + fn.params + ')');
    }
  }
  assert.deepEqual(offenders, []);
});

test('⭐ bất biến giữ ghế: không dùng skipDuplicates khi chèn vé (nó lặng lẽ bỏ ghế trùng và gây bán trùng); vé chỉ được chèn bằng MỘT createMany trong ticket.service', () => {
  assert.deepEqual(serviceFiles().filter((f) => /skipDuplicates/.test(code(f)) && /ticket\.createMany/.test(code(f))).map(rel), []);
  assert.doesNotMatch(code(join(SRC, 'services', 'ticket.service.js')), /skipDuplicates/);
  assert.match(code(join(SRC, 'services', 'ticket.service.js')), /ticket\.createMany/); // đúng là đang dùng createMany (trọng tài là UNIQUE (showtimeId, occupiedSeatId))
  assert.deepEqual(files(SRC).filter((f) => !f.endsWith('ticket.service.js') && /ticket\.(createMany|create)\b/.test(code(f))).map(rel), []); // không nơi nào khác chèn vé
});

test('⭐ bất biến giữ ghế: MỌI bước trong transaction giữ ghế (order.runHoldTransaction) gọi hàm truy vấn / service với cùng `tx`', () => {
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

test('⭐ ticket.service: mọi lệnh truy vấn ghi trong holdTickets / sellTicketsOfOrder / releaseTicketsOfOrders truyền `db` (để chạy chung transaction của order.service)', () => {
  const src = code(join(SRC, 'services', 'ticket.service.js'));
  for (const name of ['holdTickets', 'sellTicketsOfOrder', 'releaseTicketsOfOrders', 'hasActiveSales']) {
    const start = src.indexOf(name);
    assert.ok(start >= 0, `không thấy ${name}`);
    const body = src.slice(start, src.indexOf('\n}\n', start) > 0 ? src.indexOf('\n}\n', start) : src.indexOf('\n', start + 200));
    const daoCalls = body.match(/(?:await )?(?:insertTickets|releaseExpiredHeldTickets|markTicketSold|listTicketsOfOrder|releaseHeldTicketsOfOrders|countActiveSalesOfShowtime)\([^;]*\);?/g) ?? [];
    assert.ok(daoCalls.length > 0, `${name}: không thấy lệnh truy vấn`);
    assert.deepEqual(daoCalls.filter((c) => !/\bdb\)/.test(c)), [], `${name}: có lệnh truy vấn không truyền db`);
  }
});

test('⭐ chat: mọi bước trong MỖI transaction (ghi tin + cập nhật trạng thái phiên) gọi hàm truy vấn với cùng `tx`', () => {
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
  // Không nơi nào ngoài order.service.js được GHI trạng thái PAID (đọc / lọc theo PAID ở report... thì bình thường).
  const writers = files(SRC).filter((f) => !f.endsWith('order.service.js') && /data:\s*\{[^}]*status:\s*'PAID'/.test(code(f))).map(rel);
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

test('⭐ occupiedSeatId CHỈ do ticket.service.js ghi / đọc trong src/ (cột kỹ thuật, luôn cùng câu lệnh với status)', () => {
  assert.deepEqual(files(SRC).filter((f) => !f.endsWith('ticket.service.js') && /occupiedSeatId/.test(code(f))).map(rel), []);
  assert.match(code(join(SRC, 'services', 'ticket.service.js')), /occupiedSeatId/);
});

test('vòng import showtime.service <-> seat.service (docs/04 v1.25) an toàn: không dùng import của nhau ở mức module (chỉ trong thân hàm)', () => {
  for (const [file, other] of [['showtime', 'seat'], ['seat', 'showtime']]) {
    const lines = code(join(SRC, 'services', `${file}.service.js`)).split('\n');
    // dòng "import * as xService" / "import { ... } from './other.service.js'" chỉ được dùng bên trong function / arrow có thân; top-level không gọi hàm của other
    const topLevelCalls = lines.filter((l) => /^(const|let|var)\s+\w+\s*=\s*(await\s+)?\w*(Service|seat|showtime)\w*\./.test(l) && new RegExp(`${other}`, 'i').test(l));
    assert.deepEqual(topLevelCalls, [], `${file}.service gọi ${other}.service ở mức module`);
  }
});

test('⭐ SDK Anthropic chỉ được nhập trong ai/llm/anthropic.js (còn lại chỉ biết giao diện `complete`); khóa API chỉ đọc ở env.js / server.js và không bao giờ bị in ra', () => {
  const importers = files(SRC).filter((f) => /@anthropic-ai\/sdk/.test(code(f))).map(rel);
  assert.deepEqual(importers, ['ai/llm/anthropic.js']);
  const readers = files(SRC).filter((f) => /ANTHROPIC_API_KEY/.test(code(f))).map(rel).sort();
  assert.deepEqual(readers, ['config/env.js', 'server.js']);
  const leaks = files(SRC).filter((f) => /console\.\w+\(\s*(env\.)?(ANTHROPIC_API_KEY|apiKey)\s*[,)]|\$\{[^}]*(ANTHROPIC_API_KEY|apiKey)[^}]*\}/.test(code(f))).map(rel);
  assert.deepEqual(leaks, []);
});
