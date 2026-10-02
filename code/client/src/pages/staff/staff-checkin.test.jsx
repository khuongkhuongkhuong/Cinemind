import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StaffCheckInPage from './StaffCheckInPage';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const order = (extra = {}) => ({
  id: 'o1', code: 'K7Q2M9XA', status: 'PAID', checkedInAt: null,
  showtime: { id: 's1', startTime: '2026-10-02T12:45:00.000Z', format: 'F2D', audio: 'SUBTITLE', movie: { title: 'Phim thử', ageRating: 'T13', posterUrl: null }, cinema: { name: 'Rạp A' }, room: { name: 'Phòng 3' } },
  seats: [{ seatId: 'G7', label: 'G7', type: 'VIP', price: 1 }, { seatId: 'G8', label: 'G8', type: 'VIP', price: 1 }], ...extra,
});
const routes = [{ path: '/staff/check-in', element: <StaffCheckInPage /> }];

/** Server giả; ghi lại mã mà trang gửi lên (đã chuẩn hóa chưa?). */
function backend({ lookup, checkIn }) {
  const seen = { lookup: [], checkIn: [] };
  server.use(
    http.get('/api/v1/staff/tickets/:code', ({ params }) => { seen.lookup.push(params.code); return lookup(); }),
    http.post('/api/v1/staff/tickets/:code/check-in', ({ params }) => { seen.checkIn.push(params.code); return checkIn(); }),
  );
  return seen;
}
const lookupFor = async (user, text) => {
  await user.type(screen.getByLabelText('Mã đặt vé hoặc nội dung mã QR'), text);
  await user.click(screen.getByRole('button', { name: 'Tra cứu' }));
};

