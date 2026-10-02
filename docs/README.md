# Cinemind — Bộ tài liệu thiết kế

> Đề tài: **Xây dựng hệ thống đặt vé xem phim thông minh tích hợp AI Agent hỗ trợ đặt vé qua hội thoại tự nhiên**
> Trạng thái: hoàn tất giai đoạn Phân tích & Thiết kế — 02/10/2026.

## 1. Danh mục tài liệu

| File | Nội dung | Tài liệu nhà trường tương ứng |
|---|---|---|
| [01-requirements.md](./01-requirements.md) | Tác nhân, luồng nghiệp vụ, 30 yêu cầu chức năng (MoSCoW), 20 yêu cầu phi chức năng, phạm vi MVP, nhật ký quyết định | SRS |
| [02-usecases.md](./02-usecases.md) | 24 use case + sơ đồ, 30 luật nghiệp vụ, đặc tả "Đặt vé", vòng đời đơn hàng, sơ đồ tuần tự | Use case, sơ đồ tuần tự |
| [03-database.md](./03-database.md) | 23 bảng, ERD, **cơ chế giữ ghế & chống trùng ghế**, index | ERD, thiết kế CSDL |
| [schema.prisma](./schema.prisma) | Schema Prisma đầy đủ | — |
| [04-api-contract.md](./04-api-contract.md) | Quy ước, mã lỗi, ~50 endpoint, mẫu JSON, kiến trúc & cấu trúc thư mục | Thiết kế API |
| [05-ui-pages.md](./05-ui-pages.md) | 24 trang, luồng điều hướng, wireframe | Thiết kế giao diện |
| [06-project-plan.md](./06-project-plan.md) | 4 sprint, Definition of Done, quy trình Git & review | Kế hoạch dự án |
| [07-ai-hooks.md](./07-ai-hooks.md) | 14 tool cho AI Agent, lưu ngữ cảnh hội thoại, nguyên tắc an toàn | Thiết kế mở rộng |
| [08-security-review.md](./08-security-review.md) | Rà soát bảo mật backend: lỗi đã sửa (kèm số liệu trước/sau), hạn chế đã biết, danh sách kiểm tra trước khi triển khai | Chương Bảo mật |
| [09-demo-script.md](./09-demo-script.md) | Chuẩn bị dữ liệu, kịch bản demo ~12 phút, câu hỏi hội đồng hay hỏi (⭐) kèm trả lời, kế hoạch dự phòng | Kịch bản bảo vệ |
| [../CLAUDE.md](../CLAUDE.md) | Tóm tắt bối cảnh + quy tắc cho Claude Code ở bước lập trình | — |

**Còn phải viết trong lúc làm (Sprint 1–4):** test case, hướng dẫn sử dụng, README cài đặt.

## 2. Nên đọc theo thứ tự nào

| Người | Bắt buộc đọc kỹ | Đọc lướt |
|---|---|---|
| Người A — Backend | 02 (mục 5–6), **03 toàn bộ**, 04, 07 (mục 6) | 01, 05 |
| Người B — Frontend | 02 (mục 6), **04 toàn bộ**, **05 toàn bộ** | 03 (mục 1, 5), 07 |
| Cả hai, trước khi bảo vệ | 01 mục 7 (quyết định), 02 mục 6, 03 mục 5 ⭐ | — |

## 3. Năm quyết định thiết kế quan trọng nhất (để trình bày với hội đồng)

1. **Chống trùng ghế bằng ràng buộc UNIQUE của PostgreSQL** trong transaction — database làm trọng tài, không "kiểm tra rồi ghi" (`03` mục 5).
2. **Tách `SeatLock` (ai đang chiếm ghế) khỏi `OrderSeat` (lịch sử đơn)** — nhả ghế mà không mất lịch sử; xử lý được thanh toán đến muộn (`03` mục 1.2).
3. **Chỉ IPN có chữ ký mới xác nhận thanh toán**, xử lý idempotent; một thuật toán cho cả IPN đúng hạn lẫn đến muộn (`02` mục 6, `03` mục 5.7).
4. **Giá được chốt vào đơn** (phi chuẩn hóa có chủ đích) để dữ liệu lịch sử không đổi khi bảng giá đổi (BR-14).
5. **Logic nghiệp vụ chỉ nằm ở service** → AI Agent là một kênh mới gọi lại cùng service, mọi luật tự động áp dụng (`04` mục 5, `07`).

## 4. Năm rủi ro lớn nhất & cách giảm thiểu

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | **Luồng giữ ghế + thanh toán trễ** — phần khó nhất (đồng thời, transaction, VNPay) rơi vào người chưa có kinh nghiệm | Cao | Dồn vào Sprint 2; Ngày 0 thử trước một transaction Prisma nhỏ; test 50 request đồng thời; **điểm kiểm tra CN 18/10** — trễ thì cắt Should, không cắt ⭐ |
| 2 | **VNPay không hoạt động đúng lúc cần** — đăng ký sandbox chậm, IPN không gọi được `localhost`, mạng phòng bảo vệ chập chờn | Cao | Đăng ký sandbox ngay tuần này; dùng ngrok khi test thật; endpoint giả lập IPN cho phát triển & demo; quay sẵn video demo dự phòng |
| 3 | **Không đủ thời gian cho AI Agent** — tên đề tài nhấn mạnh AI nhưng chỉ còn tháng 11, trùng thời gian viết báo cáo | Cao | Giữ mốc 31/10 nghiêm ngặt; hooks đã chuẩn bị (`07`); phạm vi AI tối thiểu = tìm phim/suất → giữ ghế → gửi link thanh toán; dùng chính bộ `docs/` làm chương phân tích – thiết kế của báo cáo |
| 4 | **Ghép nối lệch hợp đồng & thiếu kinh nghiệm** (JWT refresh, Prisma, CORS/cookie) gây mất nhiều ngày gỡ lỗi | Trung bình | Mock MSW đúng JSON mẫu; ngày ghép nối giữa mỗi sprint; sửa hợp đồng trước code; dùng `CLAUDE.md` để được hướng dẫn nhất quán |
| 5 | **Hiểu hệ thống không đều giữa hai người** + tài liệu dồn cuối → lúng túng khi hội đồng hỏi chéo | Trung bình | Review chéo bắt buộc; mỗi người tự giải thích phần ⭐ cho người kia trước mỗi demo sprint; viết test case ngay khi xong tính năng |
