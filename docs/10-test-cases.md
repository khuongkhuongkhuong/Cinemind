# 10 — Bảng test case (đối chiếu yêu cầu ↔ kiểm thử)

> Phiên bản: 1.0 — 29/10/2026 · Hệ thống: **Cinemind**
> Mục đích: với **mỗi** yêu cầu (FR / NFR / BR) chỉ ra *kiểm bằng cái gì* và *kết quả lần chạy gần nhất*. Hội đồng hỏi "yêu cầu X đã được kiểm chưa?" thì mở bảng này.
>
> **Cách chạy lại:** `npm run db:seed` → `npm test` (trong `code/server`) · `npx vitest run` (trong `code/client`).
> **Kết quả lần chạy 29/10/2026:** backend **197/197** · frontend **328/328** · build production thành công.
> Lưu ý: test backend cần dữ liệu mẫu còn suất chiếu sắp tới (seed chỉ tạo 7 ngày). Hết hạn thì chạy lại `db:seed`.

Quy ước cột "Cách kiểm": **A** = test tự động (tên file trong `code/server/tests/` hoặc `code/client/src/`), **T** = thử tay trên trình duyệt (kịch bản ở `docs/09`), **Đo** = có số liệu đo, **—** = chưa làm (đúng phạm vi: mức Could).

## 1. Yêu cầu chức năng (FR)

### 1.1 Khách hàng

| Mã | Yêu cầu | Cách kiểm | Kết quả |
|---|---|---|---|
| FR-01 | Danh sách phim đang chiếu / sắp chiếu | A `catalog.test.js` · client `lib/movies.test.js` | Đạt |
| FR-02 | Chi tiết phim | A `catalog.test.js` · T | Đạt |
| FR-03 | Lịch chiếu theo phim → thành phố → rạp → ngày | A `showtime.test.js` (nhóm rạp → định dạng; ngày sai → 400) · T | Đạt |
| FR-04 | Tìm / lọc phim (không dấu) | A `catalog.test.js` | Đạt |
| FR-05 | Lịch chiếu theo rạp | A `admin.cinema.crud.test.js` (nhóm theo phim, rạp tắt → 404) · client `pages/cinemas/cinemas-audit.test.jsx` | Đạt |
| FR-06 | Banner trang chủ | A `catalog.test.js`, `admin.pricing.test.js` (URL banner an toàn) · T | Đạt |
| FR-10 | Đăng ký / đăng nhập / đăng xuất (JWT + refresh) | A `auth.test.js` · client `context/AuthContext.test.jsx`, `api/axios.test.js`, `routes/guards.test.jsx`, `lib/returnUrl.test.js` | Đạt |
| FR-11 ⭐ | Chọn ghế, giữ ghế có thời hạn | A `booking.concurrency.test.js` (50 người giành ghế → đúng 1 thắng), `order.lifecycle.test.js` · client `lib/seats.test.js` · T (2 trình duyệt) | Đạt |
| FR-12 | Chọn combo | A `combo.promo.test.js` · client `pages/booking/*.test.jsx` | Đạt |
| FR-13 | Mã khuyến mãi | A `combo.promo.test.js` (`PROMO_INVALID` kèm lý do) | Đạt |
| FR-14 ⭐ | Thanh toán VNPay | A `payment.ipn.test.js` · client `payment-result.test.jsx` · **cổng giả lập** (chưa chạy với VNPay sandbox thật) | Đạt (giả lập) |
| FR-15 | Vé của tôi, chi tiết, QR | A `me.orders.test.js` · client `lib/tickets.test.js`, `pages/account/account-pages.test.jsx` | Đạt |
| FR-16 | Hồ sơ, đổi mật khẩu | A `me.profile.test.js` · client `account-pages.test.jsx` | Đạt |
| FR-17 | Tích điểm | A `payment.ipn.test.js` (cộng điểm đúng một lần) | Đạt |
| FR-18 | Quên mật khẩu / email gửi vé | — (mức Could) | Chưa làm |

### 1.2 Nhân viên

