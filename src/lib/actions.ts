import type { AppData, BankBatch, BankLine, Charge, Expense, Payment, Settings, Transfer, Unit, Vendor } from './types';
import { assertUnlocked, getData, update, ValidationError } from './store';
import { syncMonthlyCharges, syncVendorAutoExpenses, unitFull } from './calc';
import { fileDel, fileSet } from './db';
import { money, round2, todayISO, uid } from './format';

const nowIso = () => new Date().toISOString();

function req(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new ValidationError(msg);
}

// ===== Auto generation =====

export function runAutoSync() {
  const d = getData();
  const probe = structuredClone(d);
  const c1 = syncMonthlyCharges(probe, uid);
  const c2 = syncVendorAutoExpenses(probe, uid);
  if (!c1 && !c2) return;
  update((x) => {
    syncMonthlyCharges(x, uid);
    syncVendorAutoExpenses(x, uid);
  });
}

// ===== Settings =====

export function saveSettings(patch: Partial<Settings>, summary = 'עדכון הגדרות') {
  update(
    (d) => {
      if (patch.openingDate !== undefined || patch.openingBank !== undefined || patch.openingCash !== undefined) {
        assertUnlocked(d, d.settings.openingDate, patch.openingDate);
      }
      Object.assign(d.settings, patch);
    },
    { action: 'settings', entity: 'settings', summary },
  );
  runAutoSync();
}

export function setYearLock(year: number, locked: boolean) {
  update(
    (d) => {
      const set = new Set(d.settings.lockedYears);
      if (locked) set.add(year);
      else set.delete(year);
      d.settings.lockedYears = [...set].sort();
    },
    { action: locked ? 'lock' : 'unlock', entity: 'period', entityId: String(year), summary: `${locked ? 'נעילת' : 'פתיחת'} שנת ${year}` },
  );
}

// ===== Units =====

export function saveUnit(u: Unit) {
  req(u.aptNumber.trim(), 'יש להזין מספר דירה');
  req(u.ownerName.trim() || u.tenantName?.trim(), 'יש להזין שם בעלים או שוכר');
  req(u.rates.length > 0, 'יש להזין תעריף דמי ועד');
  update(
    (d) => {
      const dup = d.units.find((x) => x.aptNumber.trim() === u.aptNumber.trim() && x.id !== u.id);
      req(!dup, `דירה ${u.aptNumber} כבר קיימת`);
      const i = d.units.findIndex((x) => x.id === u.id);
      if (i >= 0) d.units[i] = u;
      else d.units.push(u);
    },
    { action: getData().units.some((x) => x.id === u.id) ? 'update' : 'create', entity: 'unit', entityId: u.id, summary: `כרטיס ${unitFull(u)}` },
  );
  runAutoSync();
}

export function deleteUnit(id: string) {
  const d0 = getData();
  const u = d0.units.find((x) => x.id === id);
  req(!d0.payments.some((p) => p.unitId === id), 'לא ניתן למחוק דירה שיש לה תשלומים. ניתן לסמן תאריך עזיבה.');
  update(
    (d) => {
      d.units = d.units.filter((x) => x.id !== id);
      d.charges = d.charges.filter((c) => c.unitId !== id);
    },
    { action: 'delete', entity: 'unit', entityId: id, summary: `מחיקת ${unitFull(u)}` },
  );
}

// ===== Charges =====

export function saveCharge(c: Charge) {
  req(c.amount >= 0, 'סכום לא תקין');
  update(
    (d) => {
      assertUnlocked(d, c.date);
      const i = d.charges.findIndex((x) => x.id === c.id);
      if (i >= 0) {
        assertUnlocked(d, d.charges[i].date);
        d.charges[i] = { ...c, edited: c.auto ? true : c.edited };
      } else d.charges.push(c);
    },
    { action: getData().charges.some((x) => x.id === c.id) ? 'update' : 'create', entity: 'charge', entityId: c.id, summary: `חיוב ${c.description} ${money(c.amount)} – ${unitFull(getData().units.find((u) => u.id === c.unitId))}` },
  );
}

export function deleteCharge(id: string) {
  const c = getData().charges.find((x) => x.id === id);
  if (!c) return;
  update(
    (d) => {
      assertUnlocked(d, c.date);
      if (c.auto) {
        // keep a zero-amount record so the monthly sync won't recreate it
        const x = d.charges.find((y) => y.id === id)!;
        x.amount = 0;
        x.edited = true;
        x.description = 'דמי ועד (פטור)';
      } else d.charges = d.charges.filter((x) => x.id !== id);
    },
    { action: 'delete', entity: 'charge', entityId: id, summary: `ביטול חיוב ${c.description} ${money(c.amount)} (${c.month})` },
  );
}

