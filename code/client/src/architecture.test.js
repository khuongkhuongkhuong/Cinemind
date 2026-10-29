// NFR-18 (phía client): page -> hook (TanStack Query) -> api/*.api.js. Page và component KHÔNG gọi Axios / api trực tiếp.
// Quy tắc nằm trong CLAUDE.md; test này biến nó thành thứ máy kiểm tra được, để không ai lỡ tay phá.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\.[jt]sx?$/.test(name) ? [full] : [];
  });
}
const rel = (f) => relative(SRC, f).replaceAll('\\', '/');
const code = (f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('kiến trúc client', () => {
  it('quét được file (đề phòng đường dẫn sai làm test "qua" vì không kiểm gì)', () => {
    expect(files(join(SRC, 'pages')).length).toBeGreaterThan(10);
    expect(files(join(SRC, 'hooks')).length).toBeGreaterThan(3);
  });

  it('⭐ pages / components KHÔNG import axios hay api/*.api (chỉ hooks được gọi tầng api)', () => {
    const offenders = ['pages', 'components']
      .flatMap((d) => files(join(SRC, d)))
      // `@/api/errors` là hàm thuần đọc mã lỗi (không gọi mạng) nên được phép dùng ở mọi nơi.
      .filter((f) => /from '(axios|@\/api\/(?!errors')[^']+)'/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('chỉ tầng api/ được dùng instance Axios (api/axios.js)', () => {
    const offenders = files(SRC)
      .filter((f) => !rel(f).startsWith('api/') && /from '(axios|@\/api\/axios)'/.test(code(f)))
      .map(rel)
      // AuthContext cần tokenStore/axios để gắn token + làm mới phiên: ngoại lệ có chủ đích.
      .filter((f) => !['context/AuthContext.jsx', 'main.jsx', 'mocks/browser.js'].includes(f));
    expect(offenders).toEqual([]);
  });

  it('rẽ nhánh lỗi theo error.code, không theo error.message', () => {
    const offenders = files(join(SRC, 'pages'))
      .filter((f) => /(err|error|e)\.message\s*(===|==|\.includes|\.startsWith|\.match)/.test(code(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
