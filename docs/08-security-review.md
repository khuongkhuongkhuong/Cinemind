# 08 — Báo cáo rà soát bảo mật backend

> Phạm vi: `code/server/` (Express + Prisma + PostgreSQL), rà soát ngày 02/10/2026 sau khi hoàn tất các endpoint của hợp đồng API.
> Cách làm: (1) đọc code đối chiếu với các bất biến trong `CLAUDE.md`, (2) **thử tấn công thật** vào server đang chạy, (3) sửa, (4) viết test để lỗi không quay lại, (5) kiểm tra test bằng cách **cố tình phá code** và xem test có bắt được không.
> Tài liệu này cũng là nguồn cho chương "Bảo mật" của báo cáo đồ án.

## 1. Tóm tắt

| Nhóm | Số mục | Kết quả |
|---|---|---|
| Lỗi đã sửa trong đợt rà soát này | 7 | Có test bảo vệ, đã kiểm chứng trên server thật |
| Hạn chế đã biết, chấp nhận có chủ đích | 9 | Ghi ở mục 4 kèm lý do và hướng nâng cấp |
| Không phát hiện | — | SQL injection, JWT giả mạo, IDOR (xem mục 3) |

## 2. Các lỗi đã sửa

Số liệu "Trước" / "Sau" đo bằng cách gửi request thật tới server.

| # | Mức | Vấn đề | Trước | Sau | Cách sửa |
|---|---|---|---|---|---|
| S1 | Trung bình | Ký tự NUL (`%00`, `\u0000`) làm PostgreSQL lỗi: `GET /movies/%00` | **500** + log lỗi dài (có thể làm ngập log) | **400** | `rejectNullBytes` kiểm URL và body trước mọi route |
| S2 | Trung bình | Body quá lớn và `%xx` hỏng trong URL bị coi là lỗi hệ thống | **500** | **413** / **400**, không ghi log lỗi | `express.json({limit:'100kb'})`; error handler map lỗi 4xx của thư viện |
| S3 | Trung bình | Thiếu header bảo mật; lộ `X-Powered-By: Express`; phản hồi chứa token có thể bị cache | không có | `nosniff`, `X-Frame-Options: DENY`, CSP chặn nhúng, `no-referrer`, `Cache-Control: no-store` cho `/auth /me /orders /payments /staff /admin`, HSTS ở production | `middlewares/security.js` |
| S4 | Trung bình | Đăng ký và `/auth/refresh` không giới hạn tốc độ: tạo hàng loạt tài khoản rác | **25/25** đăng ký thành công | chặn từ lần 21 (20 lần/giờ); refresh 60 lần/15 phút | `rateLimit` trên `/auth/register`, `/auth/refresh` |
| S5 | Thấp | Bộ đếm rate limit không bao giờ dọn: mỗi IP lạ để lại một mục mãi mãi (rò rỉ bộ nhớ chậm) | Map chỉ lớn lên | dọn mục hết hạn mỗi phút (`unref` để không giữ tiến trình sống) | `middlewares/rateLimit.js` |
| S6 | **Cao nếu cấu hình sai** | Cổng giả lập thanh toán `/dev/payments/:txnRef/simulate` **không cần đăng nhập** và đánh dấu đơn là ĐÃ TRẢ TIỀN; nó bật chỉ cần `NODE_ENV=development`, mà đó lại là **giá trị mặc định** (và là giá trị trong `.env.example`) | Triển khai quên đặt `NODE_ENV` ⇒ ai cũng "mua vé miễn phí" | Phải bật **có chủ đích** bằng `ENABLE_DEV_ROUTES=true` (mặc định tắt); production từ chối khởi động nếu bật; có cảnh báo to khi bật | `config/env.js`, `routes/index.js`, `server.js` |
| S7 | Thấp | JWT chưa ghim thuật toán; production có thể chạy với secret mẫu / secret ngắn / hai secret trùng nhau | token HS512 ký đúng khóa vẫn được nhận | chỉ nhận HS256; production **từ chối khởi động** nếu secret < 32 ký tự, chứa chuỗi mẫu, trùng nhau, `CLIENT_URL` không HTTPS, thiếu hoặc dùng VNPay giả | `lib/jwt.js`, `config/env.js` (`parseEnv`) |