export function createSpecialCharge(opts: { unitIds: string[]; amounts: Record<string, number>; date: string; description: string }) {
  req(opts.description.trim(), 'יש להזין תיאור לחיוב');
  req(opts.unitIds.length, 'יש לבחור לפחות דירה אחת');
  const groupId = uid();
  const total = round2(opts.unitIds.reduce((s, id) => s + (opts.amounts[id] || 0), 0));
  update(
    (d) => {
      assertUnlocked(d, opts.date);
      for (const unitId of opts.unitIds) {
        const amount = opts.amounts[unitId] || 0;
        if (amount <= 0) continue;
        d.charges.push({ id: uid(), unitId, month: opts.date.slice(0, 7), date: opts.date, amount, kind: 'special', description: opts.description, groupId });
      }
    },
    { action: 'create', entity: 'charge', entityId: groupId, summary: `חיוב מיוחד "${opts.description}" ל-${opts.unitIds.length} דירות, סה"כ ${money(total)}` },
  );
}

// ===== Payments (tenant receipts) =====

export function savePayment(p: Payment, opts: { issueReceipt: boolean }): Payment {
  req(p.unitId, 'יש לבחור דירה');
  req(p.amount > 0, 'יש להזין סכום חיובי');
  req(p.date, 'יש להזין תאריך');
  const isNew = !getData().payments.some((x) => x.id === p.id);
  let saved = p;
  update(
    (d) => {
      assertUnlocked(d, p.date);
      const i = d.payments.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        const old = d.payments[i];
        assertUnlocked(d, old.date);
        req(!old.cancelled, 'לא ניתן לערוך תקבול מבוטל');
        if (old.receiptNumber) {
          // receipt already issued: amount/unit are fixed on the document
          req(old.amount === p.amount && old.unitId === p.unitId, 'לתקבול זה הופקה קבלה. לשינוי סכום או דירה יש לבטל את הקבלה ולהפיק חדשה.');
        }
        saved = { ...p, receiptNumber: old.receiptNumber, bankLineId: old.bankLineId };
        d.payments[i] = saved;
      } else {
        saved = { ...p, createdAt: nowIso() };
        if (opts.issueReceipt) {
          saved.receiptNumber = d.settings.nextReceiptNumber;
          d.settings.nextReceiptNumber += 1;
        }
        d.payments.push(saved);
      }
    },
    {
      action: isNew ? 'create' : 'update',
      entity: 'payment',
      entityId: p.id,
      summary: `תקבול ${money(p.amount)} מ${unitFull(getData().units.find((u) => u.id === p.unitId))}`,
    },
  );
  return getData().payments.find((x) => x.id === p.id) || saved;
}

export function issueReceipt(paymentId: string) {
  update(
    (d) => {
      const p = d.payments.find((x) => x.id === paymentId)!;
      req(!p.receiptNumber, 'כבר הופקה קבלה');
      req(!p.cancelled, 'התקבול מבוטל');
      p.receiptNumber = d.settings.nextReceiptNumber;
      d.settings.nextReceiptNumber += 1;
    },
    { action: 'create', entity: 'receipt', entityId: paymentId, summary: `הפקת קבלה מס' ${getData().settings.nextReceiptNumber}` },
  );
}

/** Payments with receipts are never deleted – they are cancelled, keeping the receipt number. */
export function cancelPayment(id: string, reason: string) {
  const p = getData().payments.find((x) => x.id === id);
  if (!p) return;
  update(
    (d) => {
      assertUnlocked(d, p.date);
      const x = d.payments.find((y) => y.id === id)!;
      x.cancelled = true;
      x.cancelReason = reason;
      if (x.bankLineId) {
        const line = d.bankLines.find((l) => l.id === x.bankLineId);
        if (line) line.matchedTo = undefined;
        x.bankLineId = undefined;
      }
    },
    { action: 'cancel', entity: 'payment', entityId: id, summary: `ביטול תקבול${p.receiptNumber ? ` (קבלה ${p.receiptNumber})` : ''} ${money(p.amount)}: ${reason}` },
  );
}

export function deletePayment(id: string) {
  const p = getData().payments.find((x) => x.id === id);
  if (!p) return;
  req(!p.receiptNumber, 'לתקבול זה הופקה קבלה – ניתן רק לבטל אותו, כדי לשמור על רצף מספרי הקבלות.');
  update(
    (d) => {
      assertUnlocked(d, p.date);
      unlinkBank(d, p.bankLineId);
      d.payments = d.payments.filter((x) => x.id !== id);
    },
    { action: 'delete', entity: 'payment', entityId: id, summary: `מחיקת תקבול ${money(p.amount)}` },
  );
}

