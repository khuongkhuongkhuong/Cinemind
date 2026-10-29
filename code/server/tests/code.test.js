// BR-32: mã đơn / vé là chuỗi ngẫu nhiên khó đoán, không dùng số tăng dần. Không cần database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateOrderCode } from '../src/lib/code.js';

test('mã đúng độ dài, chỉ gồm ký tự dễ đọc (không có 0/O/1/I)', () => {
  for (let i = 0; i < 2000; i++) {
    const code = generateOrderCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/, code);
  }
  assert.equal(generateOrderCode(12).length, 12);
});

test('⭐ không trùng (5.000 mã) và KHÔNG tăng dần theo thứ tự sinh', () => {
  const codes = Array.from({ length: 5000 }, () => generateOrderCode());
  assert.equal(new Set(codes).size, codes.length);
  const ascending = codes.filter((c, i) => i > 0 && c > codes[i - 1]).length;
  // Dãy ngẫu nhiên: khoảng một nửa cặp liền kề "tăng". Số tăng dần / theo thời gian sẽ lệch hẳn về 0 hoặc 5000.
  assert.ok(ascending > 2000 && ascending < 3000, `số cặp tăng = ${ascending}`);
});

test('mỗi ký tự trong bảng chữ cái đều xuất hiện (phân bố không lệch về một vài ký tự)', () => {
  const seen = new Set(Array.from({ length: 4000 }, () => generateOrderCode()).join(''));
  assert.equal(seen.size, 32);
});

test('⭐ nguồn dùng crypto.randomInt, không dùng Math.random (đoán được) hay bộ đếm', () => {
  const src = readFileSync(new URL('../src/lib/code.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /randomInt/);
  assert.doesNotMatch(src, /Math\.random|Date\.now|\+\+\s*counter/);
});
