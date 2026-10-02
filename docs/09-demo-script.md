# 09 — Kịch bản demo & chuẩn bị bảo vệ

> Mục đích: chạy được một buổi demo ~12 phút **không phụ thuộc may rủi**, và trả lời được các câu hỏi hội đồng hay hỏi nhất.
> Mọi lệnh chạy trong `code/server` (backend) hoặc `code/client` (frontend), trừ khi ghi khác.

## 1. Chuẩn bị (làm 1 lần, trước ngày bảo vệ)

| # | Việc | Lệnh / ghi chú |
|---|---|---|
| 1 | Cài đặt, tạo DB, áp migration | `npm install` · `npm run db:migrate` (trong `code/server` và `code/client`) |
| 2 | Bật cổng thanh toán giả lập | `code/server/.env`: `ENABLE_DEV_ROUTES=true` · `code/client/.env`: `VITE_PAYMENT_SIMULATOR=true` (chỉ chạy ở chế độ dev) |
| 3 | Nạp dữ liệu mẫu (xóa dữ liệu cũ!) | `npm run db:seed` — suất chiếu chỉ tạo cho **7 ngày kể từ lúc chạy**, nên seed lại trong **ngày bảo vệ** |
| 4 | Nạp dữ liệu demo (đơn đã bán, doanh thu) | `npm run db:demo` — 45 đơn đã thanh toán rải 14 ngày, 3 đơn hủy, 1 đơn chờ hoàn tiền |
| 5 | Chạy thử toàn bộ test | `npm test` (backend) · `npx vitest run` (frontend) — phải xanh hết |

**Trước giờ demo ~20 phút:** `npm run db:demo -- --only-live` — tạo một suất chiếu bắt đầu sau ~25 phút (trong "Phòng Demo") cùng một vé của `user@cinemind.vn`. Script in **mã vé**; ghi lại để dùng ở bước 6 (soát vé chỉ hợp lệ trong khoảng ±30 phút quanh giờ chiếu — BR-34).

**Tài khoản mẫu** (mật khẩu chung nằm ở hằng `DEMO_PASSWORD` trong `code/server/prisma/seed.js`; không ghi lại ở đây):

| Vai trò | Email |
|---|---|
| Quản trị viên | `admin@cinemind.vn` |
| Nhân viên soát vé | `staff@cinemind.vn` |
| Khách hàng | `user@cinemind.vn`, `demo1@cinemind.vn` … `demo6@cinemind.vn` |

**Mở sẵn trước khi demo:** 3 tab (hoặc 2 cửa sổ thường + 1 ẩn danh) — khách A, khách B, admin. Mỗi tab đăng nhập sẵn một tài khoản.

## 2. Kịch bản (≈12 phút)

| Phút | Bước | Nói gì / chỉ gì |
|---|---|---|
| 0–1 | **Trang chủ → Phim → chi tiết phim** | Luồng giống CGV: chọn thành phố → ngày → rạp → suất. Giờ hiển thị theo giờ Việt Nam, lưu UTC. Suất còn < 15 phút hoặc đã chiếu bị làm mờ (BR-04) do **server** quyết định. |
| 1–4 | ⭐ **Chọn ghế — hai người cùng chọn một ghế** | Tab khách A và tab khách B cùng vào một suất. A giữ ghế G7 → B bấm G7 → B nhận thông báo "ghế vừa có người chọn" và sơ đồ tự cập nhật. **Trọng tài là khóa chính `SeatLock(showtimeId, seatId)` trong DB**, không phải code "kiểm tra rồi mới ghi" (check-then-insert). Giữ ghế **tất cả hoặc không**. Ghế đôi chọn cả cặp. |
| 4–6 | **Combo + mã khuyến mãi + thanh toán** | Chọn combo, nhập mã `CINE10`. Tổng tiền do **server tính**, giá được chốt vào đơn (đổi bảng giá sau không ảnh hưởng đơn cũ). Đếm ngược 10 phút. Bấm Thanh toán → cổng giả lập. |
| 6–7 | ⭐ **Nhận vé** | Chỉ **IPN** (đã kiểm chữ ký + số tiền, idempotent) mới chuyển đơn sang `PAID`; trang kết quả chỉ đọc trạng thái. Vé có mã + QR (trang "Vé của tôi"). |
| 7–8 | **Soát vé (nhân viên)** | Tab nhân viên → `/staff/check-in` → nhập mã vé hoặc nội dung QR → hợp lệ → xác nhận. Quét **lần thứ hai** → báo vé đã dùng (check-in là **một câu cập nhật có điều kiện**, hai nhân viên quét cùng lúc chỉ một người thành công). |
| 8–10 | **Quản trị** | Tổng quan doanh thu (theo ngày / phim / rạp — chỉ tính đơn `PAID`). Suất chiếu: thử tạo suất trùng giờ cùng phòng → `SHOWTIME_OVERLAP`. Bảng giá. Đơn hàng: mở đơn **chờ hoàn tiền** → "Ghi nhận đã hoàn tiền" (hệ thống không tự chuyển tiền). |
| 10–11 | ⭐ **Phân quyền & nhật ký** | Đăng nhập khách → vào `/admin` → bị chặn (403). Admin tự khóa / hạ quyền chính mình → bị từ chối; luôn còn ≥ 1 admin. Trang **Nhật ký**: ai làm gì, lúc nào; mật khẩu không bao giờ được lưu. |
| 11–12 | **Chất lượng** | `npm test`: có test đồng thời giữ ghế (`booking.concurrency`), IPN (`payment.ipn`), phân quyền, và test **đối chiếu docs ↔ code** (`docs.conformance`). |

