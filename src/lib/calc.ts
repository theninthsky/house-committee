import type { Account, AppData, Charge, LedgerRow, Unit, Vendor } from './types';
import { addDays, addMonths, currentMonth, daysBetween, monthRange, round2, todayISO } from './format';

// ===== Names =====

export function unitLabel(u?: Unit): string {
  if (!u) return '—';
  return `דירה ${u.aptNumber}`;
}

export function payerName(u?: Unit): string {
  if (!u) return '';
  return (u.payer === 'tenant' && u.tenantName ? u.tenantName : u.ownerName) || '';
}

export function payerEmail(u?: Unit): string {
  if (!u) return '';
  return (u.payer === 'tenant' ? u.tenantEmail || u.ownerEmail : u.ownerEmail || u.tenantEmail) || '';
}

export function payerPhone(u?: Unit): string {
  if (!u) return '';
  return (u.payer === 'tenant' ? u.tenantPhone || u.ownerPhone : u.ownerPhone || u.tenantPhone) || '';
}

export function unitFull(u?: Unit): string {
  if (!u) return '—';
  const n = payerName(u);
  return n ? `דירה ${u.aptNumber} – ${n}` : `דירה ${u.aptNumber}`;
}

export function sortUnits(units: Unit[]): Unit[] {
  return [...units].sort((a, b) => a.aptNumber.localeCompare(b.aptNumber, 'he', { numeric: true }));
}

// ===== Rates =====

export function rateFor(u: Unit, month: string): number {
  const sorted = [...u.rates].sort((a, b) => a.from.localeCompare(b.from));
  let r = 0;
  for (const e of sorted) if (e.from <= month) r = e.amount;
  return r;
}

export function currentRate(u: Unit): number {
  return rateFor(u, currentMonth());
}

function unitActiveIn(u: Unit, month: string): boolean {
  if (month < u.billingStart) return false;
  if (u.moveOut && month > u.moveOut.slice(0, 7)) return false;
  return true;
}

/**
 * Ensure each unit has an auto monthly charge for every month up to the current month
 * and that auto charges follow the rate history. Returns true if anything changed.
 */
export function syncMonthlyCharges(d: AppData, newId: () => string): boolean {
  let changed = false;
  const cur = currentMonth();
  const locked = new Set(d.settings.lockedYears);
  const byKey = new Map<string, Charge>();
  for (const c of d.charges) if (c.kind === 'monthly') byKey.set(c.unitId + '|' + c.month, c);
  for (const u of d.units) {
    if (!u.billingStart) continue;
    for (const m of monthRange(u.billingStart, cur)) {
      if (locked.has(Number(m.slice(0, 4)))) continue;
      const existing = byKey.get(u.id + '|' + m);
      const active = unitActiveIn(u, m);
      const rate = rateFor(u, m);
      if (!existing) {
        if (!active || rate <= 0) continue;
        d.charges.push({
          id: newId(),
          unitId: u.id,
          month: m,
          date: m + '-01',
          amount: rate,
          kind: 'monthly',
          description: 'דמי ועד',
          auto: true,
        });
        changed = true;
      } else if (existing.auto && !existing.edited) {
        const target = active ? rate : 0;
        if (existing.amount !== target) {
          existing.amount = target;
          changed = true;
        }
      }
    }
  }
  if (changed) d.charges = d.charges.filter((c) => !(c.auto && !c.edited && c.amount === 0));
  return changed;
}

