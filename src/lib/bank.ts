import type { AppData, BankLine, LedgerRow } from './types';
import { daysBetween, parseAmount, round2, toISO } from './format';
import { ledgerRows } from './calc';

export type Grid = (string | number | Date | null)[][];

export async function readSheet(file: File): Promise<Grid> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  let wb: import('xlsx').WorkBook;
  if (/\.(csv|txt)$/i.test(file.name)) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('windows-1255').decode(buf);
    }
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true }); // keep cells as text: DD/MM dates must not be parsed as US dates
  } else {
    wb = XLSX.read(buf, { type: 'array', cellDates: true });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  return grid;
}

export interface ColumnMap {
  headerRow: number;
  date: number;
  description: number;
  reference: number;
  credit: number; // זכות (in)
  debit: number; // חובה (out)
  amount: number; // single signed amount column
  balance: number;
}

const has = (cell: unknown, ...words: string[]) => typeof cell === 'string' && words.some((w) => cell.replace(/\s+/g, ' ').includes(w));

export function detectColumns(grid: Grid): ColumnMap {
  const map: ColumnMap = { headerRow: 0, date: -1, description: -1, reference: -1, credit: -1, debit: -1, amount: -1, balance: -1 };
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const row = grid[r] || [];
    if (row.some((c) => has(c, 'תאריך', 'Date', 'date')) && row.some((c) => has(c, 'זכות', 'חובה', 'סכום', 'Amount', 'Credit', 'Debit', 'בחובה', 'בזכות'))) {
      map.headerRow = r;
      row.forEach((c, i) => {
        if (typeof c !== 'string') return;
        if (map.date < 0 && has(c, 'תאריך ערך', 'Value')) map.date = i;
        else if (map.date < 0 && has(c, 'תאריך', 'Date')) map.date = i;
        if (map.description < 0 && has(c, 'תיאור', 'הפעולה', 'פרטים', 'Description', 'סוג פעולה')) map.description = i;
        if (map.reference < 0 && has(c, 'אסמכתא', 'אסמכתה', 'Reference')) map.reference = i;
        if (map.credit < 0 && has(c, 'זכות', 'Credit')) map.credit = i;
        if (map.debit < 0 && has(c, 'חובה', 'Debit')) map.debit = i;
        if (map.amount < 0 && has(c, 'סכום', 'Amount') && !has(c, 'זכות', 'חובה')) map.amount = i;
        if (map.balance < 0 && has(c, 'יתרה', 'Balance')) map.balance = i;
      });
      // prefer "תאריך" (transaction date) over value date if both exist
      const plain = row.findIndex((c) => typeof c === 'string' && c.trim() === 'תאריך');
      if (plain >= 0) map.date = plain;
      break;
    }
  }
  return map;
}

export function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // SheetJS creates dates at local midnight; nudge forward to absorb second-level TZ drift
    return toISO(new Date(v.getTime() + 30 * 60 * 1000));
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date (days since 1899-12-30)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

export function gridToLines(grid: Grid, map: ColumnMap, batchId: string): BankLine[] {
  const out: BankLine[] = [];
  for (let r = map.headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const date = map.date >= 0 ? parseDate(row[map.date]) : null;
    if (!date) continue;
    let amount = 0;
    if (map.amount >= 0) amount = parseAmount(row[map.amount] as string);
    else {
      const cr = map.credit >= 0 ? parseAmount(row[map.credit] as string) : 0;
      const db = map.debit >= 0 ? parseAmount(row[map.debit] as string) : 0;
      amount = Math.abs(cr) - Math.abs(db);
    }
    amount = round2(amount);
    if (!amount) continue;
    out.push({
      id: batchId + '-' + r,
      batchId,
      date,
      description: map.description >= 0 ? String(row[map.description] ?? '').trim() : '',
      reference: map.reference >= 0 && row[map.reference] != null ? String(row[map.reference]).trim() : undefined,
      amount,
      balance: map.balance >= 0 && row[map.balance] != null && row[map.balance] !== '' ? parseAmount(row[map.balance] as string) : undefined,
    });
  }
  return out;
}

export function lineKey(l: Pick<BankLine, 'date' | 'amount' | 'description' | 'reference'>) {
  return [l.date, l.amount.toFixed(2), (l.description || '').trim(), (l.reference || '').trim()].join('|');
}

/** Bank-side ledger rows (one per entity) */
export function bankBookRows(d: AppData): LedgerRow[] {
  return ledgerRows(d).filter((r) => r.account === 'bank' && r.type !== 'opening');
}

export function entityKey(r: LedgerRow) {
  return `${r.type}:${r.id}`;
}

/** Propose automatic matches: same amount, closest date within tolerance, reference bonus */
export function proposeMatches(d: AppData): { lineId: string; key: string; diff: number }[] {
  const lines = d.bankLines.filter((l) => !l.matchedTo && !l.ignored);
  const rows = bankBookRows(d).filter((r) => !r.bankLineId);
  const tol = d.settings.matchDays;
  const cands: { lineId: string; key: string; score: number; diff: number }[] = [];
  for (const l of lines) {
    for (const r of rows) {
      if (Math.abs(r.amount - l.amount) > 0.005) continue;
      const diff = Math.abs(daysBetween(r.valueDate, l.date));
      const refMatch = !!(r.reference && l.reference && (r.reference.includes(l.reference) || l.reference.includes(r.reference.replace(/\D/g, '') || '@@')));
      if (diff > tol && !(refMatch && diff <= 60)) continue;
      cands.push({ lineId: l.id, key: entityKey(r), score: diff - (refMatch ? 100 : 0), diff });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  const usedL = new Set<string>();
  const usedK = new Set<string>();
  const out: { lineId: string; key: string; diff: number }[] = [];
  for (const c of cands) {
    if (usedL.has(c.lineId) || usedK.has(c.key)) continue;
    usedL.add(c.lineId);
    usedK.add(c.key);
    out.push({ lineId: c.lineId, key: c.key, diff: c.diff });
  }
  return out;
}

/** Guess a category for an unmatched bank line from its description */
export function guessKind(l: BankLine): 'fee' | 'income' | 'expense' {
  if (l.amount > 0) return 'income';
  if (/עמל|דמי ניהול|ריבית חובה|עמלה/.test(l.description)) return 'fee';
  if (Math.abs(l.amount) < 60) return 'fee';
  return 'expense';
}
