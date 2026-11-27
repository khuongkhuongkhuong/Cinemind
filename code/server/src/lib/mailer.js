import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

// Gửi email (tiện ích kỹ thuật, không chứa luật nghiệp vụ). Ba chế độ:
//  - test: giữ thư trong `outbox` cho test đọc, không gửi đi đâu;
//  - dev chưa cấu hình MAIL_* hoặc địa chỉ mẫu (@example.com, .test): IN RA LOG server;
//  - đã cấu hình: gửi qua Gmail bằng "mật khẩu ứng dụng".
// Production BẮT BUỘC cấu hình MAIL_* (config/env.js) nên mã không bao giờ bị in ra log ở production.

export const outbox = [];
let transport = null;

const isSampleAddress = (to) => /@(example\.(com|org|net)|[^@]+\.test)$/i.test(to);

/**
 * @param {{ to: string, subject: string, text: string }} mail
 * @returns {Promise<void>}
 */
export async function sendMail({ to, subject, text }) {
  if (env.NODE_ENV === 'test') {
    outbox.push({ to, subject, text });
    return;
  }
  const configured = env.MAIL_USER && env.MAIL_APP_PASSWORD;
  if (!configured || (env.NODE_ENV !== 'production' && isSampleAddress(to))) {
    console.log(`[EMAIL không gửi đi — chỉ in ra khi phát triển] Tới: ${to}\nTiêu đề: ${subject}\n${text}\n`);
    return;
  }
  transport ??= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.MAIL_USER, pass: env.MAIL_APP_PASSWORD.replaceAll(' ', '') }, // Google hiển thị mật khẩu có dấu cách
  });
  await transport.sendMail({ from: `Cinemind <${env.MAIL_USER}>`, to, subject, text });
}
