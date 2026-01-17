-- AlterTable
ALTER TABLE "device_config" ADD COLUMN "last_sync_version" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portal_id" TEXT NOT NULL,
    "category_id" TEXT,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_items" ("category_id", "created_at", "description", "id", "is_active", "name", "portal_id", "price", "sku", "synced_at", "updated_at", "version") SELECT "category_id", "created_at", "description", "id", "is_active", "name", "portal_id", "price", "sku", "synced_at", "updated_at", "version" FROM "items";
DROP TABLE "items";
ALTER TABLE "new_items" RENAME TO "items";
CREATE UNIQUE INDEX "items_portal_id_key" ON "items"("portal_id");
CREATE INDEX "items_category_id_idx" ON "items"("category_id");
CREATE INDEX "items_sku_idx" ON "items"("sku");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
