import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatWidget from './ChatWidget';
import { AuthContext } from '@/context/AuthContext';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); // gọi API không khai báo = test đỏ (chứng minh không có lời gọi thừa)
afterAll(() => server.close());
beforeEach(() => sessionStorage.clear());
afterEach(() => server.resetHandlers());

const ORDER = {
  id: 'o1', code: 'K7Q2M9XA', status: 'PENDING', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  showtime: { id: 'st1', startTime: '2026-12-02T12:45:00.000Z', format: 'F2D', audio: 'SUBTITLE', movie: { title: 'Phim thử' }, cinema: { name: 'Rạp A' }, room: { name: 'Phòng 3' } },
  seats: [{ seatId: 's1', label: 'G7', type: 'VIP', price: 105_000 }, { seatId: 's2', label: 'G8', type: 'VIP', price: 105_000 }],
  combos: [], promotion: null, seatTotal: 210_000, comboTotal: 0, discount: 0, total: 210_000, paidAt: null, checkedInAt: null,
};
const PENDING = {
  actionId: 'act-1', tool: 'hold_seats', summary: 'Giữ ghế G7, G8 (VIP) — Phim thử, Rạp A, Phòng 3. Tổng: 210.000đ.',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
};

/** Server giả: ghi lại mọi lời gọi; `script.chat` / `script.confirm` là hàm trả phản hồi cho từng lần gọi. */
function backend(script = {}) {
  const calls = { chat: [], confirm: [], get: [], del: [] };
  server.use(
    http.post('/api/v1/ai/chat', async ({ request }) => {
      const body = await request.json();
      calls.chat.push(body);
      return script.chat ? script.chat(body, calls.chat.length) : ok({ sessionId: 's-1', reply: { text: 'Chào bạn!', pendingAction: null } });
    }),
    http.post('/api/v1/ai/confirm', async ({ request }) => {
      const body = await request.json();
      calls.confirm.push(body);
      return script.confirm ? script.confirm(body) : ok({ reply: { text: 'Đã xong.' } });
    }),
    http.get('/api/v1/ai/sessions/:id', ({ params }) => {
      calls.get.push(params.id);
      return script.session ? script.session(params.id) : err(404, 'NOT_FOUND', 'x');
    }),
    http.delete('/api/v1/ai/sessions/:id', ({ params }) => { calls.del.push(params.id); return ok({ sessionId: params.id, status: 'CLOSED' }); }),
  );
  return calls;
}

function mount(status = 'authenticated') {
  const auth = { status, user: status === 'authenticated' ? { id: 'u1', role: 'USER' } : null };
  return renderPage(
    [{ path: '/', element: <AuthContext.Provider value={auth}><div>TRANG CHỦ</div><ChatWidget /></AuthContext.Provider> },
      { path: '/booking/orders/:orderId', element: <div>TRANG THANH TOÁN</div> }],
    '/',
  );
}
const openChat = async (user) => { await user.click(screen.getByRole('button', { name: 'Mở trợ lý đặt vé' })); return screen.getByRole('dialog'); };
const say = async (user, text) => { await user.type(screen.getByLabelText('Nhập tin nhắn'), text); await user.click(screen.getByRole('button', { name: 'Gửi' })); };

