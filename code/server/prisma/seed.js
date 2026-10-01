// Dữ liệu mẫu cho dev/demo. Chạy: npm run db:seed (XÓA dữ liệu cũ rồi nạp lại).
import { readFileSync } from 'node:fs';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/prisma.js';
import { removeAccents, slugify } from '../src/lib/text.js';

if (process.env.NODE_ENV === 'production') throw new Error('Không chạy seed trên production.');

const readJson = (name) => JSON.parse(readFileSync(new URL(`./seed-data/${name}`, import.meta.url), 'utf8'));
const DEMO_PASSWORD = 'Cinemind@123'; // chỉ dùng cho tài khoản demo
const VN_OFFSET_H = 7; // giờ Việt Nam = UTC+7; DB lưu UTC

// ---- 1. Xóa sạch theo thứ tự phụ thuộc (bảng con trước, bảng cha sau) ----
async function wipe() {
  const order = [
    'seatLock', 'payment', 'orderCombo', 'orderSeat', 'order', 'chatMessage', 'chatSession',
    'refreshToken', 'showtime', 'seat', 'room', 'cinema', 'city', 'movieGenre', 'movie', 'genre',
    'combo', 'promotion', 'banner', 'priceRule', 'seatTypeSurcharge', 'user',
  ];
  for (const model of order) await prisma[model].deleteMany();
}

// ---- 2. Người dùng mẫu ----
async function seedUsers() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await prisma.user.createMany({
    data: [
      { email: 'admin@cinemind.vn', fullName: 'Quản trị viên', role: 'ADMIN', passwordHash },
      { email: 'staff@cinemind.vn', fullName: 'Nhân viên soát vé', role: 'STAFF', passwordHash },
      { email: 'user@cinemind.vn', fullName: 'Khách hàng mẫu', role: 'USER', phone: '0900000000', passwordHash },
    ],
  });
}

// ---- 3. Bảng giá (BR-12, BR-13) ----
async function seedPricing() {
  await prisma.priceRule.createMany({
    data: [
      { format: 'F2D', dayType: 'WEEKDAY', basePrice: 75000 },
      { format: 'F2D', dayType: 'WEEKEND', basePrice: 90000 },
      { format: 'F3D', dayType: 'WEEKDAY', basePrice: 100000 },
      { format: 'F3D', dayType: 'WEEKEND', basePrice: 120000 },
      { format: 'IMAX', dayType: 'WEEKDAY', basePrice: 140000 },
      { format: 'IMAX', dayType: 'WEEKEND', basePrice: 160000 },
    ],
  });
  await prisma.seatTypeSurcharge.createMany({
    data: [
      { seatType: 'STANDARD', surcharge: 0 },
      { seatType: 'VIP', surcharge: 15000 },
      { seatType: 'COUPLE', surcharge: 20000 }, // giá ghế đôi tính riêng theo BR-13
    ],
  });
}

// ---- 4. Phim + thể loại ----
async function seedMovies() {
  const { genres, movies } = readJson('movies.json');
  const genreRows = {};
  for (const name of genres) genreRows[name] = await prisma.genre.create({ data: { name } });

  const created = [];
  for (const { genres: gNames, releaseDate, ...m } of movies) {
    const movie = await prisma.movie.create({
      data: {
        ...m,
        slug: slugify(m.title),
        searchKey: removeAccents(m.title),
        releaseDate: new Date(releaseDate),
        genres: { create: gNames.map((g) => ({ genreId: genreRows[g].id })) },
      },
    });
    created.push(movie);
  }
  return created;
}

// ---- 5. Rạp, phòng, sơ đồ ghế ----
// 8 hàng x 12 ghế: A–C thường, D–G VIP, H ghế đôi (6 cặp, pairCode "H1-2", "H3-4"...)
function buildSeats(roomId) {
  const seats = [];
  for (const row of 'ABCDEFGH') {
    for (let number = 1; number <= 12; number++) {
      if (row === 'H') {
        const first = number % 2 === 1 ? number : number - 1;
        seats.push({ roomId, row, number, type: 'COUPLE', pairCode: `H${first}-${first + 1}` });
      } else {
        seats.push({ roomId, row, number, type: 'ABC'.includes(row) ? 'STANDARD' : 'VIP' });
      }
    }
  }
  return seats;
}

