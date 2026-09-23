-- CreateEnum
CREATE TYPE "KeyFormat" AS ENUM ('PEM', 'PPK');

-- AlterTable
ALTER TABLE "SSHKey" ADD COLUMN     "keyFormat" "KeyFormat" NOT NULL DEFAULT 'PEM';

-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "windowsPasswordAuthTag" TEXT,
ADD COLUMN     "windowsPasswordCiphertext" TEXT,
ADD COLUMN     "windowsPasswordIv" TEXT;