describe('bong bóng trợ lý: hiển thị', () => {
  it('chưa đăng nhập: không có bong bóng (server yêu cầu đăng nhập cho /ai/*)', () => {
    backend();
    mount('anonymous');
    expect(screen.queryByRole('button', { name: /trợ lý/i })).toBeNull();
  });

  it('đang khôi phục phiên: chưa hiện bong bóng', () => {
    backend();
    mount('loading');
    expect(screen.queryByRole('button', { name: /trợ lý/i })).toBeNull();
  });

  it('đã đăng nhập: có bong bóng, khung chat đóng và CHƯA gọi API nào cho tới khi bấm mở', async () => {
    backend();
    mount();
    expect(screen.getByRole('button', { name: 'Mở trợ lý đặt vé' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await openChat(userEvent.setup());
    expect(dialog).toHaveAccessibleName('Trợ lý đặt vé Cinemind');
    expect(screen.getByText(/Xin chào! Mình giúp bạn/)).toBeInTheDocument();
  });

  it('nút đóng và phím Escape đều đóng khung chat', async () => {
    backend();
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await user.click(screen.getByRole('button', { name: 'Đóng trợ lý' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await openChat(user);
    await user.type(screen.getByLabelText('Nhập tin nhắn'), '{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('gửi tin', () => {
  it('gửi tin: hiện tin của khách và lời đáp; lần đầu KHÔNG gửi sessionId, lần sau gửi đúng sessionId server cấp', async () => {
    const calls = backend({ chat: (body, n) => ok({ sessionId: 's-1', reply: { text: n === 1 ? 'Tối nay có 3 suất.' : 'Ok!', pendingAction: null } }) });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'Tối nay có phim gì?');
    expect(await screen.findByText('Tối nay có 3 suất.')).toBeInTheDocument();
    expect(screen.getByText('Tối nay có phim gì?')).toBeInTheDocument();
    expect(calls.chat[0]).toEqual({ text: 'Tối nay có phim gì?' }); // không có sessionId, không có userId / role
    await say(user, 'Cảm ơn');
    await screen.findByText('Ok!');
    expect(calls.chat[1]).toEqual({ sessionId: 's-1', text: 'Cảm ơn' });
  });

  it('chọn gợi ý có sẵn thì gửi luôn nội dung đó', async () => {
    const calls = backend();
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await user.click(screen.getByRole('button', { name: 'Tối nay có suất chiếu nào?' }));
    await screen.findByText('Chào bạn!');
    expect(calls.chat[0].text).toBe('Tối nay có suất chiếu nào?');
  });

  it('Enter gửi, Shift+Enter xuống dòng, tin rỗng / toàn khoảng trắng không gửi', async () => {
    const calls = backend();
    mount();
    const user = userEvent.setup();
    await openChat(user);
    const box = screen.getByLabelText('Nhập tin nhắn');
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
    await user.type(box, '   ');
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
    await user.clear(box);
    await user.type(box, 'dòng 1{Shift>}{Enter}{/Shift}dòng 2');
    expect(box).toHaveValue('dòng 1\ndòng 2');
    expect(calls.chat).toHaveLength(0);
    await user.type(box, '{Enter}');
    await screen.findByText('Chào bạn!');
    expect(calls.chat[0].text).toBe('dòng 1\ndòng 2');
    expect(box).toHaveValue(''); // ô nhập được làm trống sau khi gửi
  });

  it('⭐ nội dung có HTML / script chỉ hiện dạng chữ, không bao giờ được dựng thành phần tử', async () => {
    backend({ chat: () => ok({ sessionId: 's-1', reply: { text: 'Đây: <img src=x onerror=alert(1)> và <b>đậm</b>', pendingAction: null } }) });
    const { container } = mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, '<script>alert(1)</script>');
    expect(await screen.findByText(/Đây: <img src=x/)).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('img, script, b')).toBeNull();
  });

  it('giới hạn 1000 ký tự và hiện bộ đếm', async () => {
    backend();
    mount();
    const user = userEvent.setup();
    await openChat(user);
    expect(screen.getByLabelText('Nhập tin nhắn')).toHaveAttribute('maxLength', '1000');
    await user.type(screen.getByLabelText('Nhập tin nhắn'), 'abc');
    expect(screen.getByText('3/1000')).toBeInTheDocument();
  });
});

describe('⭐ xác nhận việc chờ (chỉ lời bấm của người dùng mới làm server thực thi)', () => {
  const chatWithPending = () => ok({ sessionId: 's-1', reply: { text: 'Bạn xác nhận nhé?', pendingAction: PENDING } });

  it('hiện hộp xác nhận với phần tóm tắt do server viết; Xác nhận -> POST /ai/confirm đúng actionId, hiện thẻ đơn và gỡ hộp', async () => {
    const calls = backend({
      chat: chatWithPending,
      confirm: () => ok({ reply: { text: 'Đã giữ ghế G7, G8.', order: ORDER, paymentUrl: 'https://sandbox.vnpayment.vn/pay?x=1' } }),
    });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'giữ G7 G8');
    const card = await screen.findByRole('region', { name: 'Việc đang chờ bạn xác nhận' });
    expect(card).toHaveTextContent('Giữ ghế G7, G8 (VIP) — Phim thử, Rạp A, Phòng 3. Tổng: 210.000đ.');
    expect(calls.confirm).toHaveLength(0); // chưa bấm thì chưa có lời xác nhận nào

    await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Đã giữ ghế G7, G8.')).toBeInTheDocument();
    expect(calls.confirm).toEqual([{ sessionId: 's-1', actionId: 'act-1', approve: true }]);
    expect(screen.queryByRole('region', { name: 'Việc đang chờ bạn xác nhận' })).toBeNull();

    const order = screen.getByRole('article', { name: 'Đơn K7Q2M9XA' });
    expect(order).toHaveTextContent('Phim thử');
    expect(order).toHaveTextContent('Ghế: G7, G8');
    expect(order).toHaveTextContent('210.000đ');
    expect(screen.getByRole('link', { name: 'Xem đơn và thanh toán' })).toHaveAttribute('href', '/booking/orders/o1');
    expect(screen.getByRole('link', { name: 'Thanh toán ngay' })).toHaveAttribute('href', 'https://sandbox.vnpayment.vn/pay?x=1');
  });

  it('link thanh toán có scheme lạ (javascript:) bị bỏ, không hiện nút', async () => {
    backend({ chat: chatWithPending, confirm: () => ok({ reply: { text: 'Xong.', order: ORDER, paymentUrl: 'javascript:alert(1)' } }) });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'giữ');
    await user.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    await screen.findByText('Xong.');
    expect(screen.queryByRole('link', { name: 'Thanh toán ngay' })).toBeNull();
  });

  it('Hủy -> POST /ai/confirm với approve = false và hộp biến mất', async () => {
    const calls = backend({ chat: chatWithPending, confirm: () => ok({ reply: { text: 'Mình đã hủy yêu cầu đó.' } }) });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'giữ');
    await user.click(await screen.findByRole('button', { name: 'Hủy' }));
    expect(await screen.findByText('Mình đã hủy yêu cầu đó.')).toBeInTheDocument();
    expect(calls.confirm[0].approve).toBe(false);
    expect(screen.queryByRole('region', { name: 'Việc đang chờ bạn xác nhận' })).toBeNull();
  });

  it('nhắn tin mới thì việc chờ cũ biến mất NGAY (server cũng thay thế nó), không chờ lời đáp', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    backend({
      chat: async (_body, n) => {
        if (n === 1) return chatWithPending();
        await gate; // giữ lời đáp lại để kiểm tra trạng thái TRONG LÚC đang gửi
        return ok({ sessionId: 's-1', reply: { text: 'Ok, đổi ý nhé.', pendingAction: PENDING } });
      },
    });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'giữ G7');
    await screen.findByRole('region', { name: 'Việc đang chờ bạn xác nhận' });
    await say(user, 'thôi không giữ nữa');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Việc đang chờ bạn xác nhận' })).toBeNull());
    release();
    await screen.findByText('Ok, đổi ý nhé.');
  });

  it('việc chờ đã quá hạn: khóa cả hai nút và báo cần tạo yêu cầu mới', async () => {
    backend({ chat: () => ok({ sessionId: 's-1', reply: { text: 'Xác nhận nhé?', pendingAction: { ...PENDING, expiresAt: new Date(Date.now() - 1000).toISOString() } } }) });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'giữ');
    expect(await screen.findByText(/Yêu cầu đã hết hạn/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
  });

  it('server báo NOT_FOUND khi xác nhận (đã dùng / hết hạn): báo rõ và gỡ hộp, không treo', async () => {
    backend({ chat: chatWithPending, confirm: () => err(404, 'NOT_FOUND', 'Không có việc chờ') });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'giữ');
    await user.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Yêu cầu này đã hết hạn hoặc đã được xử lý.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Việc đang chờ bạn xác nhận' })).toBeNull();
  });

  it('thất bại nghiệp vụ (ghế vừa bị lấy) nằm trong lời đáp 200 và hiện như tin bình thường', async () => {
    backend({ chat: chatWithPending, confirm: () => ok({ reply: { text: 'Ghế G7 vừa có người chọn, bạn muốn mình gợi ý ghế khác không?' } }) });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'giữ');
    await user.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText(/Ghế G7 vừa có người chọn/)).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull(); // không có thẻ đơn
  });
});

