-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT', 'TEXTAREA', 'SSH_KEY', 'PASSWORD');

-- CreateTable
CREATE TABLE "InventoryEntity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryField" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" "FieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryRecord" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryEntity_name_key" ON "InventoryEntity"("name");

-- CreateIndex
CREATE INDEX "InventoryField_entityId_idx" ON "InventoryField"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryField_entityId_fieldName_key" ON "InventoryField"("entityId", "fieldName");

-- CreateIndex
CREATE INDEX "InventoryRecord_entityId_idx" ON "InventoryRecord"("entityId");

-- AddForeignKey
ALTER TABLE "InventoryField" ADD CONSTRAINT "InventoryField_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "InventoryEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryRecord" ADD CONSTRAINT "InventoryRecord_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "InventoryEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