// ===== Vendors =====

export function saveVendor(v: Vendor) {
  req(v.name.trim(), 'יש להזין שם ספק');
  const isNew = !getData().vendors.some((x) => x.id === v.id);
  update(
    (d) => {
      const i = d.vendors.findIndex((x) => x.id === v.id);
      if (i >= 0) d.vendors[i] = v;
      else d.vendors.push(v);
    },
    { action: isNew ? 'create' : 'update', entity: 'vendor', entityId: v.id, summary: `ספק ${v.name}` },
  );
  runAutoSync();
}

export function deleteVendor(id: string) {
  const d0 = getData();
  const v = d0.vendors.find((x) => x.id === id);
  if (d0.expenses.some((e) => e.vendorId === id)) {
    update(
      (d) => {
        const x = d.vendors.find((y) => y.id === id)!;
        x.archived = true;
        x.autoRecord = false;
      },
      { action: 'update', entity: 'vendor', entityId: id, summary: `העברת הספק ${v?.name} לארכיון` },
    );
    return 'archived';
  }
  update((d) => void (d.vendors = d.vendors.filter((x) => x.id !== id)), { action: 'delete', entity: 'vendor', entityId: id, summary: `מחיקת ספק ${v?.name}` });
  return 'deleted';
}

// ===== Expenses =====

export function saveExpense(e: Expense) {
  req(e.amount > 0, 'יש להזין סכום חיובי');
  req(e.date, 'יש להזין תאריך');
  req(e.category, 'יש לבחור סעיף');
  const isNew = !getData().expenses.some((x) => x.id === e.id);
  const vName = getData().vendors.find((v) => v.id === e.vendorId)?.name || e.payee || '';
  update(
    (d) => {
      assertUnlocked(d, e.date);
      const i = d.expenses.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        assertUnlocked(d, d.expenses[i].date);
        d.expenses[i] = { ...e, bankLineId: d.expenses[i].bankLineId };
      } else d.expenses.push({ ...e, createdAt: nowIso() });
    },
    { action: isNew ? 'create' : 'update', entity: 'expense', entityId: e.id, summary: `הוצאה ${money(e.amount)} ${vName} – ${e.description}` },
  );
}

export function deleteExpense(id: string) {
  const e = getData().expenses.find((x) => x.id === id);
  if (!e) return;
  update(
    (d) => {
      assertUnlocked(d, e.date);
      unlinkBank(d, e.bankLineId);
      d.expenses = d.expenses.filter((x) => x.id !== id);
      if (e.auto && e.vendorId && e.forMonth) {
        const v = d.vendors.find((x) => x.id === e.vendorId);
        if (v) v.autoSkip = [...(v.autoSkip || []), e.forMonth];
      }
      const used = new Set(d.expenses.flatMap((x) => x.attachmentIds));
      for (const a of e.attachmentIds) if (!used.has(a)) d.attachments = d.attachments.filter((x) => x.id !== a);
    },
    { action: 'delete', entity: 'expense', entityId: id, summary: `מחיקת הוצאה ${money(e.amount)} – ${e.description}` },
  );
  for (const a of e.attachmentIds) if (!getData().attachments.some((x) => x.id === a)) void fileDel(a);
}

export async function addAttachment(file: File): Promise<string> {
  const id = uid();
  await fileSet(id, file);
  update((d) => void d.attachments.push({ id, name: file.name, type: file.type, size: file.size, createdAt: nowIso() }));
  return id;
}

// ===== Transfers =====

export function saveTransfer(t: Transfer) {
  req(t.amount > 0, 'יש להזין סכום חיובי');
  req(t.from !== t.to, 'חשבון מקור ויעד זהים');
  const isNew = !getData().transfers.some((x) => x.id === t.id);
  update(
    (d) => {
      assertUnlocked(d, t.date);
      const i = d.transfers.findIndex((x) => x.id === t.id);
      if (i >= 0) {
        assertUnlocked(d, d.transfers[i].date);
        d.transfers[i] = { ...t, bankLineId: d.transfers[i].bankLineId };
      } else d.transfers.push({ ...t, createdAt: nowIso() });
    },
    { action: isNew ? 'create' : 'update', entity: 'transfer', entityId: t.id, summary: `${t.to === 'bank' ? 'הפקדת מזומן לבנק' : 'משיכת מזומן לקופה'} ${money(t.amount)}` },
  );
}

export function deleteTransfer(id: string) {
  const t = getData().transfers.find((x) => x.id === id);
  if (!t) return;
  update(
    (d) => {
      assertUnlocked(d, t.date);
      unlinkBank(d, t.bankLineId);
      d.transfers = d.transfers.filter((x) => x.id !== id);
    },
    { action: 'delete', entity: 'transfer', entityId: id, summary: `מחיקת העברה ${money(t.amount)}` },
  );
}

