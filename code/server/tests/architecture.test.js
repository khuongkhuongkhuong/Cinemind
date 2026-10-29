// NFR-18: kiến trúc phân lớp routes -> controllers -> services -> Prisma, được KIỂM BẰNG TEST thay vì chỉ ghi trong tài liệu.
// Không cần database. Nếu ai đó import Prisma vào controller (hoặc để service đụng req/res), test này đỏ ngay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

test('services có import Prisma là bình thường, nhưng KHÔNG import từ controllers / routes (không phụ thuộc ngược lớp)', () => {
  const offenders = files(join(SRC, 'services')).filter((f) => /from '\.\.\/(controllers|routes)\//.test(code(f))).map(rel);
  assert.deepEqual(offenders, []);
});
