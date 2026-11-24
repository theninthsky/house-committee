import type { AppData, Expense, Payment, Unit, Vendor } from './types';
import { emptyData, getData, replaceData } from './store';
import { runAutoSync } from './actions';
import { addDays, addMonths, currentMonth, describeMonths, monthRange, todayISO, uid } from './format';
import { ledgerRows } from './calc';

// deterministic pseudo random
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const NAMES = ['משפחת כהן', 'יוסי ורחל לוי', 'משפחת מזרחי', 'דוד אברהם', 'משפחת פרץ', 'שרה ביטון', 'משפחת דהן', 'אבי ורונית פרידמן', 'משפחת אזולאי', 'נועה שטרן', 'משפחת גולן'];

export function loadDemoData() {
  seed = 7;
  const d: AppData = emptyData();
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const start = `${year}-01`;
  const cur = currentMonth();
  Object.assign(d.settings, {
    buildingName: 'ועד הבית רחוב הדקל 14',
    address: 'רחוב הדקל 14',
    city: 'רמת גן',
    treasurerName: 'משה ישראלי',
    currentUser: 'משה ישראלי',
    phone: '050-0000000',
    openingDate: `${year}-01-01`,
    openingBank: 18450,
    openingCash: 320,
    nextReceiptNumber: 101,
    defaultMonthly: 250,
    setupDone: true,
    demo: true,
  });

  const units: Unit[] = NAMES.map((n, i) => ({
    id: uid() + i,
    aptNumber: String(i + 1),
    floor: String(Math.floor(i / 3)),
    ownerName: n,
    ownerPhone: `05${2 + (i % 4)}-${String(1000000 + i * 137531).slice(0, 7)}`,
    ownerEmail: `tenant${i + 1}@example.com`,
    payer: 'owner',
    billingStart: start,
    rates: i === 10 ? [{ from: start, amount: 300 }] : [{ from: start, amount: 250 }, { from: `${year}-07`, amount: 280 }],
  }));
  units[5].tenantName = 'עידו שוכר';
  units[5].tenantPhone = '054-7654321';
  units[5].payer = 'tenant';
  d.units = units;

  const v = (p: Partial<Vendor> & Pick<Vendor, 'name' | 'type' | 'category'>): Vendor => ({ id: uid() + p.name.length, ...p });
  const cleaning = v({ name: 'ניקיון זוהר בע"מ', type: 'fixed', category: 'ניקיון', service: 'ניקיון חדר מדרגות', monthlyAmount: 1200, paymentDay: 5, defaultMethod: 'transfer', phone: '03-5555555', contractStart: `${year - 1}-03-01`, contractEnd: `${year + 1}-02-28` });
  const garden = v({ name: 'גינון הדר', type: 'fixed', category: 'גינון', service: 'אחזקת גינה', monthlyAmount: 450, paymentDay: 10, defaultMethod: 'check' });
  const elevator = v({ name: 'מעליות שינדלר-דמו', type: 'fixed', category: 'מעליות', service: 'שירות ותחזוקת מעלית', monthlyAmount: 650, paymentDay: 15, defaultMethod: 'standing_order', autoRecord: true, autoFrom: start, contractEnd: `${year}-12-31` });
  const electric = v({ name: 'חברת החשמל', type: 'fixed', category: 'חשמל', service: 'חשמל משותף', monthlyAmount: 420, paymentDay: 20, frequency: 'bimonthly', defaultMethod: 'standing_order', autoFrom: `${year}-01` });
  const insurance = v({ name: 'ביטוח מבנה – הראל-דמו', type: 'fixed', category: 'ביטוח', service: 'ביטוח מבנה וצד ג\'', monthlyAmount: 3600, frequency: 'yearly', paymentDay: 1, autoFrom: `${year}-01`, contractStart: `${year - 1}-12-15`, contractEnd: addDays(today, 21) });
  const fees = v({ name: 'עמלות בנק', type: 'fixed', category: 'עמלות בנק', service: 'דמי ניהול חשבון', monthlyAmount: 18, paymentDay: 1, defaultMethod: 'standing_order', autoRecord: true, autoFrom: start });
  const plumber = v({ name: 'אינסטלציה מהירה – רוני', type: 'occasional', category: 'אחזקה שוטפת', service: 'אינסטלטור', phone: '052-1112233' });
  const pest = v({ name: 'הדברת השרון', type: 'occasional', category: 'הדברה', service: 'מדביר' });
  const roofer = v({ name: 'איטום גגות בע"מ', type: 'occasional', category: 'שיפוצים', service: 'איטום גג' });
  d.vendors = [cleaning, garden, elevator, electric, insurance, fees, plumber, pest, roofer];

  // special charge: roof waterproofing in June
  const roofGroup = uid();
  for (const u of units) d.charges.push({ id: uid() + u.aptNumber, unitId: u.id, month: `${year}-06`, date: `${year}-06-01`, amount: 1500, kind: 'special', description: 'איטום גג', groupId: roofGroup });

  const pays: Omit<Payment, 'receiptNumber'>[] = [];
  const pay = (u: Unit, date: string, amount: number, method: Payment['method'], forText: string, extra: Partial<Payment> = {}) => {
    if (date > today) return;
    pays.push({ id: uid() + pays.length, unitId: u.id, date, valueDate: extra.valueDate || date, amount, method, kind: 'regular', forText, account: method === 'cash' ? 'cash' : 'bank', createdAt: date + 'T10:00:00.000Z', reference: method === 'transfer' || method === 'standing_order' || method === 'app' ? String(Math.floor(rnd() * 900000 + 100000)) : undefined, ...extra });
  };
  const rate = (u: Unit, m: string) => [...u.rates].reverse().find((r) => r.from <= m)!.amount;
  const months = monthRange(start, cur);

  units.forEach((u, i) => {
    for (const m of months) {
      const day = String(2 + Math.floor(rnd() * 6)).padStart(2, '0');
      const date = `${m}-${day}`;
      if (i === 3) {
        // quarterly post-dated checks given at start of quarter
        if (['01', '04', '07', '10'].includes(m.slice(5))) {
          const q = [m, addMonths(m, 1), addMonths(m, 2)];
          q.forEach((qm, k) => pay(u, `${m}-03`, rate(u, qm), 'check', `דמי ועד ${describeMonths([qm])}`, { valueDate: `${qm}-10`, checkNumber: String(4100 + months.indexOf(m) * 3 + k), checkBank: 'לאומי 802' }));
        }
        continue;
      }
      if (i === 6 && m >= addMonths(cur, -3)) continue; // in arrears
      if (i === 8) {
        pay(u, date, rate(u, m), 'cash', `דמי ועד ${describeMonths([m])}`);
        continue;
      }
      if (i === 1 && m === start) {
        pay(u, `${m}-02`, 250 * 6, 'transfer', `דמי ועד ${describeMonths(monthRange(start, addMonths(start, 5)))}`);
        continue;
      }
      if (i === 1 && m <= addMonths(start, 5)) continue;
      if (i === 4 && m === cur) {
        pay(u, date, Math.round(rate(u, m) / 2), 'app', `דמי ועד ${describeMonths([m])} (חלקי)`);
        continue;
      }
      if (i === 9 && m === cur) continue; // not yet this month
      pay(u, date, rate(u, m), i % 3 === 0 ? 'app' : 'standing_order', `דמי ועד ${describeMonths([m])}`);
    }
    // roof special payment
    if (i !== 6 && i !== 2) pay(u, `${year}-06-${String(8 + i).padStart(2, '0')}`, 1500, i === 8 ? 'cash' : 'transfer', 'גבייה מיוחדת – איטום גג', { kind: 'special' });
    if (i === 2) pay(u, `${year}-07-04`, 750, 'transfer', 'גבייה מיוחדת – איטום גג (תשלום 1 מתוך 2)', { kind: 'special' });
  });
  pays.sort((a, b) => a.date.localeCompare(b.date));
  let rn = 101;
  d.payments = pays.map((p) => ({ ...p, receiptNumber: rn++ }));
  d.settings.nextReceiptNumber = rn;

  const exp = (e: Partial<Expense> & Pick<Expense, 'date' | 'amount' | 'category' | 'description'>) => {
    if (e.date > today) return;
    d.expenses.push({ id: uid() + d.expenses.length, valueDate: e.date, method: 'transfer', account: 'bank', attachmentIds: [], createdAt: e.date + 'T12:00:00.000Z', ...e });
  };
  for (const m of months) {
    if (m !== cur) exp({ vendorId: cleaning.id, date: `${m}-05`, amount: 1200, category: 'ניקיון', description: `ניקיון חדר מדרגות – ${describeMonths([m])}`, forMonth: m, reference: String(70000 + Number(m.slice(5))) });
    exp({ vendorId: garden.id, date: `${m}-10`, amount: 450, category: 'גינון', description: `אחזקת גינה – ${describeMonths([m])}`, forMonth: m, method: 'check', checkNumber: String(301 + Number(m.slice(5))), valueDate: `${m}-15` });
    if (Number(m.slice(5)) % 2 === 1) exp({ vendorId: electric.id, date: `${m}-20`, amount: Math.round(380 + rnd() * 80), category: 'חשמל', description: `חשמל משותף – ${describeMonths([m, addMonths(m, 1)])}`, forMonth: m, method: 'standing_order' });
  }
  exp({ vendorId: insurance.id, date: `${year}-01-01`, amount: 3600, category: 'ביטוח', description: 'פוליסת ביטוח מבנה שנתית', forMonth: `${year}-01`, method: 'standing_order' });
  exp({ vendorId: plumber.id, date: `${year}-03-14`, amount: 850, category: 'אחזקה שוטפת', description: 'תיקון נזילה בקומה 2' });
  exp({ vendorId: pest.id, date: `${year}-04-21`, amount: 600, category: 'הדברה', description: 'הדברה שנתית', method: 'app' });
  exp({ vendorId: roofer.id, date: `${year}-07-20`, amount: 14800, category: 'שיפוצים', description: 'איטום גג – תשלום סופי', method: 'check', checkNumber: '355', valueDate: `${year}-08-01` });
  exp({ vendorId: plumber.id, date: `${year}-09-02`, amount: 420, category: 'אחזקה שוטפת', description: 'החלפת ברז ראשי' });
  // petty cash
  exp({ payee: 'חומרי בניין השכונה', date: `${year}-02-11`, amount: 86, category: 'ציוד ומתכלים', description: 'נורות לחדר מדרגות', account: 'cash', method: 'cash' });
  exp({ payee: 'סופר', date: `${year}-05-03`, amount: 142, category: 'ניקיון', description: 'חומרי ניקיון', account: 'cash', method: 'cash' });
  exp({ payee: 'מנעולן', date: `${year}-08-17`, amount: 250, category: 'אחזקה שוטפת', description: 'מנעול לדלת הכניסה', account: 'cash', method: 'cash' });
  exp({ payee: 'חומרי בניין השכונה', date: `${year}-10-06`, amount: 64, category: 'ציוד ומתכלים', description: 'נורות LED', account: 'cash', method: 'cash' });
  d.transfers.push({ id: uid() + 't1', date: `${year}-03-01`, from: 'cash', to: 'bank', amount: 500, description: 'הפקדת מזומן מדייר דירה 9', createdAt: '' });
  d.transfers.push({ id: uid() + 't2', date: `${year}-07-01`, from: 'cash', to: 'bank', amount: 2000, description: 'הפקדת מזומן לבנק', createdAt: '' });
  d.transfers.push({ id: uid() + 't3', date: `${year}-09-15`, from: 'bank', to: 'cash', amount: 200, description: 'משיכה לקופה קטנה', createdAt: '' });

  d.audit.push({ id: uid(), ts: new Date().toISOString(), user: 'מערכת', action: 'create', entity: 'demo', summary: 'טעינת נתוני דוגמה' });
  void replaceData(d).then(() => runAutoSync());
}

