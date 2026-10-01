import { randomInt } from 'node:crypto';

// Bỏ các ký tự dễ nhầm (0/O, 1/I) vì mã này người dùng đọc/nhập tay. 32 ký tự ^ 8 ≈ 1,1 nghìn tỉ khả năng.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mã đơn/vé ngẫu nhiên khó đoán (BR-32) — dùng randomInt của crypto, KHÔNG dùng số tăng dần hay Math.random. */
export function generateOrderCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * Chuẩn hóa mã vé người/máy quét nhập vào: nhận cả mã trần ("K7Q2M9XA") lẫn nội dung QR ("CINEMIND:K7Q2M9XA"),
 * bỏ khoảng trắng, không phân biệt hoa/thường.
 */
export function normalizeTicketCode(input) {
  return String(input ?? '').trim().replace(/^cinemind:/i, '').trim().toUpperCase();
}