/** Auto-record standing-order expenses for fixed vendors. Returns true if anything changed. */
export function syncVendorAutoExpenses(d: AppData, newId: () => string): boolean {
  let changed = false;
  const today = todayISO();
  const cur = currentMonth();
  const locked = new Set(d.settings.lockedYears);
  for (const v of d.vendors) {
    if (v.archived || !v.autoRecord || !v.monthlyAmount || !v.autoFrom) continue;
    const day = Math.min(Math.max(v.paymentDay || 1, 1), 28);
    for (const m of monthRange(v.autoFrom, cur)) {
      if (locked.has(Number(m.slice(0, 4)))) continue;
      if (v.autoSkip?.includes(m)) continue;
      const date = `${m}-${String(day).padStart(2, '0')}`;
      if (date > today) continue;
      if (!vendorPaysIn(v, m)) continue;
      const has = d.expenses.some((e) => e.vendorId === v.id && e.forMonth === m);
      if (has) continue;
      d.expenses.push({
        id: newId(),
        date,
        valueDate: date,
        vendorId: v.id,
        category: v.category,
        description: `${v.service || v.name} – תשלום חודשי (רישום אוטומטי)`,
        amount: v.monthlyAmount,
        method: v.defaultMethod || 'standing_order',
        account: 'bank',
        attachmentIds: [],
        forMonth: m,
        auto: true,
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
  }
  return changed;
}

export function vendorPaysIn(v: Vendor, month: string): boolean {
  const f = v.frequency || 'monthly';
  if (f === 'monthly') return true;
  const start = v.autoFrom || v.contractStart?.slice(0, 7) || month;
  const idx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));
  const diff = Math.abs(idx(month) - idx(start));
  const step = f === 'bimonthly' ? 2 : f === 'quarterly' ? 3 : 12;
  return diff % step === 0;
}

// ===== Ledger =====

export const TRANSFER_CATEGORY = 'העברה פנימית';
export const OPENING_CATEGORY = 'יתרת פתיחה';

export function ledgerRows(d: AppData): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const units = new Map(d.units.map((u) => [u.id, u]));
  const vendors = new Map(d.vendors.map((v) => [v.id, v]));
  const s = d.settings;
  if (s.openingBank)
    rows.push({ key: 'opening:bank', type: 'opening', id: 'bank', date: s.openingDate, valueDate: s.openingDate, account: 'bank', amount: s.openingBank, category: OPENING_CATEGORY, description: 'יתרת פתיחה בבנק', party: '' });
  if (s.openingCash)
    rows.push({ key: 'opening:cash', type: 'opening', id: 'cash', date: s.openingDate, valueDate: s.openingDate, account: 'cash', amount: s.openingCash, category: OPENING_CATEGORY, description: 'יתרת פתיחה בקופה קטנה', party: '' });
  for (const p of d.payments) {
    if (p.cancelled) continue;
    const u = units.get(p.unitId);
    rows.push({
      key: 'payment:' + p.id,
      type: 'payment',
      id: p.id,
      date: p.date,
      valueDate: p.valueDate || p.date,
      account: p.account,
      amount: p.amount,
      category: p.kind === 'special' ? 'גבייה מיוחדת' : 'גבייה שוטפת',
      description: p.forText,
      party: unitFull(u),
      reference: p.checkNumber ? `צ'ק ${p.checkNumber}` : p.reference,
      method: p.method,
      unitId: p.unitId,
      receiptNumber: p.receiptNumber,
      bankLineId: p.bankLineId,
    });
  }
  for (const e of d.expenses) {
    const v = e.vendorId ? vendors.get(e.vendorId) : undefined;
    rows.push({
      key: 'expense:' + e.id,
      type: 'expense',
      id: e.id,
      date: e.date,
      valueDate: e.valueDate || e.date,
      account: e.account,
      amount: -e.amount,
      category: e.category,
      description: e.description,
      party: v?.name || e.payee || '',
      reference: e.checkNumber ? `צ'ק ${e.checkNumber}` : e.reference,
      method: e.method,
      vendorId: e.vendorId,
      attachmentIds: e.attachmentIds,
      bankLineId: e.bankLineId,
    });
  }
  for (const t of d.transfers) {
    const desc = t.description || (t.to === 'bank' ? 'הפקדת מזומן לבנק' : 'משיכת מזומן לקופה קטנה');
    rows.push({ key: 'transfer:' + t.id + ':from', type: 'transfer', id: t.id, date: t.date, valueDate: t.date, account: t.from, amount: -t.amount, category: TRANSFER_CATEGORY, description: desc, party: '', reference: t.reference, bankLineId: t.from === 'bank' ? t.bankLineId : undefined });
    rows.push({ key: 'transfer:' + t.id + ':to', type: 'transfer', id: t.id, date: t.date, valueDate: t.date, account: t.to, amount: t.amount, category: TRANSFER_CATEGORY, description: desc, party: '', reference: t.reference, bankLineId: t.to === 'bank' ? t.bankLineId : undefined });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  return rows;
}

export function accountBalance(d: AppData, account: Account, asOf: string = todayISO(), rows = ledgerRows(d)): number {
  let sum = 0;
  for (const r of rows) if (r.account === account && r.valueDate <= asOf) sum += r.amount;
  return round2(sum);
}

/** Balance including future-dated items (e.g. post-dated checks) */
export function projectedBalance(d: AppData, account: Account, rows = ledgerRows(d)): number {
  let sum = 0;
  for (const r of rows) if (r.account === account) sum += r.amount;
  return round2(sum);
}

// ===== Tenant balances & FIFO allocation =====

export interface ChargeAlloc {
  charge: Charge;
  paid: number;
  remaining: number;
}

export interface UnitAccount {
  unit: Unit;
  charges: ChargeAlloc[];
  totalCharged: number;
  totalPaid: number;
  /** Positive = debt, negative = credit */
  balance: number;
  credit: number;
}

export function unitAccount(d: AppData, unit: Unit, upTo: string = currentMonth()): UnitAccount {
  const charges = d.charges
    .filter((c) => c.unitId === unit.id && c.month <= upTo)
    .sort((a, b) => a.month.localeCompare(b.month) || a.date.localeCompare(b.date));
  const pays = d.payments.filter((p) => p.unitId === unit.id && !p.cancelled);
  let regular = round2(pays.filter((p) => p.kind !== 'special').reduce((s, p) => s + p.amount, 0));
  let special = round2(pays.filter((p) => p.kind === 'special').reduce((s, p) => s + p.amount, 0));
  const allocs: ChargeAlloc[] = charges.map((c) => ({ charge: c, paid: 0, remaining: c.amount }));
  const apply = (pool: 'r' | 's', filter: (c: Charge) => boolean) => {
    for (const a of allocs) {
      if (!filter(a.charge) || a.remaining <= 0) continue;
      const avail = pool === 'r' ? regular : special;
      if (avail <= 0) break;
      const x = Math.min(avail, a.remaining);
      a.paid = round2(a.paid + x);
      a.remaining = round2(a.remaining - x);
      if (pool === 'r') regular = round2(regular - x);
      else special = round2(special - x);
    }
  };
  apply('r', (c) => c.kind === 'monthly');
  apply('s', (c) => c.kind === 'special');
  // leftovers cross-apply
  apply('r', () => true);
  apply('s', () => true);
  const totalCharged = round2(charges.reduce((s, c) => s + c.amount, 0));
  const totalPaid = round2(pays.reduce((s, p) => s + p.amount, 0));
  const balance = round2(totalCharged - totalPaid);
  return { unit, charges: allocs, totalCharged, totalPaid, balance, credit: balance < 0 ? -balance : 0 };
}

export type CellStatus = 'paid' | 'partial' | 'overdue' | 'due' | 'credit' | 'none';

export interface MatrixCell {
  status: CellStatus;
  due: number;
  paid: number;
}

export function collectionMatrix(d: AppData, year: number) {
  const cur = currentMonth();
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  return sortUnits(d.units).map((u) => {
    const acc = unitAccount(d, u, `${year}-12`);
    let creditLeft = acc.credit;
    const cells: MatrixCell[] = months.map((m) => {
      const cs = acc.charges.filter((a) => a.charge.month === m);
      if (!cs.length) {
        // future months covered by prepaid credit
        const rate = rateFor(u, m);
        if (m > cur && creditLeft > 0 && rate > 0 && unitActiveIn(u, m)) {
          const covered = Math.min(rate, creditLeft);
          creditLeft = round2(creditLeft - covered);
          return { status: covered >= rate ? 'credit' : 'partial', due: rate, paid: covered };
        }
        return { status: 'none', due: 0, paid: 0 };
      }
      const due = round2(cs.reduce((s, a) => s + a.charge.amount, 0));
      const paid = round2(cs.reduce((s, a) => s + a.paid, 0));
      let status: CellStatus;
      if (paid >= due) status = 'paid';
      else if (paid > 0) status = 'partial';
      else if (m < cur) status = 'overdue';
      else status = 'due';
      return { status, due, paid };
    });
    return { unit: u, cells, balance: unitAccount(d, u).balance };
  });
}

export function monthCollectionStatus(d: AppData, month: string = currentMonth()) {
  let paidCount = 0;
  let total = 0;
  for (const u of d.units) {
    const acc = unitAccount(d, u, month);
    const cs = acc.charges.filter((a) => a.charge.month === month);
    if (!cs.length) continue;
    total++;
    if (cs.every((a) => a.remaining <= 0)) paidCount++;
  }
  const openDebt = round2(d.units.reduce((s, u) => s + Math.max(0, unitAccount(d, u).balance), 0));
  return { paidCount, total, openDebt };
}

export interface DebtorRow {
  unit: Unit;
  debt: number;
  unpaidMonths: string[];
  oldest?: string;
  buckets: [number, number, number, number]; // 0-30, 31-60, 61-90, 90+
}

export function debtors(d: AppData): DebtorRow[] {
  const today = todayISO();
  return sortUnits(d.units)
    .map((u) => {
      const acc = unitAccount(d, u);
      const open = acc.charges.filter((a) => a.remaining > 0);
      const buckets: [number, number, number, number] = [0, 0, 0, 0];
      for (const a of open) {
        const age = daysBetween(a.charge.date, today);
        const i = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
        buckets[i] = round2(buckets[i] + a.remaining);
      }
      const unpaidMonths = Array.from(new Set(open.map((a) => a.charge.month))).sort();
      return { unit: u, debt: Math.max(0, acc.balance), unpaidMonths, oldest: unpaidMonths[0], buckets };
    })
    .filter((r) => r.debt > 0);
}

// ===== Alerts =====

export interface Alert {
  level: 'danger' | 'warning' | 'info';
  text: string;
  link?: string;
  action?: { label: string; kind: 'payVendor'; vendorId: string };
}

export function alerts(d: AppData): Alert[] {
  const out: Alert[] = [];
  const today = todayISO();
  const cur = currentMonth();
  const s = d.settings;
  const vendors = new Map(d.vendors.map((v) => [v.id, v]));
  // Fixed vendors not yet paid this month
  for (const v of d.vendors) {
    if (v.archived || v.type !== 'fixed') continue;
    if (!vendorPaysIn(v, cur)) continue;
    const paid = d.expenses.some((e) => e.vendorId === v.id && (e.forMonth === cur || (!e.forMonth && e.date.slice(0, 7) === cur)));
    if (paid) continue;
    if (v.autoRecord && v.monthlyAmount) {
      const day = v.paymentDay || 1;
      out.push({ level: 'info', text: `${v.name}: הוראת קבע תירשם אוטומטית ב-${day} לחודש`, link: '#/vendors' });
      continue;
    }
    const day = v.paymentDay || 1;
    const late = Number(today.slice(8, 10)) > day;
    out.push({
      level: late ? 'warning' : 'info',
      text: `${v.name}: טרם נרשם תשלום החודש${v.monthlyAmount ? ` (₪${v.monthlyAmount})` : ''}${v.paymentDay ? ` · מועד תשלום ${v.paymentDay} לחודש` : ''}`,
      action: { label: 'רשום תשלום', kind: 'payVendor', vendorId: v.id },
    });
  }
  // Contracts / insurance expiring
  for (const v of d.vendors) {
    if (v.archived || !v.contractEnd) continue;
    const days = daysBetween(today, v.contractEnd);
    if (days < 0) out.push({ level: 'danger', text: `החוזה/פוליסה של ${v.name} פג ב-${fmt(v.contractEnd)}`, link: '#/vendors' });
    else if (days <= s.contractAlertDays) out.push({ level: 'warning', text: `החוזה/פוליסה של ${v.name} יפוג בעוד ${days} ימים (${fmt(v.contractEnd)})`, link: '#/vendors' });
  }
  // Post-dated checks
  const horizon = addDays(today, s.checkAlertDays);
  const units = new Map(d.units.map((u) => [u.id, u]));
  for (const p of d.payments) {
    if (p.cancelled || p.method !== 'check' || p.bankLineId) continue;
    if (p.valueDate >= today && p.valueDate <= horizon)
      out.push({ level: 'info', text: `צ'ק מ${unitFull(units.get(p.unitId))} על ₪${p.amount} ייפרע ב-${fmt(p.valueDate)}`, link: '#/payments' });
  }
  for (const e of d.expenses) {
    if (e.method !== 'check' || e.bankLineId) continue;
    const name = (e.vendorId && vendors.get(e.vendorId)?.name) || e.payee || '';
    if (e.valueDate >= today && e.valueDate <= horizon)
      out.push({ level: 'info', text: `צ'ק לספק ${name} על ₪${e.amount} ייפרע ב-${fmt(e.valueDate)}`, link: '#/expenses' });
  }
  // Backup reminder
  const last = s.lastBackupAt;
  if (d.payments.length + d.expenses.length > 0 && (!last || daysBetween(last.slice(0, 10), today) >= s.backupReminderDays)) {
    out.push({ level: 'warning', text: last ? `הגיבוי האחרון בוצע לפני ${daysBetween(last.slice(0, 10), today)} ימים` : 'טרם בוצע גיבוי של הנתונים', link: '#/settings/backup' });
  }
  // Overdue tenants (3+ months)
  for (const r of debtors(d)) {
    const overdue = r.unpaidMonths.filter((m) => m < cur).length;
    if (overdue >= 3) out.push({ level: 'danger', text: `${unitFull(r.unit)}: פיגור של ${overdue} חודשים (₪${r.debt})`, link: '#/units/' + r.unit.id });
  }
  return out;
}

function fmt(iso: string) {
  const [y, m, dd] = iso.split('-');
  return `${dd}/${m}/${y}`;
}

// ===== Reports =====

export function profitAndLoss(d: AppData, from: string, to: string) {
  const rows = ledgerRows(d).filter((r) => r.type !== 'opening' && r.type !== 'transfer' && r.date >= from && r.date <= to);
  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  for (const r of rows) {
    const m = r.amount >= 0 ? income : expense;
    m.set(r.category, round2((m.get(r.category) || 0) + Math.abs(r.amount)));
  }
  const totalIncome = round2([...income.values()].reduce((s, x) => s + x, 0));
  const totalExpense = round2([...expense.values()].reduce((s, x) => s + x, 0));
  return {
    income: [...income.entries()].sort((a, b) => b[1] - a[1]),
    expense: [...expense.entries()].sort((a, b) => b[1] - a[1]),
    totalIncome,
    totalExpense,
    net: round2(totalIncome - totalExpense),
  };
}

export function monthsOfYear(year: number) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

export function prevMonth(m: string) {
  return addMonths(m, -1);
}

// ===== Tenant statement (כרטסת דייר) =====

export interface StatementRow {
  key: string;
  date: string;
  description: string;
  charge: number;
  payment: number;
  balance: number;
  receiptNumber?: number;
  chargeId?: string;
  paymentId?: string;
  cancelled?: boolean;
}

export function unitStatement(d: AppData, unitId: string, upTo: string = currentMonth()): StatementRow[] {
  const items: Omit<StatementRow, 'balance'>[] = [];
  for (const c of d.charges) {
    if (c.unitId !== unitId || c.month > upTo) continue;
    items.push({ key: 'c' + c.id, date: c.date, description: c.kind === 'monthly' ? `${c.description} ${monthLabelShort(c.month)}` : c.description, charge: c.amount, payment: 0, chargeId: c.id });
  }
  for (const p of d.payments) {
    if (p.unitId !== unitId) continue;
    items.push({ key: 'p' + p.id, date: p.date, description: p.forText + (p.cancelled ? ' (מבוטל)' : ''), charge: 0, payment: p.cancelled ? 0 : p.amount, receiptNumber: p.receiptNumber, paymentId: p.id, cancelled: p.cancelled });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.charge ? -1 : 1));
  let bal = 0;
  return items.map((it) => {
    bal = round2(bal + it.charge - it.payment);
    return { ...it, balance: bal };
  });
}

function monthLabelShort(ym: string) {
  const names = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  return `${names[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}
