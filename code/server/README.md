# Cinemind — Server

Express + Prisma + PostgreSQL. Thiết kế: `docs/` ở thư mục gốc (đọc `04-api-contract.md` mục 5).

## Chạy từ repo sạch
1. Cài Node 20+ và PostgreSQL, tạo database `cinemind`.
2. `cd code/server && npm install`
3. `cp .env.example .env` rồi sửa `DATABASE_URL` (mật khẩu Postgres) và hai `JWT_*_SECRET`.
4. `npm run db:migrate` — tạo bảng từ `prisma/schema.prisma`.
5. `npm run dev` — server tại http://localhost:4000/api/v1 (thử `/health`).

## Lệnh hữu ích
| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy server, tự khởi động lại khi sửa code |
| `npm run db:migrate` | Tạo/áp migration sau khi sửa schema (sửa `docs/schema.prisma` trước!) |
| `npm run db:studio` | Xem dữ liệu bằng giao diện web |
| `npm run spike:seatlock` | Thí nghiệm chống trùng ghế bằng khóa chính |
| `npm test` | Chạy test |
