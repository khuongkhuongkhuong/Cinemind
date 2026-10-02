# Cinemind — Client (giao diện khách hàng / nhân viên / quản trị)

React 18 + Vite + Tailwind CSS 4 + React Router 6 + TanStack Query 5 + Axios. Dữ liệu giả bằng MSW khi chưa có backend.
Thiết kế trang: [`docs/05-ui-pages.md`](../../docs/05-ui-pages.md). Hợp đồng API: [`docs/04-api-contract.md`](../../docs/04-api-contract.md).

## 1. Chạy

Cần Node 20+ và backend đang chạy (xem [`code/server/README.md`](../server/README.md)).

```bash
cd code/client
npm install
npm run dev          # http://localhost:5173
```

Vite chuyển mọi request `/api/...` sang backend (`http://localhost:4000`), nên trình duyệt chỉ thấy **một origin**: cookie refresh token
(`httpOnly`, `SameSite=Lax`) hoạt động như khi triển khai thật và không vướng CORS. Backend ở nơi khác thì đặt `VITE_PROXY_TARGET`
(xem `.env.example`).

### Chạy không cần backend (dữ liệu giả)

```bash
# Windows PowerShell:  $env:VITE_ENABLE_MOCK="true"; npm run dev
VITE_ENABLE_MOCK=true npm run dev
```

MSW chặn request trong trình duyệt và trả JSON đúng mẫu `docs/04` (hiện có: danh mục phim, thể loại, thành phố, đăng nhập).
Tài khoản giả: `user@cinemind.vn` / `mock-12345`.

### Thử luồng đặt vé khi chưa có tài khoản VNPay

Tạo file `code/client/.env` (không commit) với `VITE_PAYMENT_SIMULATOR=true`, và bật `ENABLE_DEV_ROUTES=true` ở backend (có sẵn trong `.env.example` của backend). Khi đó nút **Thanh toán** gọi cổng giả lập của backend rồi sang trang kết quả, thay vì chuyển sang VNPay. Cờ này chỉ có tác dụng ở chế độ dev (`npm run dev`), bản build không bao giờ dùng.

## 2. Lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy máy chủ phát triển |
| `npm test` | Chạy test (Vitest + Testing Library + MSW) |
| `npm run build` | Build bản triển khai vào `dist/` |

## 3. Cấu trúc

```
src/
  api/           gọi API: axios.js (interceptor refresh token), *.api.js (mỗi nhóm endpoint một file), errors.js, tokenStore.js
  context/       AuthContext (trạng thái đăng nhập toàn ứng dụng)
  hooks/         TanStack Query: useMovies, ... và useAuth
  routes/        router.jsx (khai báo toàn bộ route), RequireAuth, RequireRole
  pages/         mỗi trang một thư mục: home/, auth/, movies/, booking/ (chọn ghế, thanh toán, kết quả), account/ (vé, hồ sơ), staff/ (soát vé), admin/ (quản trị: tổng quan doanh thu, phim, suất chiếu, rạp, bảng giá, đơn hàng, combo, khuyến mãi, banner, người dùng)
  components/    ui/ (Button, Modal, Toast...), layout/ (Header, Footer), movie/ ...
  lib/           hàm thuần: format.js (tiền, giờ VN), returnUrl.js
  mocks/         MSW: data.js, handlers.js, browser.js
```

## 4. Quy ước (bắt buộc)

- **Luồng dữ liệu:** `page → hook (TanStack Query) → api/*.api.js`. **Page không gọi Axios trực tiếp.**
- **Rẽ nhánh lỗi theo `error.code`**, không theo `message`: dùng `hasCode(err, 'SEAT_UNAVAILABLE')`, `fieldErrors(err)`, `errorMessage(err)` trong `api/errors.js`.
- **Mọi con số tiền do server tính**; giao diện chỉ hiển thị (`formatMoney`). Không tự cộng giá ở client.
- **Thời gian** server trả UTC; luôn hiển thị qua `lib/format.js` (giờ Việt Nam).
- Mỗi trang có đủ **3 trạng thái**: đang tải (Skeleton / Spinner), rỗng (`EmptyState`), lỗi (`ErrorState` có nút thử lại).
- `RequireRole` chỉ để ẩn trang cho tiện; **quyền thật do server kiểm tra** (`403`).