Bổ sung: biến `TRUST_PROXY` để giới hạn tốc độ tính đúng IP khách khi chạy sau proxy (nếu không, mọi khách dùng chung một bộ đếm).

## 3. Những gì đã kiểm tra và KHÔNG có lỗi

| Hạng mục | Cách kiểm | Kết quả |
|---|---|---|
| SQL injection | `q=' OR 1=1 --`, `genreId=1' OR '1'='1`, `%` trong tìm kiếm | Coi là từ khóa thường; chỉ dùng Prisma tham số hóa. Chỉ có 2 chỗ SQL thô (khóa tư vấn `pg_advisory_xact_lock`), một chỗ tham số hóa bằng tagged template |
| JWT giả mạo | `alg=none`, ký sai khóa, đúng khóa khác thuật toán, không phải JWT | Tất cả 401 |
| Phân quyền (IDOR, nâng quyền) | Test tự động đọc **từng endpoint trong `docs/04`** và kiểm: không token, USER, STAFF, ADMIN | Khớp 100% (`tests/docs.conformance.test.js`) |
| Mass assignment | Gửi `role`, `points`, `email`, `slug`, `usedCount` vào các `PUT/PATCH/POST` | Bị từ chối `400` nhờ `.strict()` |
| XSS qua dữ liệu admin nhập | `javascript:`, `data:`, `//evil.com` vào ảnh / trailer / link banner | Bị từ chối `400` |
| Dò người dùng (enumeration) | Đăng nhập sai email / sai mật khẩu | Cùng một lỗi `INVALID_CREDENTIALS`, và so sánh hash giả để thời gian phản hồi giống nhau |
| Lưu trữ mật khẩu / token | Đọc DB | bcrypt cho mật khẩu; refresh token chỉ lưu bản băm HMAC |
| Bí mật trong repo | `git ls-files` | Không có `.env`, khóa; chỉ `.env.example` với giá trị mẫu |
| CORS | Preflight từ origin lạ | Chỉ phản hồi origin cấu hình (`CLIENT_URL`), trình duyệt chặn origin lạ |
| Tranh chấp dữ liệu (race) | 50 người giành ghế, 10 IPN trùng, 10 check-in cùng vé, hai admin cùng hạ quyền... | Đúng một bên thắng (xem các test ⭐) |

## 4. Hạn chế đã biết (chấp nhận có chủ đích)

