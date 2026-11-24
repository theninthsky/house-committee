// ===== Core data model =====

export type Account = 'bank' | 'cash';

export type PaymentMethod = 'transfer' | 'standing_order' | 'check' | 'app' | 'cash' | 'credit';

export interface RateEntry {
  /** First month this rate applies to, 'YYYY-MM' */
  from: string;
  amount: number;
}

export interface Unit {
  id: string;
  aptNumber: string;
  floor?: string;
  ownerName: string;
  ownerPhone?: string;
  ownerEmail?: string;
  tenantName?: string; // שוכר, אם יש
  tenantPhone?: string;
  tenantEmail?: string;
  /** Who gets receipts / pays: owner or tenant */
  payer: 'owner' | 'tenant';
  moveIn?: string; // YYYY-MM-DD
  moveOut?: string; // YYYY-MM-DD
  /** Month from which monthly charges are generated, 'YYYY-MM' */
  billingStart: string;
  rates: RateEntry[];
  notes?: string;
}

export type ChargeKind = 'monthly' | 'special';

export interface Charge {
  id: string;
  unitId: string;
  /** 'YYYY-MM' the charge belongs to */
  month: string;
  date: string; // YYYY-MM-DD (usually 1st of month)
  amount: number;
  kind: ChargeKind;
  description: string;
  /** Groups special charges created together */
  groupId?: string;
  /** Auto-generated monthly charge */
  auto?: boolean;
  /** Manually edited – auto rate updates will not touch it */
  edited?: boolean;
}

export interface Payment {
  id: string;
  unitId: string;
  date: string; // תאריך קבלה
  /** Value date – for post-dated checks this is the due date */
  valueDate: string;
  amount: number;
  method: PaymentMethod;
  reference?: string; // אסמכתא
  checkNumber?: string;
  checkBank?: string;
  /** 'regular' = דמי ועד, 'special' = גבייה מיוחדת */
  kind: 'regular' | 'special';
  /** Text shown on the receipt, e.g. "דמי ועד ינואר-מרץ 2026" */
  forText: string;
  account: Account;
  receiptNumber?: number;
  cancelled?: boolean;
  cancelReason?: string;
  bankLineId?: string;
  notes?: string;
  createdAt: string;
}

export type VendorType = 'fixed' | 'occasional';

export interface Vendor {
  id: string;
  name: string;
  type: VendorType;
  category: string;
  service?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  contractStart?: string;
  contractEnd?: string; // תוקף חוזה / ביטוח
  /** Expected monthly amount for fixed vendors */
  monthlyAmount?: number;
  /** Payment day of month (1-28) */
  paymentDay?: number;
  defaultMethod?: PaymentMethod;
  /** Auto record expense each month (standing order) */
  autoRecord?: boolean;
  autoFrom?: string; // 'YYYY-MM'
  /** Months the user removed an auto expense for – don't regenerate */
  autoSkip?: string[];
  /** How often the vendor is paid: monthly / bimonthly / yearly */
  frequency?: 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
  notes?: string;
  archived?: boolean;
}

export interface Expense {
  id: string;
  date: string;
  /** Value date – for vendor checks this is the check date */
  valueDate: string;
  vendorId?: string;
  payee?: string; // free text when no vendor
  category: string;
  description: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  checkNumber?: string;
  account: Account;
  attachmentIds: string[];
  /** Month this expense covers (for recurring vendors), 'YYYY-MM' */
  forMonth?: string;
  auto?: boolean;
  bankLineId?: string;
  notes?: string;
  createdAt: string;
}

/** Internal transfer between bank and petty cash */
export interface Transfer {
  id: string;
  date: string;
  from: Account;
  to: Account;
  amount: number;
  description: string;
  reference?: string;
  bankLineId?: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

export interface BankLine {
  id: string;
  batchId: string;
  date: string;
  description: string;
  reference?: string;
  /** Positive = credit (money in), negative = debit (money out) */
  amount: number;
  balance?: number;
  /** Matched system transaction, e.g. 'payment:abc' */
  matchedTo?: string;
  ignored?: boolean;
}

export interface BankBatch {
  id: string;
  fileName: string;
  importedAt: string;
  fromDate: string;
  toDate: string;
  lines: number;
  closingBalance?: number;
}

export interface Reconciliation {
  id: string;
  date: string; // statement date reconciled to
  statementBalance: number;
  systemBalance: number;
  createdAt: string;
  note?: string;
}

export type AuditAction = 'create' | 'update' | 'delete' | 'cancel' | 'lock' | 'unlock' | 'import' | 'restore' | 'settings';

export interface AuditEntry {
  id: string;
  ts: string;
  user: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  summary: string;
}

export interface Settings {
  buildingName: string;
  address: string;
  city?: string;
  committeeId?: string; // מספר עמותה / ח.פ, אם יש
  phone?: string;
  email?: string;
  bankDetails?: string;
  logo?: string; // data URL
  treasurerName: string;
  signature?: string; // data URL
  /** Current operator name for the audit log */
  currentUser: string;
  nextReceiptNumber: number;
  openingDate: string;
  openingBank: number;
  openingCash: number;
  /** Tenant opening balances (positive = debt) handled as charges */
  incomeCategories: string[];
  expenseCategories: string[];
  lockedYears: number[];
  defaultMonthly: number;
  backupReminderDays: number;
  lastBackupAt?: string;
  checkAlertDays: number;
  contractAlertDays: number;
  matchDays: number;
  setupDone: boolean;
  demo?: boolean;
}

export interface AppData {
  version: number;
  settings: Settings;
  units: Unit[];
  charges: Charge[];
  payments: Payment[];
  vendors: Vendor[];
  expenses: Expense[];
  transfers: Transfer[];
  attachments: Attachment[];
  bankBatches: BankBatch[];
  bankLines: BankLine[];
  reconciliations: Reconciliation[];
  audit: AuditEntry[];
}

/** A unified ledger row */
export interface LedgerRow {
  key: string; // 'payment:id'
  type: 'payment' | 'expense' | 'transfer' | 'opening';
  id: string;
  date: string;
  valueDate: string;
  account: Account;
  /** Positive = in, negative = out (for this account) */
  amount: number;
  category: string;
  description: string;
  party: string;
  reference?: string;
  method?: PaymentMethod;
  unitId?: string;
  vendorId?: string;
  receiptNumber?: number;
  attachmentIds?: string[];
  bankLineId?: string;
}
