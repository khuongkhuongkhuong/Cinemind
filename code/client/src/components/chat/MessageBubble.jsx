import OrderCard from './OrderCard';

const STYLES = {
  user: 'ml-auto bg-brand-600 text-white',
  assistant: 'mr-auto bg-ink-800 text-ink-100',
  error: 'mr-auto border border-bad/60 bg-bad/5 text-bad',
};
const SPEAKER = { user: 'Bạn', assistant: 'Trợ lý', error: 'Lỗi' };

/** Một tin trong khung chat. Văn bản được hiển thị NGUYÊN VĂN dạng chữ (không dựng HTML từ nội dung do mô hình / người dùng viết). */
export default function MessageBubble({ message }) {
  return (
    <li className={message.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
      <span className="sr-only">{SPEAKER[message.role]}:</span>
      <p className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${STYLES[message.role] ?? STYLES.assistant}`}>{message.text}</p>
      {message.order && <div className="w-full max-w-[85%]"><OrderCard order={message.order} paymentUrl={message.paymentUrl} /></div>}
    </li>
  );
}