describe('lỗi và phục hồi', () => {
  it.each([
    ['AI_UNAVAILABLE', 503, /Trợ lý đang tạm nghỉ/],
    ['RATE_LIMITED', 429, /nhắn hơi nhanh/],
  ])('%s -> lời báo thân thiện trong khung chat, khung vẫn dùng được', async (code, status, pattern) => {
    backend({ chat: () => err(status, code, 'chi tiết kỹ thuật không được lộ') });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'xin chào');
    expect(await screen.findByText(pattern)).toBeInTheDocument();
    expect(screen.queryByText(/chi tiết kỹ thuật/)).toBeNull();
    expect(screen.getByLabelText('Nhập tin nhắn')).toBeEnabled();
  });

  it('mất mạng: báo lỗi chung, không treo', async () => {
    backend({ chat: () => Response.error() });
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'xin chào');
    expect(await screen.findByText(/Không kết nối được máy chủ/)).toBeInTheDocument();
  });

  it('phiên không còn (NOT_FOUND khi chat): báo kết thúc, quên phiên cũ; lần nhắn sau mở phiên mới', async () => {
    const calls = backend({
      session: () => ok({ sessionId: 's-old', status: 'ACTIVE', messages: [], pendingAction: null }),
      chat: (_body, n) => (n === 1 ? err(404, 'NOT_FOUND', 'x') : ok({ sessionId: 's-2', reply: { text: 'Phiên mới!', pendingAction: null } })),
    });
    sessionStorage.setItem('cinemind.chat.sessionId', 's-old');
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await waitFor(() => expect(calls.get).toEqual(['s-old'])); // nạp xong phiên nhớ
    await say(user, 'a');
    expect(await screen.findByText(/Phiên trò chuyện đã kết thúc/)).toBeInTheDocument();
    expect(calls.chat[0]).toEqual({ sessionId: 's-old', text: 'a' });
    await say(user, 'b');
    await screen.findByText('Phiên mới!');
    expect(calls.chat[1]).toEqual({ text: 'b' }); // không còn gửi mã phiên cũ
  });
});

