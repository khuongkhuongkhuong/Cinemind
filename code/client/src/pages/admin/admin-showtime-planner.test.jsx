import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminShowtimesPage from './AdminShowtimesPage';
import { axisRange, clockLabel, dateList, filmEndOf, findClashes, moviesByShowCount, parseTimes, planSlot, slotValue, startingOn, validateBulk, EMPTY_BULK } from '@/lib/showtimePlan';
import ShowtimeTimeline, { COLORS, OTHER_COLOR } from '@/components/admin/ShowtimeTimeline';
import { render } from '@testing-library/react';
import { ok, renderPage } from '@/test/helpers';

describe('showtimePlan (hàm thuần)', () => {
  const date = '2030-10-05';
  const s = (from, to) => ({ startTime: from, endTime: to });

  it('trục mặc định 08:00–24:00; nới ra khi có suất sớm hơn hoặc kéo qua nửa đêm', () => {
    expect(axisRange([], date)).toEqual({ start: 480, end: 1440 });
    // 07:30 VN = 00:30Z; suất kết thúc 02:20 VN hôm sau = 19:20Z
    expect(axisRange([s('2030-10-05T00:30:00Z', '2030-10-05T02:30:00Z'), s('2030-10-05T16:00:00Z', '2030-10-05T19:20:00Z')], date)).toEqual({ start: 420, end: 1620 });
    expect(clockLabel(1500)).toBe('01:00');
  });

  it('⭐ suất của ngày khác bị loại khỏi lịch (không để trục giờ kéo dài vô lý)', () => {
    const list = [s('2030-10-04T16:59:00Z', 'x'), s('2030-10-04T17:00:00Z', 'x'), s('2030-10-05T16:59:00Z', 'x'), s('2030-10-05T17:00:00Z', 'x')]; // 23:59 hôm trước … 00:00 hôm sau (giờ VN)
    expect(startingOn(list, date)).toEqual([list[1], list[2]]);
  });

  it('⭐ bấm chỗ trống: vị trí -> giờ Việt Nam tròn 5 phút, kể cả sau nửa đêm', () => {
    const range = { start: 480, end: 1440 };
    expect(slotValue(0, range, date)).toBe('2030-10-05T08:00');
    expect(slotValue(0.5, range, date)).toBe('2030-10-05T16:00');
    expect(slotValue(0.5043, range, date)).toBe('2030-10-05T16:00'); // 16:04 làm tròn xuống
    expect(slotValue(1.5, { start: 480, end: 1560 }, date)).toBe('2030-10-06T02:00');
  });

  it('⭐ giờ kết thúc = thời lượng, phòng trống lại sau thêm 15 phút; nối đuôi không tính là trùng', () => {
    const slot = planSlot('2030-10-05T08:00', 135);
    expect(slot).toEqual({ start: '2030-10-05T01:00:00.000Z', filmEnd: '2030-10-05T03:15:00.000Z', roomFree: '2030-10-05T03:30:00.000Z' });
    expect(planSlot('', 135)).toBeNull();
    expect(planSlot('2030-10-05T08:00', undefined)).toBeNull();
    const at = (from, to) => ({ id: from, startTime: `2030-10-05T${from}:00Z`, endTime: `2030-10-05T${to}:00Z` });
    expect(findClashes([at('03:30', '05:00'), at('00:00', '01:00')], slot)).toEqual([]); // nối đuôi hai phía
    expect(findClashes([at('00:00', '01:05'), at('03:25', '05:00')], slot).map((s) => s.id)).toEqual(['00:00', '03:25']);
  });

  it('giờ phim kết thúc = endTime trừ 15 phút dọn phòng; phim nhiều suất đứng trước', () => {
    expect(filmEndOf({ endTime: '2030-10-05T03:30:00.000Z' })).toBe('2030-10-05T03:15:00.000Z');
    const of = (...ids) => ids.map((id) => ({ movie: { id } }));
    expect(moviesByShowCount(of('c', 'b', 'a', 'b', 'c', 'c'))).toEqual(['c', 'b', 'a']);
  });

  it('đọc giờ gõ tay: nhiều cách viết, bỏ trùng, báo giờ sai', () => {
    expect(parseTimes('9:00, 13h30  19.45;09:00')).toEqual({ times: ['09:00', '13:30', '19:45'], invalid: [] });
    expect(parseTimes('25:00 abc 10:70').invalid).toEqual(['25:00', 'abc', '10:70']);
  });

  it('danh sách ngày gồm cả hai đầu, qua tháng; ngược thứ tự thì rỗng; quá 31 ngày bị chặn', () => {
    expect(dateList('2030-10-30', '2030-11-02')).toEqual(['2030-10-30', '2030-10-31', '2030-11-01', '2030-11-02']);
    expect(dateList('2030-11-02', '2030-10-30')).toEqual([]);
    const base = { ...EMPTY_BULK, movieId: 'm', roomId: 'r', times: '09:00' };
    expect(validateBulk({ ...base, from: '2030-10-01', to: '2030-10-31' })).toEqual({});
    expect(validateBulk({ ...base, from: '2030-10-01', to: '2030-12-01' }).to).toMatch(/Tối đa 31/);
    expect(Object.keys(validateBulk(EMPTY_BULK)).sort()).toEqual(['from', 'movieId', 'roomId', 'times', 'to']);
  });
});

