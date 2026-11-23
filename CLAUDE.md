# CLAUDE.md — Cinemind

## Bối cảnh
- Đồ án tốt nghiệp: hệ thống đặt vé xem phim **Cinemind** (luồng giống CGV, thương hiệu riêng), giai đoạn sau tích hợp AI Agent đặt vé qua hội thoại.
- Nhóm 2 sinh viên mới học React/Node: **A = backend (`server/`)**, **B = frontend (`client/`)**. Hạn nội bộ: đặt vé xong trước 01/11/2026.
- Thiết kế đã chốt nằm trong `docs/` — **đọc tài liệu liên quan trước khi code**:
  `01-requirements` (FR/NFR) · `02-usecases` (BR, luồng đặt vé, vòng đời đơn) · `03-database` + `schema.prisma` · `04-api-contract` (API, mã lỗi, cấu trúc thư mục) · `05-ui-pages` · `06-project-plan` · `07-ai-hooks`.

> Quy ước đường dẫn: `server/`, `client/` nằm trong thư mục `code/` (docs/04 mục 5.1, v1.2).

## Tech stack (không tự đổi — đề xuất kèm lý do nếu thấy bất hợp lý)
- Client: React 18, Vite, Tailwind, React Router, TanStack Query, Axios, MSW (mock).
- Server: Node.js + Express (JavaScript, ES Modules), Prisma, PostgreSQL, zod, node-cron.
- Auth: JWT access 15 phút (header) + refresh 7 ngày (cookie httpOnly); vai trò USER / STAFF / ADMIN.
- Thanh toán: VNPay sandbox. Chưa dùng Redis.

## Quy tắc kiến trúc (bắt buộc)
- Server: `routes → controllers → services → Prisma` (không có tầng DAO từ docs/04 v1.26). Controller chỉ đọc `req`, gọi **một** service, trả `res`; **không import Prisma**. **Mỗi service phụ trách một thực thể, tên service = tên thực thể, và chỉ truy vấn bảng (model) của thực thể ấy; cần thực thể khác thì gọi hàm public của service đó.** Truy vấn nằm trong file service dưới dạng **hàm nội bộ `@internal`** (mỗi hàm một thao tác đọc/ghi, tham số cuối `db = prisma`, truyền `tx` khi trong transaction); **không file nào khác import hàm `@internal`**. Mở transaction bằng `runInTransaction` của `config/prisma.js`. Entity (mô hình Prisma) chỉ chứa dữ liệu (docs/04 mục 5.2, v1.26).
- **Toàn bộ logic nghiệp vụ ở `services/`**: nhận một object tham số (`{ userId, showtimeId, seatIds }`), trả object thuần, lỗi bằng `throw new AppError(CODE)`; không đụng `req`/`res`. Có JSDoc cho hàm public — AI Agent sẽ gọi service như tool.
- Client: `page → hook (TanStack Query) → api/*.api.js`; page không gọi Axios trực tiếp. Rẽ nhánh lỗi theo `error.code`, không theo `message`.
- Response: `{ success, data, meta? }` / `{ success: false, error: { code, message, details } }` — đúng `04-api-contract.md`.

## Bất biến cốt lõi — không được phá
- Chống trùng ghế bằng **UNIQUE `Ticket(showtimeId, occupiedSeatId)`** (docs/03 v1.3: vé HELD/SOLD có `occupiedSeatId = seatId`, vé RELEASED để NULL; chỉ `ticket.service.js` ghi cột này) trong transaction; giữ ghế "tất cả hoặc không". **Không** check-then-insert, **không** `createMany({ skipDuplicates: true })` cho Ticket.
- Vé HELD của đơn đã quá hạn coi như ghế trống (dọn lười: nhả ngay trong transaction giữ ghế) — cron chỉ để dọn dữ liệu.
- **Chỉ IPN VNPay** (đã kiểm chữ ký + số tiền, idempotent) được chuyển đơn sang `PAID`; trang return chỉ đọc trạng thái.
- Server tự tính mọi khoản tiền; giá chốt vào `Ticket`/`OrderCombo`. Tiền = `Int` VND; thời gian lưu UTC.
- Mật khẩu băm bcrypt; `userId` luôn lấy từ token, không lấy từ body.

## Quy trình
- Nhánh `feat|fix|docs|test|chore/<be|fe>-<mô-tả>` từ `main`; Conventional Commits; PR nhỏ, người kia review.
- Đổi hợp đồng API hoặc schema → **sửa `docs/` trước**, ghi lịch sử thay đổi, rồi mới sửa code.
- Ưu tiên luồng cốt lõi: chọn phim → chọn ghế → thanh toán → nhận vé. Không thêm tính năng ngoài `01-requirements.md` khi chưa được yêu cầu.

## Chế độ hướng dẫn (người dùng đang học để bảo vệ đồ án)
- Làm từng bước nhỏ; trước khi viết code cho một tính năng, nêu ngắn kế hoạch (file nào, hàm nào) và chờ đồng ý nếu thay đổi lớn.
- Sau mỗi thay đổi: giải thích **vì sao** làm vậy bằng tiếng Việt đơn giản, thuật ngữ tiếng Anh giữ nguyên.
- Với phần ⭐ (giữ ghế, IPN, phân quyền): giải thích kỹ, gợi ý người dùng tự thử trước; nêu rõ đoạn nào hội đồng dễ hỏi.
- Chỉ ra sớm rủi ro, lỗi bảo mật, chỗ lệch tài liệu thiết kế. Không âm thầm đổi thiết kế đã chốt.
- Viết test cho logic quan trọng (đặc biệt giữ ghế đồng thời và IPN).
