// Tạo sẵn ba tài khoản THẬT (USER / STAFF / ADMIN) trong DB để test route đặc quyền.
// Route /admin và /staff đọc vai trò từ DB mỗi request (requireFreshRole), nên token giả vai trò không còn đủ.
import { signAccessToken } from '../../src/lib/jwt.js';

export async function createRoleUsers(prisma, tag) {
  const users = {};
  for (const role of ['USER', 'STAFF', 'ADMIN']) {
    users[role] = await prisma.user.create({
      data: { email: `test-role-${tag}-${role.toLowerCase()}@example.com`, passwordHash: 'x', fullName: `Test ${role}`, role },
    });
  }
  return {
    users,
    /** Access token hợp lệ của tài khoản có vai trò `role`. */
    token: (role) => signAccessToken({ id: users[role].id, role }),
    /** Xóa ba tài khoản; gọi SAU khi đã xóa dữ liệu tham chiếu tới chúng (đơn hàng...). */
    cleanup: () => prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } }),
  };
}
