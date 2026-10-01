# Cinemind

Hệ thống đặt vé xem phim thông minh (luồng giống CGV, thương hiệu riêng), giai đoạn sau tích hợp AI Agent đặt vé qua hội thoại. Đồ án tốt nghiệp.

| Thư mục | Nội dung | Phụ trách |
|---|---|---|
| [`docs/`](docs/README.md) | Bộ tài liệu thiết kế (yêu cầu, use case, CSDL, hợp đồng API, giao diện, kế hoạch) | Cả hai |
| [`code/server/`](code/server/README.md) | Backend: Express + Prisma + PostgreSQL | Người A |
| [`code/client/`](code/client/README.md) | Frontend: React + Vite + Tailwind | Người B |
| [`CLAUDE.md`](CLAUDE.md) | Quy tắc kiến trúc và quy trình làm việc | Cả hai |

## Chạy thử nhanh

Hướng dẫn cài đặt, tài khoản demo và danh sách API: [`code/server/README.md`](code/server/README.md).

```bash
cd code/server
npm install
cp .env.example .env     # rồi sửa DATABASE_URL và JWT_*_SECRET
npm run db:migrate
npm run db:seed
npm run dev              # http://localhost:4000/api/v1/health

cd ../client             # giao diện (cần backend đang chạy)
npm install
npm run dev              # http://localhost:5173
```

## Quy trình nhóm (tóm tắt)

- Nhánh `feat|fix|docs|test|chore/<be|fe>-<mô-tả>` tách từ `main`; Conventional Commits; PR nhỏ, người kia review rồi mới merge.
- Đổi hợp đồng API hoặc schema: **sửa `docs/` trước**, ghi vào bảng lịch sử, rồi mới sửa code.
- Chi tiết: `docs/06-project-plan.md` mục 4.
