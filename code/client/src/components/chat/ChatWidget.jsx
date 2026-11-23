import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks/useChat';
import Spinner from '@/components/ui/Spinner';
import MessageBubble from './MessageBubble';
import PendingActionCard from './PendingActionCard';

const MAX_LENGTH = 1000; // khớp giới hạn của server (POST /ai/chat)
const SUGGESTIONS = ['Tối nay có suất chiếu nào?', 'Gợi ý giúp mình 2 ghế liền nhau', 'Đơn của mình đang ở trạng thái nào?'];

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

/** Khung hội thoại: danh sách tin, hộp xác nhận (nếu có việc chờ) và ô nhập. */
function ChatPanel({ onClose }) {
  const { messages, pendingAction, sending, responding, restoring, send, approve, reject, reset } = useChat();
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight; // luôn cuộn tới tin mới nhất
  }, [messages, pendingAction, sending]);

  const submit = (event) => {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    const text = draft;
    setDraft('');
    send(text);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) submit(event); // Enter gửi, Shift+Enter xuống dòng
    if (event.key === 'Escape') onClose();
  };

  return (
    <section
      role="dialog"
      aria-label="Trợ lý đặt vé Cinemind"
      className="fixed bottom-20 right-4 z-40 flex h-[32rem] max-h-[calc(100vh-7rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-ink-500 bg-ink-900 shadow-xl"
    >
      <header className="flex items-center justify-between border-b border-ink-500 bg-brand-600 px-3 py-2 text-white">
        <h2 className="text-sm font-bold">Trợ lý đặt vé</h2>
        <div className="flex gap-1">
          <button type="button" onClick={reset} className="rounded px-2 py-1 text-xs hover:bg-white/20">Cuộc trò chuyện mới</button>
          <button type="button" onClick={onClose} aria-label="Đóng trợ lý" className="rounded px-2 py-1 text-sm hover:bg-white/20">✕</button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {restoring && <div className="flex justify-center py-6"><Spinner className="h-5 w-5" /></div>}
        {!restoring && messages.length === 0 && (
          <div className="space-y-2 text-sm text-ink-300">
            <p>Xin chào! Mình giúp bạn tìm suất chiếu, chọn ghế và đặt vé. Bạn cần gì?</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={sending} className="rounded-full border border-ink-500 px-3 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <ul aria-live="polite" className="space-y-2">
          {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
        </ul>
        {sending && <p role="status" className="flex items-center gap-2 text-xs text-ink-300"><Spinner className="h-3 w-3" /> Trợ lý đang trả lời…</p>}
        {pendingAction && <PendingActionCard action={pendingAction} busy={responding} onApprove={approve} onReject={reject} />}
      </div>

      <form onSubmit={submit} className="border-t border-ink-500 p-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={MAX_LENGTH}
            aria-label="Nhập tin nhắn"
            placeholder="Nhập tin nhắn…"
            className="min-h-[2.5rem] flex-1 resize-none rounded border border-ink-500 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-300"
          />
          <button type="submit" disabled={!draft.trim() || sending} className="h-10 rounded bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50">
            Gửi
          </button>
        </div>
        <p className="mt-1 text-right text-[11px] text-ink-300">{draft.length}/{MAX_LENGTH}</p>
      </form>
    </section>
  );
}

/**
 * Bong bóng trợ lý nổi ở góc phải (chỉ hiện khi đã đăng nhập: server yêu cầu đăng nhập cho mọi endpoint /ai/*).
 * Khung chat chỉ được dựng khi mở, nên không gọi API nào cho tới khi người dùng bấm vào bong bóng.
 */
export default function ChatWidget() {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  if (status !== 'authenticated') return null;

  return (
    <>
      {open && <ChatPanel onClose={() => setOpen(false)} />}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Đóng trợ lý đặt vé' : 'Mở trợ lý đặt vé'}
        aria-expanded={open}
        className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-500"
      >
        <ChatIcon />
      </button>
    </>
  );
}