describe('StaffCheckInPage (S01)', () => {
  it('⭐ nhập NỘI DUNG QR (có tiền tố, viết thường, có gạch): gửi lên server đã chuẩn hóa thành K7Q2M9XA', async () => {
    const seen = backend({ lookup: () => ok({ order: order(), canCheckIn: true }), checkIn: () => ok(order()) });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'cinemind:k7q2-m9xa');
    expect(await screen.findByText('✅ HỢP LỆ')).toBeInTheDocument();
    expect(seen.lookup).toEqual(['K7Q2M9XA']);
    expect(screen.getByText(/G7, G8/)).toBeInTheDocument();
    expect(screen.getByText('Phim thử')).toBeInTheDocument();
  });

  it('ô nhập được focus sẵn và Enter là tra cứu (đầu đọc QR "gõ" mã rồi nhấn Enter)', async () => {
    const seen = backend({ lookup: () => ok({ order: order(), canCheckIn: true }), checkIn: () => ok(order()) });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    expect(screen.getByLabelText('Mã đặt vé hoặc nội dung mã QR')).toHaveFocus();
    await user.keyboard('K7Q2M9XA{Enter}');
    expect(await screen.findByText('✅ HỢP LỆ')).toBeInTheDocument();
    expect(seen.lookup).toEqual(['K7Q2M9XA']);
  });

  it('nút Tra cứu bị khóa khi ô trống', () => {
    renderPage(routes, '/staff/check-in');
    expect(screen.getByRole('button', { name: 'Tra cứu' })).toBeDisabled();
  });

  it('⭐ luồng đầy đủ: tra cứu -> CHECK-IN -> "Đã check-in" kèm giờ -> "Vé tiếp theo" xóa ô và sẵn sàng quét tiếp', async () => {
    backend({
      lookup: () => ok({ order: order(), canCheckIn: true }),
      checkIn: () => ok(order({ checkedInAt: '2026-10-02T12:32:10.000Z' })),
    });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'K7Q2M9XA');
    await user.click(await screen.findByRole('button', { name: 'CHECK-IN' }));
    expect(await screen.findByText('✅ Đã check-in')).toBeInTheDocument();
    expect(screen.getByText(/Lúc 19:32/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vé tiếp theo' }));
    expect(screen.getByLabelText('Mã đặt vé hoặc nội dung mã QR')).toHaveValue('');
    expect(screen.getByLabelText('Mã đặt vé hoặc nội dung mã QR')).toHaveFocus();
    expect(screen.queryByText('✅ Đã check-in')).not.toBeInTheDocument();
  });

  it.each([
    ['NOT_PAID', /chưa thanh toán/],
    ['TOO_EARLY', /Chưa tới giờ check-in/],
    ['TOO_LATE', /Đã quá giờ check-in/],
    ['SHOWTIME_CANCELLED', /đã bị hủy/],
    ['ALREADY_USED', /đã được sử dụng/],
  ])('⭐ vé không hợp lệ (%s): nói rõ lý do và KHÔNG có nút CHECK-IN', async (reason, text) => {
    backend({ lookup: () => ok({ order: order({ checkedInAt: reason === 'ALREADY_USED' ? '2026-10-02T12:32:10.000Z' : null }), canCheckIn: false, reason }), checkIn: () => ok(order()) });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'K7Q2M9XA');
    expect(await screen.findByText('❌ Không cho vào')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByRole('button', { name: 'CHECK-IN' })).not.toBeInTheDocument();
  });

  it('vé đã dùng: hiện giờ đã quét', async () => {
    backend({ lookup: () => ok({ order: order({ checkedInAt: '2026-10-02T12:32:10.000Z' }), canCheckIn: false, reason: 'ALREADY_USED' }), checkIn: () => ok(order()) });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'K7Q2M9XA');
    expect(await screen.findByText(/Đã quét lúc 19:32/)).toBeInTheDocument();
  });

  it('mã không tồn tại (NOT_FOUND): báo không tìm thấy vé', async () => {
    backend({ lookup: () => err(404, 'NOT_FOUND', 'x'), checkIn: () => ok(order()) });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'KHONGCO1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy vé với mã này.');
  });

  it('⭐ hai nhân viên quét cùng lúc: server báo TICKET_ALREADY_USED khi check-in, trang hiển thị thông báo của server', async () => {
    backend({
      lookup: () => ok({ order: order(), canCheckIn: true }),
      checkIn: () => err(409, 'TICKET_ALREADY_USED', 'Vé đã được sử dụng lúc 19:32.', { checkedInAt: '2026-10-02T12:32:10.000Z' }),
    });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'K7Q2M9XA');
    await user.click(await screen.findByRole('button', { name: 'CHECK-IN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vé đã được sử dụng lúc 19:32.');
    expect(screen.queryByRole('button', { name: 'CHECK-IN' })).not.toBeInTheDocument();
  });

  it('CHECKIN_NOT_ALLOWED khi check-in (hết khung giờ giữa lúc tra cứu và bấm): hiện lý do bằng tiếng Việt', async () => {
    backend({
      lookup: () => ok({ order: order(), canCheckIn: true }),
      checkIn: () => err(422, 'CHECKIN_NOT_ALLOWED', 'x', { reason: 'TOO_LATE' }),
    });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'K7Q2M9XA');
    await user.click(await screen.findByRole('button', { name: 'CHECK-IN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Đã quá giờ check-in');
  });

  it('phim giới hạn tuổi T16/T18: nhắc nhân viên kiểm tra giấy tờ (BR-35)', async () => {
    const t16 = order();
    t16.showtime.movie.ageRating = 'T16';
    backend({ lookup: () => ok({ order: t16, canCheckIn: true }), checkIn: () => ok(t16) });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'K7Q2M9XA');
    expect(await screen.findByText(/kiểm tra giấy tờ/)).toBeInTheDocument();
  });

  it('gõ lại mã mới thì kết quả cũ biến mất (không nhầm vé trước với vé sau)', async () => {
    backend({ lookup: () => ok({ order: order(), canCheckIn: true }), checkIn: () => ok(order()) });
    const user = userEvent.setup();
    renderPage(routes, '/staff/check-in');
    await lookupFor(user, 'K7Q2M9XA');
    await screen.findByText('✅ HỢP LỆ');
    await user.type(screen.getByLabelText('Mã đặt vé hoặc nội dung mã QR'), 'X');
    await waitFor(() => expect(screen.queryByText('✅ HỢP LỆ')).not.toBeInTheDocument());
  });
});