// ------------------------------------------------------------------ TRANG
const A = '/api/v1';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

const meta = { page: 1, pageSize: 100, total: 1, totalPages: 1 };
const cinemas = [
  { id: 'c1', name: 'Rạp A', address: '1', city: { id: 'x', name: 'HN' }, isActive: true, rooms: [{ id: 'r1', name: 'Phòng 1', isActive: true, seatCount: 96 }, { id: 'r2', name: 'Phòng 2', isActive: true, seatCount: 96 }] },
  { id: 'c2', name: 'Rạp B', address: '2', city: { id: 'x', name: 'HN' }, isActive: true, rooms: [{ id: 'r9', name: 'Phòng 9', isActive: true, seatCount: 96 }] },
];
const movie = { id: 'm1', title: 'Phim thử', status: 'NOW_SHOWING', durationMin: 120, genres: [] };
const showtime = (extra = {}) => ({
  id: 's1', startTime: '2030-10-05T11:30:00.000Z', endTime: '2030-10-05T13:45:00.000Z', format: 'F2D', audio: 'SUBTITLE', basePrice: 80000, status: 'OPEN',
  movie: { id: 'm1', title: 'Phim thử' }, cinema: { id: 'c1', name: 'Rạp A' }, room: { id: 'r1', name: 'Phòng 1' }, bookedSeats: 0, ...extra,
});

function backend(items = [showtime()]) {
  const queries = [];
  server.use(
    http.get(`${A}/admin/cinemas`, () => ok(cinemas)),
    http.get(`${A}/admin/movies`, () => ok([movie], meta)),
    http.get(`${A}/admin/showtimes`, ({ request }) => { queries.push(Object.fromEntries(new URL(request.url).searchParams)); return ok(items, meta); }),
  );
  return queries;
}
const open = () => renderPage([{ path: '/', element: <AdminShowtimesPage /> }], '/');
const pickDate = (value) => fireEvent.change(screen.getByLabelText('Ngày'), { target: { value } });