async function seedCinemas() {
  const rooms = []; // { id, cinemaIndex, roomIndex, format }
  const formats = ['F2D', 'F3D', 'IMAX'];
  let cinemaIndex = 0;
  for (const { city, cinemas } of readJson('cinemas.json')) {
    const cityRow = await prisma.city.create({ data: { name: city } });
    for (const c of cinemas) {
      const cinema = await prisma.cinema.create({ data: { ...c, cityId: cityRow.id } });
      for (let r = 0; r < 3; r++) {
        const room = await prisma.room.create({ data: { cinemaId: cinema.id, name: `Phòng ${r + 1}` } });
        await prisma.seat.createMany({ data: buildSeats(room.id) });
        rooms.push({ id: room.id, cinemaIndex, roomIndex: r, format: formats[r] });
      }
      cinemaIndex++;
    }
  }
  return rooms;
}

// ---- 6. Suất chiếu 7 ngày tới (giờ VN, lưu UTC) ----
async function seedShowtimes(movies, rooms) {
  const nowShowing = movies.filter((m) => m.status === 'NOW_SHOWING');
  const prices = await prisma.priceRule.findMany();
  const priceOf = (format, dayType) => prices.find((p) => p.format === format && p.dayType === dayType).basePrice;

  const slots = [[9, 30], [12, 30], [15, 30], [18, 30], [21, 30]]; // giờ VN; cách nhau 3h > phim dài nhất + 15' dọn
  const vnNow = new Date(Date.now() + VN_OFFSET_H * 3600_000);
  const data = [];

  for (let day = 0; day < 7; day++) {
    const d = new Date(Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate() + day));
    const dow = d.getUTCDay(); // 0 = CN
    const dayType = dow === 0 || dow === 5 || dow === 6 ? 'WEEKEND' : 'WEEKDAY'; // T6–CN
    for (const room of rooms) {
      slots.forEach(([h, min], si) => {
        const startTime = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - VN_OFFSET_H, min));
        if (startTime.getTime() < Date.now()) return; // bỏ suất đã qua của hôm nay
        const movie = nowShowing[(room.cinemaIndex * 7 + room.roomIndex * 3 + si + day) % nowShowing.length];
        const kidFriendly = movie.ageRating === 'P' || movie.ageRating === 'K';
        data.push({
          movieId: movie.id,
          roomId: room.id,
          startTime,
          endTime: new Date(startTime.getTime() + (movie.durationMin + 15) * 60_000),
          format: room.format,
          audio: kidFriendly && si % 2 === 0 ? 'DUBBED' : 'SUBTITLE',
          basePrice: priceOf(room.format, dayType),
        });
      });
    }
  }
  await prisma.showtime.createMany({ data });
  return data.length;
}

// ---- 7. Combo, khuyến mãi, banner ----
async function seedMarketing() {
  await prisma.combo.createMany({
    data: [
      { name: 'Combo Solo', description: '1 bắp vừa + 1 nước', price: 69000 },
      { name: 'Combo Đôi', description: '1 bắp lớn + 2 nước', price: 99000 },
      { name: 'Combo Gia Đình', description: '2 bắp lớn + 4 nước', price: 189000 },
      { name: 'Bắp Caramel', description: '1 bắp caramel vừa', price: 55000 },
      { name: 'Nước Ngọt Lớn', description: '1 nước ngọt 32oz', price: 35000 },
    ],
  });
  const inDays = (n) => new Date(Date.now() + n * 86_400_000);
  await prisma.promotion.createMany({
    data: [
      { code: 'CINE10', name: 'Giảm 10%', description: 'Giảm 10%, tối đa 30.000đ', discountType: 'PERCENT', discountValue: 10, maxDiscount: 30000, minOrderValue: 100000, startAt: inDays(-1), endAt: inDays(60) },
      { code: 'GIAM30K', name: 'Giảm 30.000đ', description: 'Đơn từ 200.000đ', discountType: 'FIXED', discountValue: 30000, minOrderValue: 200000, startAt: inDays(-1), endAt: inDays(60) },
      { code: 'FIRST50', name: 'Khách mới', description: 'Giảm 50.000đ, giới hạn 100 lượt', discountType: 'FIXED', discountValue: 50000, minOrderValue: 150000, startAt: inDays(-1), endAt: inDays(60), usageLimit: 100 },
    ],
  });
  await prisma.banner.createMany({
    data: [
      { title: 'Đặt vé online – Giảm 10%', imageUrl: '/banners/promo-1.jpg', sortOrder: 1 },
      { title: 'Combo Đôi chỉ 99.000đ', imageUrl: '/banners/promo-2.jpg', sortOrder: 2 },
    ],
  });
}

await wipe();
await seedUsers();
await seedPricing();
const movies = await seedMovies();
const rooms = await seedCinemas();
const showtimeCount = await seedShowtimes(movies, rooms);
await seedMarketing();
console.log(`Seed xong: ${movies.length} phim, ${rooms.length} phòng (${rooms.length * 96} ghế), ${showtimeCount} suất chiếu.`);
await prisma.$disconnect();