| Mã | Yêu cầu | Cách kiểm | Kết quả |
|---|---|---|---|
| FR-20 | Tra cứu vé bằng mã | A `staff.checkin.test.js` · client `pages/staff/staff-checkin.test.jsx` | Đạt |
| FR-21 | Check-in (chặn vé đã dùng, sai suất, ngoài khung giờ) | A `staff.checkin.test.js` (10 check-in cùng lúc → 1 thành công) | Đạt |
| FR-22 | Quét QR bằng camera | — (mức Could; nhập tay / máy đọc QR kiểu bàn phím) | Chưa làm |

### 1.3 Quản trị

| Mã | Yêu cầu | Cách kiểm | Kết quả |
|---|---|---|---|
| FR-30 | Quản lý phim | A `admin.movie.test.js` · client `pages/admin/admin-pages.test.jsx` | Đạt |
| FR-31 ⭐ | Suất chiếu, chặn trùng phòng + giờ | A `admin.showtime.test.js` (trùng giờ, đồng thời, sửa/hủy suất đã bán) | Đạt |
| FR-32 | Rạp, phòng, sơ đồ ghế | A `admin.cinema.test.js`, `admin.cinema.crud.test.js` | Đạt (phòng / ghế: seed) |
| FR-33 | Bảng giá | A `admin.pricing.test.js`, `pricing.test.js` | Đạt |
| FR-34 | Danh sách đơn hàng, vé | A `admin.order.test.js` | Đạt |
| FR-35 | Combo, khuyến mãi | A `admin.catalog.test.js` · client `pages/admin/admin-extras.test.jsx` | Đạt |
| FR-36 | Tài khoản, phân quyền | A `admin.user.test.js` (luôn còn ≥ 1 admin, không tự khóa mình) | Đạt |
| FR-37 | Báo cáo doanh thu | A `admin.report.test.js` | Đạt |
| FR-38 | Banner | A `admin.pricing.test.js` · client `admin-extras.test.jsx` | Đạt |
| FR-39 | Nhật ký thao tác | A `audit.test.js` (không lưu mật khẩu, chỉ ghi thao tác thành công) | Đạt |

### 1.4 Hệ thống

| Mã | Yêu cầu | Cách kiểm | Kết quả |
|---|---|---|---|
| FR-40 ⭐ | Tự giải phóng ghế hết hạn | A `order.lifecycle.test.js` (`expirePendingOrders`), `booking.concurrency.test.js` (hết hạn coi như trống, không cần chờ cron) | Đạt |
| FR-41 ⭐ | IPN, xác nhận đúng một lần | A `payment.ipn.test.js` (chữ ký sai, sai số tiền, lặp 10 lần đồng thời, đến muộn) | Đạt |
| FR-42 | Mã vé và QR | A `me.orders.test.js` (`qrContent`), `staff.checkin.test.js` · client `lib/tickets.test.js` | Đạt |

## 2. Yêu cầu phi chức năng (NFR)

