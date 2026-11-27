// Quản lý phòng chiếu trên trang A04 (FR-32a).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminCinemasPage from './AdminCinemasPage';
import { err, ok, renderPage } from '@/test/helpers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const A = '/api/v1/admin';
const room = (extra = {}) => ({ id: 'r1', name: 'Phòng 1', isActive: true, seatCount: 2, ...extra });
const cinemaWith = (rooms) => ({ id: 'c1', name: 'Rạp A', address: '1 X', phone: null, isActive: true, city: { id: 'ct1', name: 'Hà Nội' }, rooms });
const seatsOf = (r) => ({
  room: { id: r.id, name: r.name, cinema: { id: 'c1', name: 'Rạp A' } }, rows: ['A'],
  seats: [1, 2].map((n) => ({ id: `${r.id}-${n}`, row: 'A', number: n, label: `A${n}`, type: 'STANDARD', pairCode: null, isActive: true })),
});

/** Server giả giữ danh sách phòng, để kiểm tra giao diện làm mới sau khi thay đổi. */
function mockRooms(initial, extra = []) {
  const state = { rooms: initial, sent: [] };
  server.use(
    ...extra,
    http.get(`${A}/cinemas`, () => ok([cinemaWith(state.rooms)])),
    http.get(`${A}/rooms/:id/seats`, ({ params }) => ok(seatsOf(state.rooms.find((r) => r.id === params.id)))),
    http.post(`${A}/cinemas/c1/rooms`, async ({ request }) => {
      const body = await request.json();
      state.sent.push(['POST', body]);
      const created = room({ id: 'r9', name: body.name });
      state.rooms = [...state.rooms, created];
      return ok(created);
    }),
    http.put(`${A}/rooms/:id`, async ({ request, params }) => {
      const body = await request.json();
      state.sent.push(['PUT', body]);
      state.rooms = state.rooms.map((r) => (r.id === params.id ? { ...r, ...body } : r));
      return ok(state.rooms.find((r) => r.id === params.id));
    }),
    http.delete(`${A}/rooms/:id`, ({ params }) => {
      state.sent.push(['DELETE', params.id]);
      state.rooms = state.rooms.filter((r) => r.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}
const open = () => {
  const user = userEvent.setup();
  renderPage([{ path: '/', element: <AdminCinemasPage /> }], '/');
  return user;
};
const pickRoom = async (user, name = 'Phòng 1') => {
  await user.click(await screen.findByRole('button', { name: new RegExp(`Xem sơ đồ Rạp A ${name},`) }));
  await screen.findByRole('button', { name: 'Đổi tên' });
};

describe('AdminCinemasPage — phòng chiếu', () => {
  it('thêm phòng: gợi ý tên còn trống, gửi mẫu đã chọn, phòng mới hiện ra và được chọn', async () => {
    const state = mockRooms([room(), room({ id: 'r3', name: 'Phòng 3' })]);
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Thêm phòng cho Rạp A' }));
    expect(screen.getByLabelText('Tên phòng')).toHaveValue('Phòng 2');
    await user.selectOptions(screen.getByLabelText('Mẫu sơ đồ ghế'), 'LARGE');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(state.sent).toEqual([['POST', { name: 'Phòng 2', template: 'LARGE' }]]));
    expect(await screen.findByRole('heading', { name: 'Rạp A · Phòng 2' })).toBeInTheDocument();
  });

  it('thêm phòng trùng tên: lỗi hiện ngay ở ô tên, hộp thoại giữ nguyên; bỏ trống tên thì không gửi', async () => {
    const state = mockRooms([room()], [
      http.post(`${A}/cinemas/c1/rooms`, () => err(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', { fields: { name: 'Rạp đã có phòng tên này.' } })),
    ]);
    const user = open();
    await user.click(await screen.findByRole('button', { name: 'Thêm phòng cho Rạp A' }));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Rạp đã có phòng tên này.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Tên phòng'));
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Vui lòng nhập tên phòng')).toBeInTheDocument();
    expect(state.sent).toEqual([]);
  });

  it('đổi tên phòng: chỉ gửi name', async () => {
    const state = mockRooms([room()]);
    const user = open();
    await pickRoom(user);
    await user.click(screen.getByRole('button', { name: 'Đổi tên' }));
    await user.clear(screen.getByLabelText('Tên phòng'));
    await user.type(screen.getByLabelText('Tên phòng'), 'Phòng VIP');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(state.sent).toEqual([['PUT', { name: 'Phòng VIP' }]]));
    expect(await screen.findByRole('heading', { name: 'Rạp A · Phòng VIP' })).toBeInTheDocument();
  });

  it('⭐ ngưng phòng phải xác nhận; sau đó có nhãn "Ngưng" và mở lại được', async () => {
    const state = mockRooms([room()]);
    const user = open();
    await pickRoom(user);
    await user.click(screen.getByRole('button', { name: 'Ngưng phòng' }));
    expect(state.sent).toEqual([]); // mới mở hộp thoại, chưa gửi gì
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ngưng phòng' }));
    expect(await screen.findByRole('button', { name: /Phòng 1, 2 ghế, đã ngưng/ })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Mở lại' }));
    await waitFor(() => expect(state.sent).toEqual([['PUT', { isActive: false }], ['PUT', { isActive: true }]]));
    expect(await screen.findByRole('button', { name: 'Ngưng phòng' })).toBeInTheDocument();
  });

  it('⭐ server từ chối ngưng (còn vé đã bán): hiện lời giải thích, phòng vẫn hoạt động', async () => {
    mockRooms([room()], [http.put(`${A}/rooms/r1`, () => err(409, 'RESOURCE_IN_USE', 'Phòng còn suất sắp chiếu đã có người đặt vé.'))]);
    const user = open();
    await pickRoom(user);
    await user.click(screen.getByRole('button', { name: 'Ngưng phòng' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ngưng phòng' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Phòng còn suất sắp chiếu đã có người đặt vé.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ngưng phòng' })).toBeInTheDocument();
  });

  it('xóa phòng: xác nhận rồi mới gửi, phòng biến mất', async () => {
    const state = mockRooms([room()]);
    const user = open();
    await pickRoom(user);
    await user.click(screen.getByRole('button', { name: 'Xóa phòng' }));
    expect(state.sent).toEqual([]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText('Chưa có phòng chiếu.')).toBeInTheDocument();
    expect(state.sent).toEqual([['DELETE', 'r1']]);
    expect(screen.getByText('Chọn một phòng để xem sơ đồ ghế.')).toBeInTheDocument();
  });

  it('phòng đã từng có suất (409): không mất phòng, hiện lý do', async () => {
    mockRooms([room()], [http.delete(`${A}/rooms/r1`, () => err(409, 'RESOURCE_IN_USE', 'Phòng đã có suất chiếu nên không xóa được.'))]);
    const user = open();
    await pickRoom(user);
    await user.click(screen.getByRole('button', { name: 'Xóa phòng' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Phòng đã có suất chiếu nên không xóa được.');
    expect(screen.getByRole('heading', { name: 'Rạp A · Phòng 1' })).toBeInTheDocument();
  });
});