| # | Hạn chế | Vì sao chấp nhận | Hướng nâng cấp |
|---|---|---|---|
| L1 | Access token còn dùng được tối đa 15 phút ở route **khách hàng** sau khi tài khoản bị khóa / đổi mật khẩu (route `/admin` và `/staff` thì có hiệu lực **ngay**) | Không hỏi DB mỗi request để giữ API nhanh | Danh sách thu hồi (Redis) hoặc rút ngắn hạn token |
| L2 | Không phát hiện **tái sử dụng refresh token đã thu hồi** (dấu hiệu bị đánh cắp) để thu hồi cả chuỗi | Hai tab refresh cùng lúc sẽ bị đăng xuất oan; cần cơ chế nới lỏng phức tạp | Thêm "grace period" rồi bật phát hiện |
| L3 | Rate limit nằm trong bộ nhớ, theo IP, theo từng tiến trình; không khóa theo tài khoản | Đề tài chưa dùng Redis; một server | Redis + giới hạn theo (IP, email) |
| L4 | **Nhật ký thao tác quản trị** (bảng `AuditLog`, FR-39) đã có nhưng còn hạn chế: ghi **sau** phản hồi và nuốt lỗi (best-effort, không atomic với thay đổi dữ liệu); chỉ ghi thao tác **thành công** (không ghi lần thử bị từ chối); không chống sửa ở mức DB (người có quyền DB vẫn sửa được, chưa có chuỗi băm) | Đủ trả lời "ai làm gì, lúc nào" mà không đụng vào 25 hàm service; ghi trong cùng transaction sẽ phải sửa từng service | Ghi trong transaction của service cho các thao tác tiền (hoàn tiền, đổi giá); thêm quyền DB chỉ-thêm cho bảng `AuditLog` |
| L5 | Không có log yêu cầu / cảnh báo đăng nhập thất bại hàng loạt | Phạm vi đồ án | Ghi log có cấu trúc, đẩy vào hệ thống giám sát |
| L6 | Chính sách mật khẩu tối thiểu (≥ 8 ký tự), không kiểm tra mật khẩu bị lộ, không xác minh email | FR-18 (quên mật khẩu, email) là mức Could | Gửi email xác minh, so với danh sách mật khẩu phổ biến |
| L7 | `npm audit` báo 3 lỗ hổng mức cao, đều nằm ở **công cụ dòng lệnh Prisma** (`deepmerge-ts` khi đọc file cấu hình lúc build), không nằm trên đường xử lý request | Không bị khai thác từ bên ngoài; bản sửa là nâng cấp lớn (breaking) | Nâng Prisma ở đợt bảo trì |
| L8 | Không có token CSRF riêng | `SameSite=Lax` chặn POST chéo trang; API dùng header `Authorization`. **Nếu frontend và API khác "site" (khác tên miền gốc)** thì cookie phải đổi sang `SameSite=None; Secure` và cần thêm biện pháp CSRF | Đặt frontend và API cùng tên miền gốc |
| L9 | Khoản thu thừa (hai giao dịch cho một đơn, IPN muộn mất ghế, lệch tiền sau khi tạo link) chỉ **ghi nhận**, hoàn tiền là thủ công qua màn hình admin | Đúng BR-31 và phạm vi đồ án | Tự động gọi API hoàn tiền của VNPay |

## 5. Danh sách kiểm tra trước khi triển khai thật (production)

- [ ] Đặt `NODE_ENV=production`. Server **từ chối khởi động** nếu cấu hình nguy hiểm (xem S7), nên nếu chạy được là đã qua các kiểm tra cơ bản.
- [ ] Sinh `JWT_ACCESS_SECRET` và `JWT_REFRESH_SECRET` ngẫu nhiên, **khác nhau**, ≥ 32 ký tự; lưu trong trình quản lý bí mật, không commit.
- [ ] **Không** đặt `ENABLE_DEV_ROUTES`.
- [ ] Điền `VNP_TMN_CODE`, `VNP_HASH_SECRET`, `VNP_URL`, `VNP_RETURN_URL` thật; IPN phải là địa chỉ HTTPS công khai.
- [ ] Chạy sau reverse proxy HTTPS và đặt `TRUST_PROXY` đúng số bước nhảy.
- [ ] `CLIENT_URL` là địa chỉ HTTPS thật của frontend (cookie refresh có cờ `Secure`).
- [ ] Đổi mật khẩu của 3 tài khoản demo (hoặc xóa) — **không** chạy `npm run db:seed` trên dữ liệu thật (script tự chặn khi `NODE_ENV=production`).
- [ ] Sao lưu PostgreSQL định kỳ; giới hạn quyền user DB của ứng dụng.

## 6. Cách tái kiểm

```bash
cd code/server
npm test      # gồm security.test.js, security.devroutes.test.js, docs.conformance.test.js
```

- `tests/security.test.js` — header, NUL, 413, JWT giả mạo, cấu hình production, rate limit.
- `tests/security.devroutes.test.js` — cổng giả lập không tự bật.
- `tests/docs.conformance.test.js` — đối chiếu `docs/04` với code: mọi endpoint tồn tại, đúng yêu cầu đăng nhập / vai trò, bảng mã lỗi khớp.