describe('nạp lại và làm mới cuộc trò chuyện', () => {
  it('tải lại trang: nhớ mã phiên, nạp lại tin và việc chờ từ server', async () => {
    const calls = backend({
      session: () => ok({ sessionId: 's-9', status: 'ACTIVE', messages: [{ role: 'USER', text: 'giữ G7' }, { role: 'ASSISTANT', text: 'Bạn xác nhận nhé?' }], pendingAction: PENDING }),
    });
    sessionStorage.setItem('cinemind.chat.sessionId', 's-9');
    mount();
    await openChat(userEvent.setup());
    expect(await screen.findByText('Bạn xác nhận nhé?')).toBeInTheDocument();
    expect(screen.getByText('giữ G7')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Việc đang chờ bạn xác nhận' })).toBeInTheDocument();
    expect(calls.get).toEqual(['s-9']);
  });

  it('mã phiên nhớ không còn dùng được (404): bỏ đi, khung chat trống', async () => {
    backend(); // GET trả 404 theo mặc định
    sessionStorage.setItem('cinemind.chat.sessionId', 's-cu');
    mount();
    await openChat(userEvent.setup());
    expect(await screen.findByText(/Xin chào! Mình giúp bạn/)).toBeInTheDocument();
    expect(sessionStorage.getItem('cinemind.chat.sessionId')).toBeNull();
  });

  it('"Cuộc trò chuyện mới": đóng phiên ở server, xóa khung chat, lần nhắn sau không gửi sessionId cũ', async () => {
    const calls = backend();
    mount();
    const user = userEvent.setup();
    await openChat(user);
    await say(user, 'xin chào');
    await screen.findByText('Chào bạn!');
    await user.click(screen.getByRole('button', { name: 'Cuộc trò chuyện mới' }));
    await waitFor(() => expect(calls.del).toEqual(['s-1']));
    expect(screen.queryByText('Chào bạn!')).toBeNull();
    expect(sessionStorage.getItem('cinemind.chat.sessionId')).toBeNull();
    await say(user, 'lại nào');
    await screen.findByText('Chào bạn!');
    expect(calls.chat[1]).toEqual({ text: 'lại nào' });
  });
});