describe('Lịch theo phòng (FR-31a)', () => {
  it('mặc định hiện timeline của rạp đầu tiên: đủ các phòng, suất là khối đọc được; đổi rạp / ngày thì tải lại', async () => {
    const queries = backend([showtime({ bookedSeats: 4 }), showtime({ id: 's2', status: 'CANCELLED', movie: { id: 'm2', title: 'Phim đã hủy' } })]);
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole('group', { name: 'Lịch Phòng 2' })).toBeInTheDocument();
    pickDate('2030-10-05');
    const block = await screen.findByRole('button', { name: 'Phim thử, 18:30–20:30, dọn phòng đến 20:45, 4 ghế đã đặt' });
    expect(within(screen.getByRole('group', { name: 'Lịch Phòng 1' })).getByRole('button')).toBe(block);
    expect(screen.queryByText('Phim đã hủy')).not.toBeInTheDocument();
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ cinemaId: 'c1', date: '2030-10-05', pageSize: '100' }));

    await user.click(screen.getByRole('button', { name: 'Ngày sau →' }));
    await waitFor(() => expect(queries.at(-1).date).toBe('2030-10-06'));
    await user.selectOptions(screen.getByLabelText('Rạp'), 'c2');
    await waitFor(() => expect(queries.at(-1).cinemaId).toBe('c2'));
    expect(await screen.findByRole('group', { name: 'Lịch Phòng 9' })).toBeInTheDocument();
  });

  it('⭐ bấm chỗ trống mở form thêm suất, điền sẵn phòng và giờ ở vị trí bấm', async () => {
    backend([]);
    open();
    const track = await screen.findByRole('group', { name: 'Lịch Phòng 2' });
    pickDate('2030-10-05');
    const row = await screen.findByRole('group', { name: 'Lịch Phòng 2' });
    row.getBoundingClientRect = () => ({ left: 0, width: 1600 });
    fireEvent.click(row, { clientX: 800 }); // giữa trục 08:00–24:00
    expect(await screen.findByLabelText('Giờ chiếu (giờ Việt Nam)')).toHaveValue('2030-10-05T16:00');
    await waitFor(() => expect(screen.getByLabelText('Phòng chiếu')).toHaveValue('r2'));
    expect(track).toBeDefined();
  });

  it('nút "+" của phòng mở form chỉ điền sẵn phòng; bấm khối suất mở form sửa có nút hủy và cảnh báo đã có khách', async () => {
    backend([showtime({ bookedSeats: 2 })]);
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Lịch Phòng 1' });
    pickDate('2030-10-05');
    await screen.findByRole('button', { name: /Phim thử, / });
    await user.click(screen.getByRole('button', { name: 'Thêm suất cho Phòng 2' }));
    await waitFor(() => expect(screen.getByLabelText('Phòng chiếu')).toHaveValue('r2'));
    expect(screen.getByLabelText('Giờ chiếu (giờ Việt Nam)')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Hủy' }));

    await user.click(screen.getByRole('button', { name: /Phim thử, / }));
    expect(await screen.findByText(/2 ghế đã đặt nên không sửa/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hủy suất này' }));
    expect(await screen.findByText('Hủy suất chiếu?')).toBeInTheDocument();
  });
});

describe('Khối trên lịch: màu và phần dọn phòng', () => {
  const room = { id: 'r1', name: 'Phòng 1', isActive: true };
  // phim m0 có 2 suất, các phim còn lại 1 suất
  const many = (n) => Array.from({ length: n + 1 }, (_, i) => {
    const m = i === n ? 0 : i;
    const start = Date.parse('2030-10-05T01:00:00Z') + i * 30 * 60_000;
    return showtime({
      id: `s${i}`, movie: { id: `m${String(m).padStart(2, '0')}`, title: `Phim ${m}` },
      startTime: new Date(start).toISOString(), endTime: new Date(start + 25 * 60_000).toISOString(),
    });
  });
  const colorClasses = (el) => [...el.classList].filter((c) => /^(bg|border)-[a-z]+(-\d+)?$/.test(c) && c !== 'border-l-4').join(' ');
  const draw = (items) => {
    render(<ShowtimeTimeline rooms={[room]} showtimes={items} date="2030-10-05" onAdd={() => {}} onOpen={() => {}} />);
    return new Map(screen.getAllByRole('button', { name: /^Phim / }).map((b) => [b.getAttribute('aria-label').split(',')[0], colorClasses(b)]));
  };

  it('⭐ tới 16 phim thì mỗi phim một màu khác nhau', () => {
    const colors = draw(many(16));
    expect(colors.size).toBe(16);
    expect(new Set(colors.values()).size).toBe(16);
  });

  it('hơn 16 phim: phim nhiều suất giữ màu riêng, phim ngoài 16 để nền trắng', () => {
    const colors = draw(many(18));
    expect(colors.get('Phim 0')).toBe(COLORS[0]);
    expect([...colors.values()].filter((c) => c === OTHER_COLOR)).toHaveLength(2);
    expect(new Set(colors.values()).size).toBe(17);
  });

  it('phần sọc dọn phòng dài đúng 15 phút trong khối', () => {
    draw([showtime()]); // khối 18:30–20:45 = 135 phút
    expect(parseFloat(screen.getByTestId('cleaning').style.width)).toBeCloseTo((15 / 135) * 100, 3);
  });
});

describe('Form một suất: giờ kết thúc và cảnh báo trùng', () => {
  const fill = async (start) => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Lịch Phòng 1' });
    await user.click(screen.getByRole('button', { name: '+ Thêm suất chiếu' }));
    await screen.findByRole('option', { name: 'Phim thử' });
    await user.selectOptions(screen.getByLabelText('Phim'), 'm1');
    await user.selectOptions(screen.getByLabelText('Phòng chiếu'), 'r1');
    fireEvent.change(screen.getByLabelText('Giờ chiếu (giờ Việt Nam)'), { target: { value: start } });
    return user;
  };

  it('⭐ chọn phim + giờ thì thấy ngay giờ kết thúc; đè lên suất đã có thì cảnh báo trước khi lưu', async () => {
    const queries = backend([showtime()]); // đã có 18:30–20:45
    await fill('2030-10-05T17:00');
    expect(await screen.findByText(/Phim kết thúc/)).toHaveTextContent('Phim kết thúc 19:00 · phòng trống lại lúc 19:15');
    expect(await screen.findByRole('alert')).toHaveTextContent('Trùng với "Phim thử" 18:30–20:30 (dọn đến 20:45)');
    expect(queries.at(-1)).toMatchObject({ roomId: 'r1', date: '2030-10-05' });

    // đổi sang giờ nối ngay trước suất đó: hết cảnh báo, vẫn liệt kê suất đã có
    fireEvent.change(screen.getByLabelText('Giờ chiếu (giờ Việt Nam)'), { target: { value: '2030-10-05T16:15' } });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(within(await screen.findByRole('list', { name: 'Suất đã có của phòng' })).getByText('18:30–20:30')).toBeInTheDocument();
  });

  it('suất qua nửa đêm ghi "hôm sau"; phòng trống thì báo chưa có suất', async () => {
    backend([]);
    await fill('2030-10-05T23:00');
    expect(await screen.findByText(/Phim kết thúc/)).toHaveTextContent('phòng trống lại lúc 01:15 (hôm sau)');
    expect(await screen.findByText(/Phòng chưa có suất nào ngày/)).toBeInTheDocument();
  });

  it('sửa suất: chính nó không bị tính là trùng', async () => {
    backend([showtime()]);
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Lịch Phòng 1' });
    pickDate('2030-10-05');
    await user.click(await screen.findByRole('button', { name: /Phim thử, / }));
    expect(await screen.findByText(/Phòng chưa có suất nào ngày/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Tạo hàng loạt (FR-31b)', () => {
  const preview = {
    dryRun: true, okCount: 1, skippedCount: 1,
    items: [
      { date: '2030-10-05', time: '09:00', endTime: '2030-10-05T04:15:00Z', basePrice: 70000, result: 'OK', conflict: null },
      { date: '2030-10-05', time: '13:30', endTime: '2030-10-05T08:45:00Z', basePrice: 70000, result: 'OVERLAP', conflict: { showtimeId: 'x', movieTitle: 'Phim khác', startTime: '2030-10-05T06:00:00Z', endTime: '2030-10-05T08:00:00Z' } },
    ],
  };
  const setup = async () => {
    backend([]);
    const bodies = [];
    server.use(http.post(`${A}/admin/showtimes/bulk`, async ({ request }) => {
      const body = await request.json();
      bodies.push(body);
      return ok(body.dryRun ? preview : { ...preview, dryRun: false });
    }));
    const user = userEvent.setup();
    open();
    await screen.findByRole('group', { name: 'Lịch Phòng 1' });
    await user.click(screen.getByRole('button', { name: 'Tạo hàng loạt' }));
    await user.selectOptions(await screen.findByLabelText('Phim'), 'm1');
    await user.selectOptions(screen.getByLabelText('Phòng chiếu'), 'r1');
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '2030-10-05' } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '2030-10-06' } });
    await user.type(screen.getByLabelText('Các giờ chiếu (giờ Việt Nam)'), '13h30, 9:00');
    return { user, bodies };
  };

  it('⭐ phải xem trước mới tạo được; xem trước gửi dryRun, hiện suất trùng; bấm tạo gửi đúng body', async () => {
    const { user, bodies } = await setup();
    expect(screen.getByRole('button', { name: 'Tạo suất' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Xem trước' }));
    expect(await screen.findByText('Tạo được 1 suất, bỏ qua 1.')).toBeInTheDocument();
    expect(screen.getByText(/Trùng suất "Phim khác" 13:00–14:45 \(dọn đến 15:00\)/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '09:00–11:00' })).toBeInTheDocument();
    expect(bodies[0]).toEqual({ movieId: 'm1', roomId: 'r1', dates: ['2030-10-05', '2030-10-06'], times: ['09:00', '13:30'], format: 'F2D', audio: 'SUBTITLE', dryRun: true });

    await user.click(screen.getByRole('button', { name: 'Tạo 1 suất' }));
    expect(await screen.findByText(/Đã tạo 1 suất chiếu, bỏ qua 1/)).toBeInTheDocument();
    expect(bodies[1]).toEqual({ ...bodies[0], dryRun: false });
    expect(screen.queryByText('Tạo suất chiếu hàng loạt')).not.toBeInTheDocument();
  });

  it('sửa bất kỳ ô nào sau khi xem trước thì bản xem trước bị bỏ, không tạo nhầm', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Xem trước' }));
    await screen.findByRole('button', { name: 'Tạo 1 suất' });
    await user.type(screen.getByLabelText('Các giờ chiếu (giờ Việt Nam)'), ', 20:00');
    expect(screen.getByRole('button', { name: 'Tạo suất' })).toBeDisabled();
  });

  it('giờ gõ sai: báo lỗi ngay, không gọi server', async () => {
    const { user, bodies } = await setup();
    await user.type(screen.getByLabelText('Các giờ chiếu (giờ Việt Nam)'), ', 99:99');
    await user.click(screen.getByRole('button', { name: 'Xem trước' }));
    expect(await screen.findByText(/Giờ không hợp lệ: 99:99/)).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });
});
