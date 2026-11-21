-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('HELD', 'SOLD', 'RELEASED');

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_showtimeId_fkey";

-- DropForeignKey
ALTER TABLE "SeatLock" DROP CONSTRAINT "SeatLock_showtimeId_fkey";

-- DropForeignKey
ALTER TABLE "SeatLock" DROP CONSTRAINT "SeatLock_seatId_fkey";

-- DropForeignKey
ALTER TABLE "SeatLock" DROP CONSTRAINT "SeatLock_orderId_fkey";

-- DropIndex
DROP INDEX "Order_showtimeId_idx";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "showtimeId";

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "occupiedSeatId" UUID,
ADD COLUMN     "showtimeId" UUID NOT NULL,
ADD COLUMN     "status" "TicketStatus" NOT NULL DEFAULT 'HELD';

-- DropTable
DROP TABLE "SeatLock";

-- DropEnum
DROP TYPE "LockStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_showtimeId_occupiedSeatId_key" ON "Ticket"("showtimeId", "occupiedSeatId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_showtimeId_fkey" FOREIGN KEY ("showtimeId") REFERENCES "Showtime"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

