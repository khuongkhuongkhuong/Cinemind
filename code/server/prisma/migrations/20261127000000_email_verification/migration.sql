-- Xác minh email và quên mật khẩu (docs/03 v1.4). Chỉ THÊM, không xóa dữ liệu.
CREATE TYPE "EmailCodePurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- Cột có DEFAULT nên mọi tài khoản đang có được coi là đã xác minh.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "User" SET "emailVerifiedAt" = "createdAt";

CREATE TABLE "EmailCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "EmailCodePurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailCode_userId_purpose_key" ON "EmailCode"("userId", "purpose");

ALTER TABLE "EmailCode" ADD CONSTRAINT "EmailCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
