# Cinemind — Server

Express + Prisma + PostgreSQL. Thiết kế nằm ở `docs/` (thư mục gốc). **Hợp đồng API: `docs/04-api-contract.md`** — nếu code và tài liệu lệch nhau thì sửa tài liệu trước.

## 1. Chạy từ repo sạch

Cần: Node 20+ (đã thử trên Node 24), PostgreSQL.

1. Tạo database tên `cinemind` (pgAdmin hoặc `createdb cinemind`).
2. Cài thư viện:
   ```bash
   cd code/server
   npm install
   ```
3. Tạo file cấu hình rồi sửa:
   ```bash
   cp .env.example .env
   ```
   Trong `.env` sửa **`DATABASE_URL`** (điền mật khẩu Postgres của bạn; nếu mật khẩu có ký tự `@ : / #` thì phải mã hóa, ví dụ `@` thành `%40`) và hai **`JWT_*_SECRET`** (chuỗi ngẫu nhiên bất kỳ, ≥ 16 ký tự). `.env` đã nằm trong `.gitignore`, đừng commit.
4. Tạo bảng và nạp dữ liệu mẫu:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Chạy server:
   ```bash
   npm run dev
   ```
   Kiểm tra: mở http://localhost:4000/api/v1/health thấy `{"success":true,...}` là xong.

> `npm run db:seed` **xóa sạch dữ liệu cũ** rồi nạp lại (bị chặn khi `NODE_ENV=production`). Suất chiếu được tạo cho **7 ngày kể từ lúc chạy seed**, nên nếu để lâu thì chạy lại seed để có lịch chiếu mới.

## 2. Tài khoản demo (do seed tạo)

| Vai trò | Email |
|---|---|
| ADMIN | `admin@cinemind.vn` |
| STAFF | `staff@cinemind.vn` |
| USER | `user@cinemind.vn` |

Mật khẩu chung của ba tài khoản: xem hằng `DEMO_PASSWORD` ở đầu file [`prisma/seed.js`](prisma/seed.js). Đây chỉ là mật khẩu demo, không dùng cho môi trường thật.

Mã khuyến mãi mẫu: `CINE10` (giảm 10%, tối đa 30.000đ, đơn từ 100.000đ), `GIAM30K` (giảm 30.000đ, đơn từ 200.000đ), `FIRST50` (giảm 50.000đ, đơn từ 150.000đ, 100 lượt).

## 3. Dành cho người làm frontend (B)

- **Base URL:** `http://localhost:4000/api/v1`
- **CORS:** server chỉ chấp nhận origin trong `CLIENT_URL` (mặc định `http://localhost:5173`, cổng mặc định của Vite). Nếu frontend chạy cổng khác, sửa `CLIENT_URL` trong `.env` rồi chạy lại server.
- **Axios phải bật `withCredentials: true`** thì trình duyệt mới gửi/nhận cookie refresh token.
- **Đăng nhập:** `accessToken` trả trong body (giữ trong bộ nhớ, gửi qua header `Authorization: Bearer ...`); refresh token nằm trong cookie `httpOnly` (JavaScript không đọc được, đúng thiết kế). Gặp `401 TOKEN_EXPIRED` thì gọi `POST /auth/refresh` rồi thử lại. Mỗi lần refresh, token cũ bị thu hồi (rotation) — cookie mới do trình duyệt tự cập nhật.
- **Rẽ nhánh lỗi theo `error.code`**, không theo `message`. Bảng mã lỗi: `docs/04-api-contract.md` mục 1.2.
- **Thời gian** trả về là UTC (ISO 8601); tự đổi sang giờ Việt Nam khi hiển thị. Tham số `date` của lịch chiếu là `YYYY-MM-DD` theo giờ Việt Nam.
- **Tiền** là số nguyên VND. Server tự tính mọi khoản; đừng gửi giá lên.

### API đã sẵn sàng (chạy với dữ liệu thật)

| Nhóm | Endpoint |
|---|---|
| Xác thực | `POST /auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` · `GET /auth/me` |
| Danh mục | `GET /movies` (`status`, `q`, `genreId`, `page`) · `/movies/:slug` · `/genres` · `/cities` · `/cinemas?cityId` · `/combos` · `/banners` |
| Lịch chiếu | `GET /movies/:movieId/showtimes?date&cityId` · `/showtimes/:id` · `/showtimes/:id/seats` (sơ đồ ghế) |
| Đặt vé | `POST /orders` (giữ ghế) · `GET /orders/:id` · `PUT /orders/:id/combos` · `POST` / `DELETE /orders/:id/promotion` · `POST /orders/:id/cancel` |
| Thanh toán | `POST /orders/:id/payments` · `GET /payments/:txnRef/status` |
| Vé của tôi | `GET /me/orders?status&page` · `GET /me/orders/:code` (có `qrContent`) |
| Soát vé (STAFF/ADMIN) | `GET /staff/tickets/:code` · `POST /staff/tickets/:code/check-in` (`:code` nhận cả nội dung QR `CINEMIND:<mã>`) |

**Chưa có** (Sprint 3): `/me/profile`, `/me/password`, `/admin/*`.

### Thử luồng thanh toán khi chưa có VNPay

Khi `NODE_ENV=development` **và `ENABLE_DEV_ROUTES=true`** (cả hai đều có sẵn trong `.env.example`), có cổng giả lập để chạy trọn luồng mà không cần tài khoản VNPay. Cổng này cho phép đánh dấu một đơn là đã trả tiền mà không cần đăng nhập, nên **mặc định tắt và production từ chối khởi động nếu bật** (xem `docs/08-security-review.md`):

