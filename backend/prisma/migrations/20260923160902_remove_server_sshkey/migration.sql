-- DropForeignKey
ALTER TABLE "SSHKey" DROP CONSTRAINT "SSHKey_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Server" DROP CONSTRAINT "Server_assignedKeyId_fkey";

-- DropForeignKey
ALTER TABLE "Server" DROP CONSTRAINT "Server_createdById_fkey";

-- DropTable
DROP TABLE "SSHKey";

-- DropTable
DROP TABLE "Server";

-- DropEnum
DROP TYPE "Environment";

-- DropEnum
DROP TYPE "KeyFormat";

-- DropEnum
DROP TYPE "OperatingSystem";

-- DropEnum
DROP TYPE "ServerStatus";

