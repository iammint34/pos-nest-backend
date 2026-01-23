-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operator_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" DATETIME,
    "opening_cash" DECIMAL NOT NULL DEFAULT 0,
    "closing_cash" DECIMAL,
    "expected_cash" DECIMAL,
    "variance" DECIMAL,
    "notes" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "synced_at" DATETIME,
    "portal_shift_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "shifts_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shift_id" TEXT NOT NULL,
    "movement_type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "reason" TEXT,
    "performed_by" TEXT NOT NULL,
    "performed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_number" TEXT NOT NULL,
    "order_type" TEXT NOT NULL DEFAULT 'DINE_IN',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "user_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "operator_id" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "subtotal" DECIMAL NOT NULL DEFAULT 0,
    "discount_total" DECIMAL NOT NULL DEFAULT 0,
    "tax_total" DECIMAL NOT NULL DEFAULT 0,
    "grand_total" DECIMAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "synced_at" DATETIME,
    "portal_order_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "closed_at" DATETIME,
    CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "orders_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_orders" ("closed_at", "created_at", "customer_name", "customer_phone", "discount_total", "grand_total", "id", "notes", "order_number", "order_type", "portal_order_id", "status", "subtotal", "sync_status", "synced_at", "tax_total", "updated_at", "user_id") SELECT "closed_at", "created_at", "customer_name", "customer_phone", "discount_total", "grand_total", "id", "notes", "order_number", "order_type", "portal_order_id", "status", "subtotal", "sync_status", "synced_at", "tax_total", "updated_at", "user_id" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");
CREATE INDEX "orders_shift_id_idx" ON "orders"("shift_id");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_sync_status_idx" ON "orders"("sync_status");
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "shifts_operator_id_idx" ON "shifts"("operator_id");

-- CreateIndex
CREATE INDEX "shifts_status_idx" ON "shifts"("status");

-- CreateIndex
CREATE INDEX "shifts_sync_status_idx" ON "shifts"("sync_status");

-- CreateIndex
CREATE INDEX "cash_movements_shift_id_idx" ON "cash_movements"("shift_id");
