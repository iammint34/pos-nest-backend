-- CreateTable
CREATE TABLE "branch_inventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portal_id" TEXT,
    "item_id" TEXT NOT NULL,
    "current_quantity" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER,
    "is_tracked" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "branch_inventory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "movement_id" TEXT NOT NULL,
    "branch_inventory_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previous_quantity" INTEGER NOT NULL,
    "new_quantity" INTEGER NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "reason" TEXT,
    "performed_by" TEXT,
    "performed_at" DATETIME NOT NULL,
    "sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_branch_inventory_id_fkey" FOREIGN KEY ("branch_inventory_id") REFERENCES "branch_inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "branch_inventory_portal_id_key" ON "branch_inventory"("portal_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_inventory_item_id_key" ON "branch_inventory"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_movement_id_key" ON "inventory_movements"("movement_id");

-- CreateIndex
CREATE INDEX "inventory_movements_branch_inventory_id_idx" ON "inventory_movements"("branch_inventory_id");

-- CreateIndex
CREATE INDEX "inventory_movements_item_id_idx" ON "inventory_movements"("item_id");

-- CreateIndex
CREATE INDEX "inventory_movements_movement_type_idx" ON "inventory_movements"("movement_type");

-- CreateIndex
CREATE INDEX "inventory_movements_performed_at_idx" ON "inventory_movements"("performed_at");

-- CreateIndex
CREATE INDEX "inventory_movements_sync_status_idx" ON "inventory_movements"("sync_status");
