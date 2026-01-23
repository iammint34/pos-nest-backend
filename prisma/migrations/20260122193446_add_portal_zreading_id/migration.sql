-- CreateTable
CREATE TABLE "grand_total_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "running_total" DECIMAL NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "z_readings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "z_counter_no" INTEGER NOT NULL,
    "beginning_invoice_no" TEXT NOT NULL,
    "ending_invoice_no" TEXT NOT NULL,
    "beginning_grand_total" DECIMAL NOT NULL,
    "ending_grand_total" DECIMAL NOT NULL,
    "gross_sales" DECIMAL NOT NULL,
    "net_sales" DECIMAL NOT NULL,
    "vatable_sales" DECIMAL NOT NULL,
    "vat_amount" DECIMAL NOT NULL,
    "vat_exempt_sales" DECIMAL NOT NULL,
    "zero_rated_sales" DECIMAL NOT NULL,
    "discount_total" DECIMAL NOT NULL DEFAULT 0,
    "refund_total" DECIMAL NOT NULL DEFAULT 0,
    "void_total" DECIMAL NOT NULL DEFAULT 0,
    "transaction_count" INTEGER NOT NULL,
    "void_count" INTEGER NOT NULL DEFAULT 0,
    "refund_count" INTEGER NOT NULL DEFAULT 0,
    "closed_by" TEXT NOT NULL,
    "closed_at" DATETIME NOT NULL,
    "sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "synced_at" DATETIME,
    "portal_zreading_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "electronic_journal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "receipt_content" TEXT NOT NULL,
    "receipt_hash" TEXT NOT NULL,
    "grand_total" DECIMAL NOT NULL,
    "vat_amount" DECIMAL NOT NULL,
    "operator_id" TEXT NOT NULL,
    "operator_name" TEXT NOT NULL,
    "transaction_date" DATETIME NOT NULL,
    "sync_status" TEXT NOT NULL DEFAULT 'PENDING',
    "synced_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_device_config" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "device_identifier" TEXT NOT NULL,
    "device_name" TEXT,
    "store_id" TEXT NOT NULL,
    "store_name" TEXT,
    "branch_id" TEXT NOT NULL,
    "branch_name" TEXT,
    "device_token" TEXT,
    "token_expires_at" DATETIME,
    "last_sync_at" DATETIME,
    "last_sync_version" INTEGER,
    "is_registered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "registered_name" TEXT,
    "registered_address" TEXT,
    "vat_tin" TEXT,
    "is_vat_registered" BOOLEAN NOT NULL DEFAULT true,
    "min" TEXT,
    "serial_number" TEXT,
    "permit_number" TEXT,
    "ptu_no" TEXT,
    "ptu_date_issued" TEXT,
    "ptu_valid_until" TEXT,
    "accreditation_no" TEXT,
    "next_invoice_number" INTEGER NOT NULL DEFAULT 1,
    "grand_total_accum" DECIMAL NOT NULL DEFAULT 0,
    "z_counter_no" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_device_config" ("branch_id", "branch_name", "created_at", "device_identifier", "device_name", "device_token", "id", "is_registered", "last_sync_at", "last_sync_version", "store_id", "store_name", "token_expires_at", "updated_at") SELECT "branch_id", "branch_name", "created_at", "device_identifier", "device_name", "device_token", "id", "is_registered", "last_sync_at", "last_sync_version", "store_id", "store_name", "token_expires_at", "updated_at" FROM "device_config";
DROP TABLE "device_config";
ALTER TABLE "new_device_config" RENAME TO "device_config";
CREATE UNIQUE INDEX "device_config_device_identifier_key" ON "device_config"("device_identifier");
CREATE TABLE "new_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order_number" TEXT NOT NULL,
    "invoice_number" TEXT,
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
    "vatable_sales" DECIMAL NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL NOT NULL DEFAULT 0,
    "vat_exempt_sales" DECIMAL NOT NULL DEFAULT 0,
    "zero_rated_sales" DECIMAL NOT NULL DEFAULT 0,
    "customer_tin" TEXT,
    "customer_business_name" TEXT,
    "customer_business_address" TEXT,
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
INSERT INTO "new_orders" ("closed_at", "created_at", "customer_name", "customer_phone", "discount_total", "grand_total", "id", "notes", "operator_id", "order_number", "order_type", "portal_order_id", "shift_id", "status", "subtotal", "sync_status", "synced_at", "tax_total", "updated_at", "user_id") SELECT "closed_at", "created_at", "customer_name", "customer_phone", "discount_total", "grand_total", "id", "notes", "operator_id", "order_number", "order_type", "portal_order_id", "shift_id", "status", "subtotal", "sync_status", "synced_at", "tax_total", "updated_at", "user_id" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
CREATE UNIQUE INDEX "orders_invoice_number_key" ON "orders"("invoice_number");
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");
CREATE INDEX "orders_shift_id_idx" ON "orders"("shift_id");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_sync_status_idx" ON "orders"("sync_status");
CREATE INDEX "orders_invoice_number_idx" ON "orders"("invoice_number");
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "grand_total_log_order_id_idx" ON "grand_total_log"("order_id");

-- CreateIndex
CREATE INDEX "grand_total_log_created_at_idx" ON "grand_total_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "z_readings_z_counter_no_key" ON "z_readings"("z_counter_no");

-- CreateIndex
CREATE INDEX "z_readings_closed_at_idx" ON "z_readings"("closed_at");

-- CreateIndex
CREATE INDEX "z_readings_sync_status_idx" ON "z_readings"("sync_status");

-- CreateIndex
CREATE INDEX "electronic_journal_order_id_idx" ON "electronic_journal"("order_id");

-- CreateIndex
CREATE INDEX "electronic_journal_invoice_number_idx" ON "electronic_journal"("invoice_number");

-- CreateIndex
CREATE INDEX "electronic_journal_transaction_date_idx" ON "electronic_journal"("transaction_date");

-- CreateIndex
CREATE INDEX "electronic_journal_sync_status_idx" ON "electronic_journal"("sync_status");