### Khu quản trị (`/admin/*`)
- Khung `AdminLayout` + bảng dùng chung `DataTable` (tự lo đang tải / rỗng / lỗi / phân trang) + `FormModal` / `ConfirmDialog`. Chỉ ADMIN vào được (`RequireRole`); quyền thật do server kiểm tra ở mỗi request.
- Admin nhập **giờ Việt Nam**, trình duyệt đổi sang UTC trước khi gửi (`lib/datetime.js`). Để trống giá gốc suất = server tự tra bảng giá.
- Logic biểu mẫu (kiểm tra + đổi dữ liệu ↔ body API) nằm ở `lib/adminForms.js` để test bằng Vitest thuần.
- Thao tác nhạy cảm (đổi vai trò, khóa tài khoản, hoàn tiền, xóa) đều qua hộp xác nhận; admin không tự khóa / tự đổi vai trò mình (server cũng chặn, UI chỉ ẩn nút cho tiện).
- Form chỉ khởi tạo một lần từ dữ liệu server (không dựng lại khi refetch) để không xóa chữ đang gõ dở.

### Giao diện (theme)
- Phong cách rạp chiếu thương mại: nền kem sáng, nhấn **đỏ** (`brand-*`), chữ tối, chân trang tối. Toàn bộ màu nằm ở `@theme` trong `src/index.css`; tên token `ink-*` giữ nguyên nhưng **thang đã đảo** (ink-950 = nền trang, ink-900 = thẻ trắng, ink-100 = chữ chính) — muốn đổi màu chủ đạo chỉ sửa file đó.
- Màu nhạt của Tailwind từng dùng cho chữ trên nền tối (`red-300`, `green-300`…) được gán lại tông đậm trong `@theme` để đọc được trên nền sáng.
- Phân loại độ tuổi dùng ô đặc màu + chữ (không chỉ màu); ghế VIP / đôi có nền màu riêng để phân biệt với ghế thường.

## 5. Đăng nhập hoạt động thế nào

- **Access token** (15 phút) chỉ nằm trong **bộ nhớ** (`api/tokenStore.js`), **không** ghi `localStorage` — XSS không đọc được từ kho lưu trữ.
- **Refresh token** nằm trong cookie `httpOnly` do server đặt.
- Gặp `401 TOKEN_EXPIRED` → Axios tự gọi `/auth/refresh` rồi gửi lại request. **Nhiều request hết hạn cùng lúc chỉ gọi refresh một lần**
  (server xoay vòng refresh token, gọi hai lần song song làm người dùng bị đăng xuất oan) — có test.
- **Đồng hồ đếm ngược** giữ ghế dùng giờ SERVER (suy ra từ header `Date` của mỗi response, `lib/clock.js`), không dùng đồng hồ máy người dùng — máy lệch vài phút vẫn đếm đúng.
- **Trang kết quả thanh toán chỉ ĐỌC trạng thái** từ server (hỏi mỗi 2 giây, tối đa 30 giây) và không tin tham số trên URL; chỉ IPN mới đổi đơn sang đã thanh toán.
- **Mã QR** vẽ ngay trên trình duyệt (thư viện `qrcode`), luôn đen trên nền trắng để đầu đọc quét được. Nội dung QR (`CINEMIND:<mã>`) do server cấp; trang soát vé nhận cả mã trần lẫn nội dung QR (viết hoa/thường, có hoặc không có dấu gạch đều được).
- Mở / tải lại trang: nếu trình duyệt có "dấu hiệu từng đăng nhập" (một cờ `true`, không chứa token) thì khôi phục phiên bằng cookie.
- `returnUrl` sau đăng nhập chỉ nhận đường dẫn nội bộ (`lib/returnUrl.js`) — chống chuyển hướng sang trang giả mạo.

## 6. Lỗi thường gặp

| Triệu chứng | Cách xử lý |
|---|---|
| Trang trắng, console báo lỗi mạng tới `/api` | Backend chưa chạy ở `localhost:4000` |
| Đăng nhập được nhưng tải lại trang thì bị đăng xuất | Mở bằng một origin khác (vd IP thay vì `localhost`) làm cookie không khớp; dùng đúng `http://localhost:5173` |
| `429 RATE_LIMITED` khi thử đăng nhập / đăng ký nhiều | Backend giới hạn tốc độ; đợi vài phút hoặc khởi động lại backend |
| Sau khi sửa `AuthContext.jsx` thấy lỗi "useAuth phải được dùng bên trong AuthProvider" | Chỉ xảy ra khi nạp nóng ở chế độ dev; tải lại trang (F5) |