| Mã | Yêu cầu | Cách kiểm | Kết quả |
|---|---|---|---|
| NFR-01 ⭐ | Một ghế tối đa 1 lượt giữ | A `booking.concurrency.test.js` (50 request đồng thời) | Đạt |
| NFR-02 ⭐ | Giữ nhiều ghế "tất cả hoặc không" | A `booking.concurrency.test.js` (xin B1+B2+B3 khi B3 bị giữ → B1, B2 không bị giữ) | Đạt |
| NFR-03 ⭐ | IPN idempotent | A `payment.ipn.test.js` | Đạt |
| NFR-04 | Server là nguồn thời hạn; client chỉ hiển thị | A `booking.concurrency.test.js` · client `lib/clock.test.js` (bù lệch đồng hồ) | Đạt |
| NFR-05 | Mật khẩu băm bcrypt, không trả về | A `auth.test.js` | Đạt |
| NFR-06 | Giá luôn tính ở server | A `booking.concurrency.test.js` (giá chốt vào đơn), `combo.promo.test.js`, `pricing.test.js` | Đạt |
| NFR-07 | Kiểm chữ ký + số tiền VNPay | A `payment.ipn.test.js` | Đạt |
| NFR-08 | Access 15 phút / refresh 7 ngày; phân quyền ở server | A `auth.test.js`, `security.test.js`, `docs.conformance.test.js` (route ADMIN/STAFF đúng quyền) | Đạt |
| NFR-09 | Validate đầu vào; giới hạn đăng nhập sai | A `security.test.js` (rate limit, mass assignment, body quá lớn), mọi `admin.*.test.js` (400) | Đạt |
| NFR-10 | p95 lịch chiếu / sơ đồ ghế < 500 ms với 100 người dùng | **Đo** 29/10: 100 người dùng đồng thời × 3.000 request, 0 lỗi — p95 lịch chiếu **333 ms**, sơ đồ ghế **247 ms**, chi tiết suất **111 ms** (máy dev, 1 tiến trình) | Đạt |
| NFR-11 | Trang chủ < 3 s trên 4G | T — chưa đo trên bản build đã triển khai (cần Lighthouse) | Chưa đo |
| NFR-12 | Sơ đồ ghế tự làm mới 10–15 s | T (2 tab: ghế giữ ở tab A hiện ở tab B) · client `lib/seats.test.js` (gỡ ghế vừa mất khỏi lựa chọn) | Đạt |
| NFR-13 | Hết hạn không chặn dù cron chưa chạy | A `booking.concurrency.test.js` | Đạt |
| NFR-14 | Đơn vẫn xác nhận khi đóng tab | A `payment.ipn.test.js` (IPN không cần phiên người dùng) | Đạt |
| NFR-15 | Ghi log giao dịch thanh toán | A `payment.ipn.test.js` (bảng `Payment` lưu `txnRef`, trạng thái, số tiền) | Đạt |
| NFR-16 | Responsive từ 360 px | **Đo** 29/10: 9 trang khách ở 360 px không tràn ngang; sơ đồ ghế cuộn ngang trong khung riêng | Đạt |
| NFR-17 | Lỗi tiếng Việt, chỉ rõ bước tiếp theo | A client `api/errors.test.js`, các test trang (409, 403, hết hạn…) | Đạt |
| NFR-18 | Logic ở services, controller chỉ điều phối | A **`architecture.test.js`** (server) và **`src/architecture.test.js`** (client) — quét mã nguồn, đỏ nếu controller import Prisma / service đụng `req`/`res` / page gọi Axios | Đạt |
| NFR-19 | Response thống nhất + bộ mã lỗi chuẩn | A `docs.conformance.test.js` (bảng mã lỗi docs ↔ code, endpoint docs ↔ code) | Đạt |
| NFR-20 | UTC lưu, giờ VN hiển thị; tiền Int VND | A client `lib/datetime.test.js`, `lib/format.test.js` | Đạt |

## 3. Luật nghiệp vụ (BR)

| Mã | Luật | Cách kiểm | Kết quả |
|---|---|---|---|
| BR-01 | Giữ ghế 10 phút | A `booking.concurrency.test.js` | Đạt |
| BR-02 | Tối đa 8 ghế / đơn | A `booking.concurrency.test.js` · client `lib/seats.test.js` | Đạt |
| BR-03 | Một đơn PENDING mỗi người; tạo mới thì hủy cũ (rollback nếu giữ mới thất bại) | A `booking.concurrency.test.js` | Đạt |
| BR-04 | Ngừng bán 15 phút trước giờ chiếu | A `booking.concurrency.test.js`, `showtime.test.js` | Đạt |
| BR-05 | Ghế đôi đủ cặp | A `booking.concurrency.test.js` · client `lib/seats.test.js` | Đạt |
| BR-06 | Không để trống ghế lẻ | — (Could, ngoài MVP) | Chưa làm |
| BR-07 | Tự hủy đơn trước thanh toán, nhả ghế | A `order.lifecycle.test.js` | Đạt |
| BR-08 | Không hủy sau thanh toán | A `order.lifecycle.test.js` | Đạt |
| BR-10…13 | Loại ghế; giá = giá gốc + phụ thu (ghế đôi tính riêng) | A `pricing.test.js`, `admin.pricing.test.js`, `showtime.test.js` | Đạt |
| BR-14, 15 | Giá chốt vào đơn; server tự tính | A `booking.concurrency.test.js`, `combo.promo.test.js` | Đạt |
| BR-20 | Combo tối đa 10 phần / loại | A `combo.promo.test.js` | Đạt |
| BR-21…24 | Khuyến mãi (% có trần / cố định), điều kiện, 1 mã / đơn, trừ lượt khi thanh toán | A `combo.promo.test.js`, `payment.ipn.test.js` | Đạt |
| BR-25 | Tích điểm | A `payment.ipn.test.js` | Đạt (không đổi điểm — đúng MVP) |
| BR-30 | Hạn thanh toán = hạn giữ ghế | A `payment.ipn.test.js` | Đạt |
| BR-31 ⭐ | IPN muộn: ghế còn → PAID; ghế mất → REFUND_PENDING | A `payment.ipn.test.js` | Đạt |
| BR-32 | Mã vé ngẫu nhiên, không tăng dần | A `code.test.js` (5.000 mã không trùng, không theo thứ tự, mã nguồn dùng `crypto.randomInt` chứ không dùng `Math.random`) | Đạt |
| BR-33 | 1 QR cho cả đơn | A `staff.checkin.test.js` | Đạt |
| BR-34 | Check-in ±30 phút (gồm đầu mút) | A `staff.checkin.test.js` | Đạt |
| BR-35 | Phân loại độ tuổi | A client `pages/staff/staff-checkin.test.jsx` · T (cảnh báo ở trang chi tiết phim) | Đạt |

