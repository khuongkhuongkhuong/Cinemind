import { z } from 'zod';

// .strict(): body chỉ có đúng các trường dưới đây. Gửi thêm `userId`, `role`... bị từ chối (chống mass assignment);
// danh tính người dùng luôn lấy từ token, không bao giờ từ body.
export const chatSchema = z.object({
  sessionId: z.uuid('sessionId không hợp lệ').optional(),
  text: z.string('Vui lòng nhập nội dung tin nhắn').max(1000, 'Tin nhắn tối đa 1000 ký tự'),
}).strict();

export const confirmSchema = z.object({
  sessionId: z.uuid('sessionId không hợp lệ'),
  actionId: z.uuid('actionId không hợp lệ'),
  approve: z.boolean('approve phải là true hoặc false'),
}).strict();

export const sessionIdParam = z.object({ id: z.uuid('id không hợp lệ') });