// ===== Bank =====

function unlinkBank(d: AppData, lineId?: string) {
  if (!lineId) return;
  const l = d.bankLines.find((x) => x.id === lineId);
  if (l) l.matchedTo = undefined;
}

export function importBankLines(batch: BankBatch, lines: BankLine[]) {
  update(
    (d) => {
      d.bankBatches.push(batch);
      d.bankLines.push(...lines);
    },
    { action: 'import', entity: 'bank', entityId: batch.id, summary: `ייבוא דף בנק ${batch.fileName}: ${lines.length} תנועות` },
  );
}

export function deleteBankBatch(batchId: string) {
  const b = getData().bankBatches.find((x) => x.id === batchId);
  update(
    (d) => {
      const ids = new Set(d.bankLines.filter((l) => l.batchId === batchId).map((l) => l.id));
      for (const arr of [d.payments, d.expenses, d.transfers] as { bankLineId?: string }[][])
        for (const x of arr) if (x.bankLineId && ids.has(x.bankLineId)) x.bankLineId = undefined;
      d.bankLines = d.bankLines.filter((l) => l.batchId !== batchId);
      d.bankBatches = d.bankBatches.filter((x) => x.id !== batchId);
    },
    { action: 'delete', entity: 'bank', entityId: batchId, summary: `מחיקת דף בנק ${b?.fileName}` },
  );
}

/** key: 'payment:id' | 'expense:id' | 'transfer:id' */
export function matchBankLine(lineId: string, key: string, opts: { silent?: boolean } = {}) {
  update(
    (d) => {
      const line = d.bankLines.find((l) => l.id === lineId)!;
      if (line.matchedTo) unmatchIn(d, line);
      const [type, id] = key.split(':');
      const arr = (type === 'payment' ? d.payments : type === 'expense' ? d.expenses : d.transfers) as { id: string; bankLineId?: string }[];
      const ent = arr.find((x) => x.id === id);
      if (!ent) return;
      if (ent.bankLineId) {
        const other = d.bankLines.find((l) => l.id === ent.bankLineId);
        if (other) other.matchedTo = undefined;
      }
      ent.bankLineId = lineId;
      line.matchedTo = type + ':' + id;
      line.ignored = false;
    },
    opts.silent ? undefined : { action: 'update', entity: 'bank', entityId: lineId, summary: 'התאמת תנועת בנק ידנית' },
  );
}

function unmatchIn(d: AppData, line: BankLine) {
  if (!line.matchedTo) return;
  const [type, id] = line.matchedTo.split(':');
  const arr = (type === 'payment' ? d.payments : type === 'expense' ? d.expenses : d.transfers) as { id: string; bankLineId?: string }[];
  const ent = arr.find((x) => x.id === id);
  if (ent && ent.bankLineId === line.id) ent.bankLineId = undefined;
  line.matchedTo = undefined;
}

export function unmatchBankLine(lineId: string) {
  update(
    (d) => {
      const line = d.bankLines.find((l) => l.id === lineId);
      if (line) unmatchIn(d, line);
    },
    { action: 'update', entity: 'bank', entityId: lineId, summary: 'ביטול התאמת תנועת בנק' },
  );
}

export function setBankLineIgnored(lineId: string, ignored: boolean) {
  update((d) => {
    const line = d.bankLines.find((l) => l.id === lineId);
    if (line) line.ignored = ignored;
  });
}

export function applyAutoMatches(pairs: { lineId: string; key: string }[]) {
  if (!pairs.length) return;
  for (const p of pairs) matchBankLine(p.lineId, p.key, { silent: true });
  update(() => {}, { action: 'update', entity: 'bank', summary: `התאמה אוטומטית של ${pairs.length} תנועות בנק` });
}

export function saveReconciliation(date: string, statementBalance: number, systemBalance: number, note?: string) {
  update(
    (d) => void d.reconciliations.push({ id: uid(), date, statementBalance, systemBalance, note, createdAt: nowIso() }),
    { action: 'create', entity: 'reconciliation', summary: `אישור התאמת בנק ליום ${date}: יתרת בנק ${money(statementBalance)}, יתרה בספרים ${money(systemBalance)}` },
  );
}

export function defaultExpense(partial: Partial<Expense> = {}): Expense {
  const t = todayISO();
  return {
    id: uid(),
    date: t,
    valueDate: t,
    category: '',
    description: '',
    amount: 0,
    method: 'transfer',
    account: 'bank',
    attachmentIds: [],
    createdAt: '',
    ...partial,
  };
}
