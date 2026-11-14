-- Đổi tên bảng OrderSeat -> Ticket (docs/03 v1.2). Chỉ ĐỔI TÊN: dữ liệu giữ nguyên, không xóa/tạo lại bảng.
ALTER TABLE "OrderSeat" RENAME TO "Ticket";

ALTER TABLE "Ticket" RENAME CONSTRAINT "OrderSeat_pkey" TO "Ticket_pkey";
ALTER TABLE "Ticket" RENAME CONSTRAINT "OrderSeat_orderId_fkey" TO "Ticket_orderId_fkey";
ALTER TABLE "Ticket" RENAME CONSTRAINT "OrderSeat_seatId_fkey" TO "Ticket_seatId_fkey";

ALTER INDEX "OrderSeat_seatId_idx" RENAME TO "Ticket_seatId_idx";
ALTER INDEX "OrderSeat_orderId_seatId_key" RENAME TO "Ticket_orderId_seatId_key";
