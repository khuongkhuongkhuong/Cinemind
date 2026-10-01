import * as userService from '../../services/adminUser.service.js';
import { ok, okPaged } from '../../utils/response.js';

export async function list(req, res) {
  const { items, meta } = await userService.listUsers(req.query);
  okPaged(res, items, meta);
}

export async function createStaff(req, res) {
  ok(res, await userService.createStaff(req.body), 201);
}

// actorId lấy từ token: người đang thao tác, dùng để chặn tự khóa / tự hạ quyền.
export async function update(req, res) {
  ok(res, await userService.updateUser({ actorId: req.user.id, userId: req.params.id, ...req.body }));
}
