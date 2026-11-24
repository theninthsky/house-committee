import { useSyncExternalStore } from 'react';
import type { AppData, AuditAction, Settings } from './types';
import { kvGet, kvSet } from './db';
import { todayISO, uid } from './format';

export const DATA_VERSION = 1;

export const DEFAULT_INCOME_CATEGORIES = ['גבייה שוטפת', 'גבייה מיוחדת', 'ריבית / הכנסות אחרות'];
export const DEFAULT_EXPENSE_CATEGORIES = [
  'ניקיון',
  'חשמל',
  'מים',
  'גינון',
  'מעליות',
  'אחזקה שוטפת',
  'שיפוצים',
  'ביטוח',
  'עמלות בנק',
  'הדברה',
  'ציוד ומתכלים',
  'אחר',
];

export function defaultSettings(): Settings {
  return {
    buildingName: '',
    address: '',
    city: '',
    treasurerName: '',
    currentUser: '',
    nextReceiptNumber: 1,
    openingDate: todayISO().slice(0, 4) + '-01-01',
    openingBank: 0,
    openingCash: 0,
    incomeCategories: [...DEFAULT_INCOME_CATEGORIES],
    expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
    lockedYears: [],
    defaultMonthly: 250,
    backupReminderDays: 7,
    checkAlertDays: 14,
    contractAlertDays: 30,
    matchDays: 5,
    setupDone: false,
  };
}

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    settings: defaultSettings(),
    units: [],
    charges: [],
    payments: [],
    vendors: [],
    expenses: [],
    transfers: [],
    attachments: [],
    bankBatches: [],
    bankLines: [],
    reconciliations: [],
    audit: [],
  };
}

/** Fill in fields that may be missing in data saved by an older version */
export function normalize(d: Partial<AppData>): AppData {
  const base = emptyData();
  const out = { ...base, ...d } as AppData;
  out.settings = { ...base.settings, ...(d.settings || {}) };
  for (const k of Object.keys(base) as (keyof AppData)[]) {
    if (Array.isArray(base[k]) && !Array.isArray(out[k])) (out as any)[k] = [];
  }
  out.version = DATA_VERSION;
  return out;
}

// ===== Store =====

let data: AppData = emptyData();
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: number | undefined;
let savePromise: Promise<void> = Promise.resolve();

export async function loadData(): Promise<AppData> {
  const saved = await kvGet<AppData>('data');
  data = saved ? normalize(saved) : emptyData();
  loaded = true;
  emit();
  return data;
}

export function isLoaded() {
  return loaded;
}

function emit() {
  listeners.forEach((l) => l());
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    savePromise = kvSet('data', data).then(() => undefined);
  }, 150);
}

export function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  savePromise = kvSet('data', data).then(() => undefined);
  return savePromise;
}

window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    void kvSet('data', data);
  }
});

export function getData(): AppData {
  return data;
}

export function useData(): AppData {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => data,
  );
}

export class LockedError extends Error {}
export class ValidationError extends Error {}

export interface AuditInfo {
  action: AuditAction;
  entity: string;
  entityId?: string;
  summary: string;
}

/**
 * Apply a change. The mutator receives a deep copy it may mutate freely.
 * Throws (and changes nothing) if the mutator throws.
 */
export function update(mutator: (d: AppData) => void, audit?: AuditInfo | AuditInfo[]) {
  const draft: AppData = structuredClone(data);
  mutator(draft);
  const entries = audit ? (Array.isArray(audit) ? audit : [audit]) : [];
  for (const a of entries) {
    draft.audit.push({
      id: uid(),
      ts: new Date().toISOString(),
      user: draft.settings.currentUser || draft.settings.treasurerName || 'גזבר',
      ...a,
    });
  }
  data = draft;
  emit();
  scheduleSave();
}

/** Replace the whole data document (restore from backup) */
export function replaceData(next: AppData) {
  data = normalize(next);
  emit();
  return flushSave();
}

// ===== Period locking =====

export function isLocked(d: AppData, date?: string): boolean {
  if (!date) return false;
  const y = Number(date.slice(0, 4));
  return d.settings.lockedYears.includes(y);
}

export function assertUnlocked(d: AppData, ...dates: (string | undefined)[]) {
  for (const date of dates) {
    if (isLocked(d, date)) {
      throw new LockedError(`שנת ${date!.slice(0, 4)} נעולה. לא ניתן להוסיף, לערוך או למחוק תנועות בתקופה נעולה.`);
    }
  }
}
