import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as chatApi from '@/api/chat.api';
import { errorMessage, hasCode, normalizeError } from '@/api/errors';

const STORAGE_KEY = 'cinemind.chat.sessionId';

// Chỉ nhớ MÃ phiên (không nhớ nội dung) để tải lại trang vẫn nạp lại được cuộc trò chuyện từ server. sessionStorage có thể bị chặn → try/catch.
const readStoredSession = () => {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
};
const writeStoredSession = (id) => {
  try { if (id) sessionStorage.setItem(STORAGE_KEY, id); else sessionStorage.removeItem(STORAGE_KEY); } catch { /* bỏ qua */ }
};

let messageCounter = 0;
const withId = (message) => ({ id: `m${++messageCounter}`, ...message });

/** Lời báo lỗi cho khung chat; rẽ nhánh theo `code`, không theo `message` (hợp đồng API mục 1.1). */
function describeError(error) {
  const { code } = normalizeError(error);
  if (code === 'AI_UNAVAILABLE') return 'Trợ lý đang tạm nghỉ. Bạn vẫn đặt vé bình thường trên trang nhé.';
  if (code === 'RATE_LIMITED') return 'Bạn nhắn hơi nhanh, vui lòng thử lại sau ít phút.';
  return errorMessage(error);
}

/**
 * Trạng thái khung chat với trợ lý: danh sách tin, việc đang chờ xác nhận, gửi tin, bấm Xác nhận / Hủy.
 * Mọi tin của trợ lý và phần tóm tắt việc chờ đều do SERVER viết từ dữ liệu thật; client chỉ hiển thị và gửi lời bấm của người dùng.
 * @returns {{ messages: object[], pendingAction: object|null, sending: boolean, responding: boolean, restoring: boolean,
 *   send: (text: string) => Promise<void>, approve: () => Promise<void>, reject: () => Promise<void>, reset: () => Promise<void> }}
 */
export function useChat() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState(readStoredSession);
  const [messages, setMessages] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [restoring, setRestoring] = useState(() => Boolean(readStoredSession()));
  const sendMutation = useMutation({ mutationFn: chatApi.sendMessage });
  const confirmMutation = useMutation({ mutationFn: chatApi.confirmAction });

  const remember = useCallback((id) => { setSessionId(id); writeStoredSession(id); }, []);
  const push = useCallback((message) => setMessages((list) => [...list, withId(message)]), []);

  // Tải lại trang: nạp lại cuộc trò chuyện của phiên đang nhớ (phiên không còn / không phải của mình thì bỏ).
  useEffect(() => {
    const stored = readStoredSession();
    if (!stored) return undefined;
    let alive = true;
    chatApi.getChatSession(stored)
      .then((session) => {
        if (!alive) return;
        setMessages(session.messages.map((m) => withId({ role: m.role === 'USER' ? 'user' : 'assistant', text: m.text })));
        setPendingAction(session.pendingAction ?? null);
      })
      .catch(() => { if (alive) remember(null); })
      .finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, [remember]);

  const send = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    push({ role: 'user', text: trimmed });
    setPendingAction(null); // tin mới của khách thay thế việc chờ cũ (server làm đúng như vậy)
    try {
      const data = await sendMutation.mutateAsync({ sessionId, text: trimmed });
      remember(data.sessionId);
      push({ role: 'assistant', text: data.reply.text });
      setPendingAction(data.reply.pendingAction ?? null);
    } catch (error) {
      if (hasCode(error, 'NOT_FOUND') || hasCode(error, 'FORBIDDEN')) {
        remember(null);
        push({ role: 'error', text: 'Phiên trò chuyện đã kết thúc. Hãy nhắn lại để bắt đầu phiên mới.' });
      } else {
        push({ role: 'error', text: describeError(error) });
      }
    }
  }, [push, remember, sendMutation, sessionId]);

  const respond = useCallback(async (approve) => {
    if (!pendingAction || !sessionId) return;
    try {
      const { reply } = await confirmMutation.mutateAsync({ sessionId, actionId: pendingAction.actionId, approve });
      setPendingAction(null);
      push({ role: 'assistant', text: reply.text, order: reply.order, paymentUrl: reply.paymentUrl });
      if (reply.order) queryClient.invalidateQueries({ queryKey: ['myOrders'] }); // đơn mới / vừa đổi: "Vé của tôi" lấy lại dữ liệu
    } catch (error) {
      setPendingAction(null);
      push({ role: 'error', text: hasCode(error, 'NOT_FOUND') ? 'Yêu cầu này đã hết hạn hoặc đã được xử lý.' : describeError(error) });
    }
  }, [confirmMutation, pendingAction, push, queryClient, sessionId]);

  const reset = useCallback(async () => {
    if (sessionId) chatApi.closeChatSession(sessionId).catch(() => {}); // đóng ở server là cố gắng hết sức; phía client luôn làm mới
    remember(null);
    setMessages([]);
    setPendingAction(null);
  }, [remember, sessionId]);

  return {
    messages,
    pendingAction,
    sending: sendMutation.isPending,
    responding: confirmMutation.isPending,
    restoring,
    send,
    approve: () => respond(true),
    reject: () => respond(false),
    reset,
  };
}
