import * as chatService from '../services/chat.service.js';
import { ok } from '../utils/response.js';

// Controller chỉ đọc req, gọi MỘT service, trả res. userId luôn từ token (req.user), không từ body.
export async function chat(req, res) {
  const { sessionId, text } = req.body;
  ok(res, await chatService.chat({ userId: req.user.id, sessionId, text }));
}

export async function confirm(req, res) {
  const { sessionId, actionId, approve } = req.body;
  ok(res, await chatService.confirm({ userId: req.user.id, sessionId, actionId, approve }));
}

export async function getSession(req, res) {
  ok(res, await chatService.getSession({ userId: req.user.id, sessionId: req.params.id }));
}

export async function closeSession(req, res) {
  ok(res, await chatService.closeSession({ userId: req.user.id, sessionId: req.params.id }));
}