## 4. Kiểm thử đã áp dụng thêm (ngoài đối chiếu yêu cầu)

| Loại | Nội dung |
|---|---|
| **Kiểm tra chất lượng test (mutation)** | Cố ý làm hỏng code rồi chạy test: kỳ vọng test **phải đỏ**. Đã làm cho các chỗ nguy hiểm: chặn tự khóa admin, chặn `//host` ở URL, bỏ chặn trùng suất, không ghi mật khẩu vào nhật ký, tắt rạp còn vé đã bán… Chỗ nào "lọt" thì bổ sung test (đã xử lý hết). |
| **Đối chiếu tài liệu ↔ code** | `docs.conformance.test.js`: mọi endpoint ghi trong docs/04 phải tồn tại, quyền đúng như bảng, bảng mã lỗi khớp `errorCodes.js`, lịch sử phiên bản liên tục. |
| **Rà soát bảo mật** | `security.test.js` + `docs/08-security-review.md` (số liệu trước / sau, hạn chế đã biết L1–L9). |
| **Tranh chấp dữ liệu (race)** | 50 người giành ghế · 10 IPN trùng đồng thời · 10 check-in cùng vé · hai admin hạ quyền lẫn nhau. Mỗi nhóm: đúng một bên thắng. |
| **Trợ năng (a11y)** | Rà tay 29/10 trên 7 trang: nhãn ô nhập, tên nút / liên kết, `alt` ảnh, một `h1`, `id` không trùng, tương phản chữ ≥ 4,5:1. Đã sửa các lỗi tìm được (h1 trang chủ, tương phản chữ đỏ / xanh / cam, huy hiệu độ tuổi, avatar). |
| **Lỗi tìm được lúc "bug bash" 29/10** | Trang kết quả thanh toán có thể **kẹt ở "Đang xác nhận"** nếu nhịp hỏi cuối rơi sát mốc 30 giây (trạng thái "chờ quá lâu" chỉ tính khi vẽ lại). Đã sửa bằng bộ hẹn giờ riêng. Bốn trang gọi tầng `api` trực tiếp (lệch quy tắc `page → hook → api`) đã chuyển qua hook, và có test canh giữ. |

## 5. Hạn chế của việc kiểm thử (nói thẳng với hội đồng)

1. **Chưa kiểm với VNPay sandbox thật** — toàn bộ luồng thanh toán dùng cổng giả lập, dù vẫn đi qua đúng hàm `confirmPayment` với chữ ký hợp lệ.
2. **Chưa đo NFR-11** (tải trang < 3 s trên 4G) và chưa chạy Lighthouse; số đo NFR-10 là trên máy phát triển, một tiến trình, chưa phải môi trường triển khai.
3. **Không có test giao diện đầu-cuối tự động** (Playwright/Cypress): luồng đặt vé trọn vẹn trên trình duyệt được kiểm tay theo kịch bản docs/09; phần giao diện còn lại được kiểm bằng test component (Testing Library + MSW).
4. **Hai test phía client nhạy với tải máy** (đồng hồ đếm ngược, kết quả thanh toán): thỉnh thoảng đỏ khi máy đang bận, chạy lại thì xanh.
