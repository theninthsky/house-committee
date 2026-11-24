import type { PaymentMethod } from './types';

export const HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const nf = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const nf2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(n: number, decimals = false): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  // whole shekels print without agorot; anything with agorot always gets two digits
  const s = (decimals || !Number.isInteger(v) ? nf2 : nf).format(Math.abs(v));
  return (v < 0 ? '-' : '') + '₪' + s;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function todayISO(): string {
  const d = new Date();
  return toISO(d);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!d) return iso;
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

export function monthLabel(ym: string, short = false): string {
  const [y, m] = ym.split('-').map(Number);
  const name = HEB_MONTHS[m - 1];
  return short ? name : `${name} ${y}`;
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 1200) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a.slice(0, 10) + 'T00:00:00');
  const db = new Date(b.slice(0, 10) + 'T00:00:00');
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Describe a list of months compactly: "ינואר-מרץ 2026" */
export function describeMonths(months: string[]): string {
  if (!months.length) return '';
  const sorted = [...months].sort();
  const contiguous = sorted.every((m, i) => i === 0 || addMonths(sorted[i - 1], 1) === m);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length === 1) return monthLabel(first);
  if (contiguous) {
    if (first.slice(0, 4) === last.slice(0, 4)) return `${monthLabel(first, true)}-${monthLabel(last)}`;
    return `${monthLabel(first)} - ${monthLabel(last)}`;
  }
  return sorted.map((m) => monthLabel(m)).join(', ');
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: 'העברה בנקאית',
  standing_order: 'הוראת קבע',
  check: "צ'ק",
  app: 'ביט / פייבוקס',
  cash: 'מזומן',
  credit: 'כרטיס אשראי',
};

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function parseAmount(s: string | number | undefined | null): number {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  let t = String(s).replace(/[₪\s,]/g, '').replace(/[‎‏]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith('-')) {
    neg = true;
    t = t.slice(0, -1);
  }
  const n = parseFloat(t);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

export function cleanPhone(p?: string): string {
  if (!p) return '';
  let d = p.replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}