/** A CSV bank statement matching the demo data (plus a few unrecorded fees) – for trying reconciliation */
export function buildDemoStatementCsv(): string {
  const d = getData();
  const today = todayISO();
  const from = addMonths(currentMonth(), -2) + '-01';
  const rows = ledgerRows(d).filter((r) => r.account === 'bank' && r.type !== 'opening' && r.valueDate >= from && r.valueDate <= today);
  const lines = rows
    .filter((_, i) => i % 9 !== 4) // some items not yet cleared in the bank
    .map((r) => ({ date: addDays(r.valueDate, r.type === 'payment' ? 1 : 0), desc: r.type === 'payment' ? `העברה מ${r.party.replace(/^דירה \d+ – /, '')}` : r.party || r.description, ref: r.reference?.replace(/\D/g, '') || '', amt: r.amount }));
  lines.push({ date: from.slice(0, 8) + '28', desc: 'עמלת העברה', ref: '', amt: -6.9 });
  lines.push({ date: addDays(today, -3), desc: 'עמלת פנקס שיקים', ref: '', amt: -12 });
  lines.push({ date: addDays(today, -5), desc: 'העברה מבן משפחה – נווה', ref: '889102', amt: 250 });
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const fmt = (iso: string) => iso.split('-').reverse().join('/');
  const out = ['תאריך,תאריך ערך,תיאור,אסמכתא,חובה,זכות,יתרה'];
  // statement opens with the book balance (everything earlier assumed cleared)
  const before = ledgerRows(d).filter((r) => r.account === 'bank' && r.valueDate < from).reduce((s, r) => s + r.amount, 0);
  let bal = Math.round(before * 100) / 100;
  for (const l of lines) {
    bal += l.amt;
    out.push([fmt(l.date), fmt(l.date), `"${l.desc.replace(/"/g, '""')}"`, l.ref, l.amt < 0 ? (-l.amt).toFixed(2) : '', l.amt > 0 ? l.amt.toFixed(2) : '', bal.toFixed(2)].join(','));
  }
  return '﻿' + out.join('\n');
}