## 3. Câu hỏi hội đồng hay hỏi (⭐) và cách trả lời

| Câu hỏi | Trả lời ngắn | Chỉ ở đâu |
|---|---|---|
| Hai người đặt cùng một ghế thì sao? | Khóa chính `(showtimeId, seatId)` của `SeatLock` — DB chỉ cho một transaction thắng; người thua nhận `SEAT_UNAVAILABLE` và transaction của họ rollback (không giữ nửa chừng). | docs/03 mục 5; `booking.service.js`; `tests/booking.concurrency.test.js` |
| Sao không "kiểm tra ghế trống rồi mới chèn"? | Giữa hai bước đó người khác có thể chèn xen vào (race condition). Ràng buộc của DB là nơi duy nhất đảm bảo tuyệt đối. | docs/03 mục 5.8 |
| Ghế giữ quá hạn xử lý thế nào? | "Dọn lười": lượt giữ quá hạn coi như trống ngay khi đọc/giữ; cron chỉ dọn dữ liệu. Không có khoảng hở nếu cron chậm. | docs/03 mục 5.6 |
| Sao tin được là khách đã trả tiền? | Chỉ IPN của VNPay (kiểm chữ ký HMAC + số tiền khớp + idempotent) được đổi trạng thái; trang return và client không thể giả mạo. | `payment.service.js`; `tests/payment.ipn.test.js` |
| IPN đến hai lần? / đến muộn khi ghế đã bị lấy? | Idempotent (cập nhật có điều kiện, chỉ một lần thành công). Đến muộn mà ghế đã mất → đơn `REFUND_PENDING` để admin hoàn tiền thủ công. | docs/03 mục 5.7 |
| Khách tự sửa giá / số tiền được không? | Không: server tự tính mọi khoản tiền từ bảng giá, giá chốt vào `OrderSeat` / `OrderCombo`. Client chỉ hiển thị. | `pricing.service.js`, `booking.service.js` |
| Phân quyền thế nào? | JWT 15 phút + refresh 7 ngày (cookie httpOnly). Route `/admin`, `/staff` đọc **lại vai trò từ DB mỗi request** nên khóa tài khoản / hạ quyền có hiệu lực ngay. UI ẩn nút chỉ là tiện lợi. | `middlewares/auth.js` |
| Có chống lỗi bảo mật phổ biến không? | bcrypt; zod `.strict()` chống mass assignment; URL chỉ http(s)/đường dẫn nội bộ (chống XSS, open redirect); rate limit; header bảo mật; truy vấn qua Prisma (chống SQL injection). | docs/08 |
| Hạn chế còn lại? | Nêu thẳng (docs/08 mục "Hạn chế đã biết"): access token 15 phút trên route khách; rate limit trong bộ nhớ; chưa phát hiện tái sử dụng refresh token; nhật ký ghi sau phản hồi (best-effort, không atomic). | docs/08 |
| Phần AI Agent? | Mọi nghiệp vụ nằm trong `services/` nhận object, trả object, ném `AppError` — Agent gọi service như tool; `userId` luôn từ phiên đăng nhập. Thiết kế 14 tool ở docs/07. | docs/07 |

## 4. Kế hoạch dự phòng khi sự cố

| Sự cố | Xử lý |
|---|---|
| Không có tài khoản VNPay sandbox | Dùng cổng giả lập (mục 1, bước 2). Giả lập vẫn đi qua **đúng** hàm `confirmPayment` với chữ ký hợp lệ, nên vẫn kiểm cả phần kiểm chữ ký. Nói rõ với hội đồng là "giả lập VNPay", đừng nói là VNPay thật. |
| Không có suất chiếu hôm nay | Seed chỉ tạo 7 ngày: `npm run db:seed` rồi `npm run db:demo`. |
| Ghế đã bị giữ bởi lần thử trước | Đợi 10 phút hoặc chọn suất khác; hoặc `npm run db:seed` để làm lại từ đầu. |
| Vé soát vé báo "ngoài khung giờ" | Chạy lại `npm run db:demo -- --only-live` (suất mới sau 25 phút). |
| Mạng / DB chập chờn | Chạy sẵn `npm test`, chụp màn hình các bước chính làm tài liệu dự phòng. |
| Test báo ghế đã có người giữ | Rác từ lần test trước: `npm run db:clean-test`. |

## 5. Danh sách kiểm tra sáng ngày bảo vệ

- [ ] `git pull` nhánh `main`, không còn thay đổi chưa commit.
- [ ] `npm run db:seed` rồi `npm run db:demo` (và `-- --only-live` trước giờ demo ~20 phút).
- [ ] `npm test` (backend) và `npx vitest run` (frontend) đều xanh.
- [ ] Đăng nhập sẵn 3 tab: khách A, khách B, admin (+ nhân viên nếu dùng thêm thiết bị).
- [ ] Đã ghi lại mã vé của suất "live".
- [ ] Mở sẵn docs/03 mục 5, docs/08, và `tests/booking.concurrency.test.js` để chỉ khi được hỏi.
