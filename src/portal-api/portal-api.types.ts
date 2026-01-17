// Types for Portal API responses

export interface PortalRegistrationResult {
  deviceId: string;
  storeId: string;
  storeName: string;
  branchId: string;
  branchName: string;
  deviceToken: string;
  tokenExpiresAt?: string;
}

export interface PortalUser {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: 'MANAGER' | 'STAFF';
  pin?: string;
  isActive: boolean;
}

export interface PortalCategory {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface PortalItem {
  id: string;
  categoryId?: string;
  sku?: string;
  name: string;
  description?: string;
  price: number;
  isActive: boolean;
  isAvailable: boolean;
  version: number;
}

export interface DeletedRecord {
  id: string;
  deletedAt: string;
}

export interface PortalSyncData {
  success: boolean;
  version: number;
  users?: PortalUser[];
  categories?: PortalCategory[];
  items?: PortalItem[];
  deletedUsers?: DeletedRecord[];
  deletedCategories?: DeletedRecord[];
  deletedItems?: DeletedRecord[];
  syncedAt: string;
  storeId: string;
  branchId: string;
}

export interface SyncRequestPayload {
  deviceIdentifier: string;
  deviceToken: string;
  syncType?: 'FULL' | 'INCREMENTAL' | 'ITEMS' | 'CATEGORIES' | 'CONFIG' | 'HEARTBEAT';
  lastVersion?: number;
  lastSyncAt?: string;
}

export interface SyncOrderPayload {
  posOrderId: string;
  orderNumber: string;
  orderType?: string;
  status?: string;
  customerName?: string;
  customerPhone?: string;
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  grandTotal: number;
  notes?: string;
  posCreatedAt: string;  // Portal expects posCreatedAt, not createdAt
  posClosedAt?: string;  // Portal expects posClosedAt, not closedAt
  items: SyncOrderItemPayload[];
  discounts?: SyncOrderDiscountPayload[];
  payments?: SyncPaymentPayload[];
  refunds?: SyncRefundPayload[];
}

export interface SyncOrderItemPayload {
  posItemId?: string;    // Reference to item in POS system
  itemId?: string;       // Reference to Item ID in Portal (UUID)
  itemName: string;
  itemSku?: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  taxAmount?: number;
  totalPrice: number;
  notes?: string;
  isVoided?: boolean;
  voidReason?: string;
}

export interface SyncOrderDiscountPayload {
  orderItemIndex?: number;  // Index of order item this discount applies to
  discountName: string;
  discountType: string;
  discountScope: string;
  discountValue: number;
  discountAmount: number;
  reason?: string;
  appliedBy?: string;
}

export interface SyncPaymentPayload {
  posPaymentId: string;
  paymentMethod: string;
  status: string;
  amount: number;
  tipAmount: number;
  changeAmount: number;
  referenceNumber?: string;
  processedAt: string;
}

export interface SyncRefundPayload {
  posRefundId: string;
  posPaymentId: string;
  amount: number;
  reason?: string;
  refundMethod: string;
  processedAt: string;
}

export interface SyncResult {
  success: boolean;
  posOrderId: string;
  portalOrderId?: string;
  error?: string;
}

export interface BatchSyncResult {
  syncBatchId: string;
  totalOrders: number;
  successful: number;
  failed: number;
  results: SyncResult[];
}