```
POST /api/v1/dev/payments/:txnRef/simulate     body: { "result": "SUCCESS" }   (hoặc "FAILED")
```

Luồng đầy đủ cho trang thanh toán:
1. `POST /orders` → có `order.id`, hạn giữ ghế `expiresAt` (10 phút).
2. (tuỳ chọn) `PUT /orders/:id/combos`, `POST /orders/:id/promotion`.
3. `POST /orders/:id/payments` → có `txnRef` và `paymentUrl`.
   - VNPay thật: chuyển hướng `window.location.href = paymentUrl`.
   - Giả lập: bỏ qua `paymentUrl`, gọi `simulate` ở trên.
4. Trang kết quả hỏi định kỳ `GET /payments/:txnRef/status` cho tới khi `orderStatus` là `PAID` (hoặc `FAILED`...). **Trang return chỉ đọc trạng thái**, không tự đổi đơn sang đã thanh toán — chỉ IPN (hoặc `simulate`) làm việc đó.
5. `GET /me/orders/:code` lấy vé và `qrContent` để vẽ QR.

> Đổi combo hoặc mã giảm giá **sau khi đã tạo link thanh toán** làm link cũ lệch số tiền. Khi đó hãy gọi `POST /orders/:id/payments` lại để có giao dịch mới.

### Thử nhanh bằng curl

```bash
B=http://localhost:4000/api/v1
# 1. Đăng nhập, lấy token (điền mật khẩu demo)
TOKEN=$(curl -s $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"user@cinemind.vn","password":"<DEMO_PASSWORD>"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# 2. Xem phim, lịch chiếu, sơ đồ ghế
curl -s "$B/movies?status=NOW_SHOWING&pageSize=3"
curl -s "$B/cities"
# lấy movieId, cityId rồi: curl -s "$B/movies/<movieId>/showtimes?date=YYYY-MM-DD&cityId=<cityId>"
# lấy showtimeId rồi:      curl -s "$B/showtimes/<showtimeId>/seats"

# 3. Giữ ghế (seatIds lấy từ sơ đồ ghế, ghế có status AVAILABLE)
curl -s $B/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"showtimeId":"<showtimeId>","seatIds":["<seatId1>","<seatId2>"]}'
```

## 4. Cấu trúc code

```
src/
  routes/        khai báo URL + middleware (requireAuth, requireRole, validate)
  controllers/   đọc req, gọi MỘT service, trả res — không import Prisma
  services/      TOÀN BỘ logic nghiệp vụ (nhận object thuần, trả object thuần, lỗi bằng AppError)
  validators/    schema kiểm tra dữ liệu vào (zod)
  middlewares/   auth, validate, rateLimit, errorHandler
  lib/           tiện ích kỹ thuật: jwt, password, vnpay, code, time, text
  jobs/          cron dọn đơn hết hạn (mỗi phút)
prisma/          schema, migrations, seed
tests/           test tích hợp chạy trên DB thật
```

Quy tắc kiến trúc và các bất biến cốt lõi (chống trùng ghế bằng khóa chính `SeatLock`, chỉ IPN mới đổi đơn sang `PAID`, server tự tính tiền...) nằm trong [`CLAUDE.md`](../../CLAUDE.md).

## 5. Lệnh hữu ích

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy server, tự khởi động lại khi sửa code |
| `npm test` | Chạy toàn bộ test (cần đã `db:seed`) |
| `npm run db:migrate` | Tạo/áp migration sau khi sửa schema (**sửa `docs/schema.prisma` trước!**) |
| `npm run db:seed` | Xóa và nạp lại dữ liệu mẫu |
| `npm run db:demo` | Thêm khách hàng + 45 đơn đã bán (doanh thu 14 ngày) để demo; `-- --only-live` tạo suất soát vé sau ~25 phút (xem docs/09) |
| `npm run db:studio` | Xem dữ liệu bằng giao diện web |
| `npm run db:clean-test` | Dọn dữ liệu rác nếu test bị ngắt giữa chừng |
| `npm run spike:seatlock` | Thí nghiệm chống trùng ghế bằng khóa chính |

## 6. Cấu hình bảo mật

| Biến | Ý nghĩa |
|---|---|
| `ENABLE_DEV_ROUTES` | `true` để bật cổng giả lập thanh toán khi dev/demo. Mặc định tắt |
| `TRUST_PROXY` | Số bước nhảy proxy tin cậy (vd `1` khi chạy sau Nginx) để giới hạn tốc độ tính đúng IP khách |
| `NODE_ENV=production` | Kích hoạt kiểm tra khởi động: secret ≥ 32 ký tự, khác nhau, không phải giá trị mẫu; `CLIENT_URL` HTTPS; đủ cấu hình VNPay thật; không bật cổng giả lập |

Danh sách kiểm tra trước khi triển khai: `docs/08-security-review.md` mục 5.

## 7. Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `P1000 Authentication failed` | Sai mật khẩu trong `DATABASE_URL` |
| `P1001 Can't reach database` | PostgreSQL chưa chạy, hoặc sai cổng |
| Trình duyệt báo CORS | `CLIENT_URL` trong `.env` chưa khớp địa chỉ frontend (cả cổng) |
| Đăng nhập được nhưng refresh `401` | Axios chưa bật `withCredentials: true` |
| Gọi `/dev/...` bị 404 | Chưa đặt `ENABLE_DEV_ROUTES=true` (hoặc `NODE_ENV` không phải `development`) |
| Không có suất chiếu hôm nay | Seed chỉ tạo 7 ngày kể từ lúc chạy; chạy lại `npm run db:seed` |
| `npm test` báo ghế đã có người giữ | Có dữ liệu rác từ lần test trước: `npm run db:clean-test` |
