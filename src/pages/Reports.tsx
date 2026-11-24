import { useMemo, useState } from 'react';
import { useData } from '../lib/store';
import { accountBalance, debtors, ledgerRows, monthsOfYear, profitAndLoss, sortUnits, unitAccount, unitFull, unitStatement } from '../lib/calc';
import { fmtDate, HEB_MONTHS, money, monthLabel, round2, todayISO } from '../lib/format';
import { exportExcel } from '../lib/excel';
import { Empty, Field, Icon, Money, navigate, PageHead, Seg } from '../components/ui';

const TABS = [
  { id: 'pnl', label: 'רווח והפסד' },
  { id: 'debtors', label: 'חייבים (גיול חובות)' },
  { id: 'tenant', label: 'כרטסת דייר' },
  { id: 'vendors', label: 'הוצאות ספקים' },
  { id: 'cash', label: 'תנועות קופה קטנה' },
];

export function ReportsPage({ tab = 'pnl' }: { tab?: string }) {
  const d = useData();
  const year = todayISO().slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const title = TABS.find((t) => t.id === tab)?.label || '';
  const needsPeriod = tab !== 'debtors' && tab !== 'tenant';
  return (
    <>
      <div className="print-only print-head">
        <h2>{d.settings.buildingName} – {title}</h2>
        <div>{needsPeriod ? `לתקופה ${fmtDate(from)} – ${fmtDate(to)}` : `נכון ל-${fmtDate(todayISO())}`} · הופק {fmtDate(todayISO())}</div>
      </div>
      <PageHead title="דוחות" actions={<button className="btn" onClick={() => window.print()}><Icon name="print" />PDF / הדפסה</button>} />
      <div className="tabs no-print">
        {TABS.map((t) => <a key={t.id} href={'#/reports/' + t.id} className={tab === t.id ? 'on' : ''}>{t.label}</a>)}
      </div>
      {needsPeriod && (
        <div className="row mb no-print" style={{ alignItems: 'flex-end' }}>
          <Field label="מתאריך"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="עד תאריך"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Seg value="" onChange={(v) => { setFrom(`${v}-01-01`); setTo(`${v}-12-31`); }} options={[Number(year), Number(year) - 1, Number(year) - 2].map((y) => ({ value: String(y), label: `שנת ${y}` }))} />
        </div>
      )}
      {tab === 'pnl' && <PnL from={from} to={to} />}
      {tab === 'debtors' && <Debtors />}
      {tab === 'tenant' && <TenantReport />}
      {tab === 'vendors' && <VendorReport from={from} to={to} />}
      {tab === 'cash' && <CashReport from={from} to={to} />}
    </>
  );
}

function ExcelBtn({ onClick }: { onClick: () => void }) {
  return <button className="btn sm no-print" onClick={onClick}><Icon name="download" />Excel</button>;
}

function PnL({ from, to }: { from: string; to: string }) {
  const d = useData();
  const pl = useMemo(() => profitAndLoss(d, from, to), [d, from, to]);
  // opening = everything before the period, plus opening balances dated on its first day
  const openingOf = (acc: 'bank' | 'cash') => round2(ledgerRows(d).filter((r) => r.account === acc && (r.valueDate < from || (r.type === 'opening' && r.valueDate <= from))).reduce((s, r) => s + r.amount, 0));
  const ob = openingOf('bank'), oc = openingOf('cash');
  const cb = accountBalance(d, 'bank', to), cc = accountBalance(d, 'cash', to);
  const debt = round2(d.units.reduce((s, u) => s + Math.max(0, unitAccount(d, u).balance), 0));

  const exportXlsx = () =>
    exportExcel(`רווח-והפסד-${from}-${to}`, [
      {
        name: 'רווח והפסד',
        rows: [
          [`${d.settings.buildingName} – דוח רווח והפסד`],
          [`לתקופה ${fmtDate(from)} – ${fmtDate(to)}`],
          [],
          ['הכנסות', ''],
          ...pl.income.map(([c, v]) => [c, v]),
          ['סה"כ הכנסות', pl.totalIncome],
          [],
          ['הוצאות', ''],
          ...pl.expense.map(([c, v]) => [c, v]),
          ['סה"כ הוצאות', pl.totalExpense],
          [],
          [pl.net >= 0 ? 'עודף לתקופה' : 'גירעון לתקופה', pl.net],
          [],
          ['יתרות', 'פתיחה', 'סגירה'],
          ['בנק', ob, cb],
          ['קופה קטנה', oc, cc],
          ['סה"כ', round2(ob + oc), round2(cb + cc)],
        ],
      },
    ]);

  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><h2>דוח רווח והפסד</h2><ExcelBtn onClick={exportXlsx} /></div>
        <table className="t">
          <tbody>
            <tr><td colSpan={2} className="bold" style={{ background: 'var(--green-soft)' }}>הכנסות</td></tr>
            {pl.income.map(([c, v]) => <tr key={c}><td>{c}</td><td className="amt"><Money v={v} /></td></tr>)}
            {pl.income.length === 0 && <tr><td className="muted" colSpan={2}>אין הכנסות בתקופה</td></tr>}
            <tr><td className="bold">סה"כ הכנסות</td><td className="amt bold pos"><Money v={pl.totalIncome} /></td></tr>
            <tr><td colSpan={2} className="bold" style={{ background: 'var(--red-soft)' }}>הוצאות</td></tr>
            {pl.expense.map(([c, v]) => <tr key={c}><td>{c}</td><td className="amt"><Money v={v} /></td></tr>)}
            {pl.expense.length === 0 && <tr><td className="muted" colSpan={2}>אין הוצאות בתקופה</td></tr>}
            <tr><td className="bold">סה"כ הוצאות</td><td className="amt bold neg"><Money v={pl.totalExpense} /></td></tr>
          </tbody>
          <tfoot>
            <tr><td>{pl.net >= 0 ? 'עודף לתקופה' : 'גירעון לתקופה'}</td><td className={'amt ' + (pl.net >= 0 ? 'pos' : 'neg')}><Money v={pl.net} /></td></tr>
          </tfoot>
        </table>
      </div>
      <div>
        <div className="card">
          <div className="card-head"><h2>יתרות</h2></div>
          <table className="t">
            <thead><tr><th /><th className="amt">פתיחה ({fmtDate(from)})</th><th className="amt">סגירה ({fmtDate(to)})</th></tr></thead>
            <tbody>
              <tr><td>בנק</td><td className="amt"><Money v={ob} /></td><td className="amt"><Money v={cb} /></td></tr>
              <tr><td>קופה קטנה</td><td className="amt"><Money v={oc} /></td><td className="amt"><Money v={cc} /></td></tr>
            </tbody>
            <tfoot><tr><td>סה"כ</td><td className="amt"><Money v={ob + oc} /></td><td className="amt"><Money v={cb + cc} /></td></tr></tfoot>
          </table>
        </div>
        <div className="card card-pad stat">
          <div className="label">חובות פתוחים של דיירים (נכון להיום)</div>
          <div className="value neg"><Money v={debt} /></div>
          <div className="meta">לא נכלל בדוח – הדוח מבוסס על תקבולים בפועל (בסיס מזומן)</div>
        </div>
      </div>
    </div>
  );
}

function Debtors() {
  const d = useData();
  const rows = useMemo(() => debtors(d), [d]);
  const total = round2(rows.reduce((s, r) => s + r.debt, 0));
  const exportXlsx = () =>
    exportExcel('דוח-חייבים', [
      {
        name: 'חייבים',
        rows: [
          ['דירה', 'שם', 'טלפון', 'חוב', 'חודשים בפיגור', '0-30 יום', '31-60', '61-90', 'מעל 90', 'חודשים פתוחים'],
          ...rows.map((r) => [r.unit.aptNumber, unitFull(r.unit), r.unit.ownerPhone || r.unit.tenantPhone || '', r.debt, r.unpaidMonths.length, ...r.buckets, r.unpaidMonths.map((m) => monthLabel(m)).join(', ')]),
          [],
          ['', 'סה"כ', '', total],
        ],
      },
    ]);
  return (
    <div className="card">
      <div className="card-head"><h2>דוח חייבים – גיול חובות</h2><div className="row"><span>סה"כ חוב: <b className="neg"><Money v={total} /></b></span><ExcelBtn onClick={exportXlsx} /></div></div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>דירה</th><th>חודשים פתוחים</th><th className="amt">0-30 יום</th><th className="amt">31-60</th><th className="amt">61-90</th><th className="amt">מעל 90</th><th className="amt">סה"כ חוב</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.unit.id} className="clickable" onClick={() => navigate('/units/' + r.unit.id)}>
                <td className="bold">{unitFull(r.unit)}</td>
                <td className="small">{r.unpaidMonths.map((m) => monthLabel(m)).join(', ')}{r.unpaidMonths.length >= 3 && <span className="badge red" style={{ marginInlineStart: 6 }}>{r.unpaidMonths.length} חודשים</span>}</td>
                {r.buckets.map((b, i) => <td key={i} className={'amt ' + (b && i >= 2 ? 'neg bold' : '')}>{b ? <Money v={b} /> : ''}</td>)}
                <td className="amt bold neg"><Money v={r.debt} /></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr><td colSpan={2}>סה"כ</td>{[0, 1, 2, 3].map((i) => <td key={i} className="amt"><Money v={round2(rows.reduce((s, r) => s + r.buckets[i], 0))} /></td>)}<td className="amt"><Money v={total} /></td></tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && <Empty icon="🎉">אין דיירים בחוב</Empty>}
      </div>
    </div>
  );
}

function TenantReport() {
  const d = useData();
  const units = sortUnits(d.units);
  const [id, setId] = useState(units[0]?.id || '');
  const u = d.units.find((x) => x.id === id);
  const rows = u ? unitStatement(d, u.id) : [];
  const acc = u ? unitAccount(d, u) : null;
  const exportXlsx = () => u && exportExcel(`כרטסת-דירה-${u.aptNumber}`, [{ name: 'כרטסת', rows: [[`כרטסת ${unitFull(u)}`], [], ['תאריך', 'תיאור', 'קבלה', 'חיוב', 'תשלום', 'יתרה'], ...rows.map((r) => [fmtDate(r.date), r.description, r.receiptNumber ?? '', r.charge || '', r.payment || '', r.balance])] }]);
  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <select className="input no-print" value={id} onChange={(e) => setId(e.target.value)} style={{ width: 260 }}>
            {units.map((x) => <option key={x.id} value={x.id}>{unitFull(x)}</option>)}
          </select>
          <h2 className="print-only">{unitFull(u)}</h2>
        </div>
        <div className="row">{acc && <span>יתרה: <b className={acc.balance > 0 ? 'neg' : 'pos'}>{acc.balance > 0 ? 'חוב ' : acc.balance < 0 ? 'זכות ' : ''}<span className="num">{money(Math.abs(acc.balance))}</span></b></span>}<ExcelBtn onClick={exportXlsx} /></div>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>תאריך</th><th>תיאור</th><th>קבלה</th><th className="amt">חיוב</th><th className="amt">תשלום</th><th className="amt">יתרה</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.cancelled ? 'cancelled' : ''}>
                <td className="num">{fmtDate(r.date)}</td><td>{r.description}</td><td>{r.receiptNumber ?? ''}</td>
                <td className="amt">{r.charge ? <Money v={r.charge} /> : ''}</td>
                <td className="amt pos">{r.payment ? <Money v={r.payment} /> : ''}</td>
                <td className={'amt bold ' + (r.balance > 0 ? 'neg' : r.balance < 0 ? 'pos' : '')}><Money v={r.balance} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>אין נתונים</Empty>}
      </div>
    </div>
  );
}

function VendorReport({ from, to }: { from: string; to: string }) {
  const d = useData();
  const [by, setBy] = useState<'vendor' | 'category'>('category');
  const exps = d.expenses.filter((e) => e.date >= from && e.date <= to);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const months = sameYear ? monthsOfYear(Number(from.slice(0, 4))).filter((m) => m >= from.slice(0, 7) && m <= to.slice(0, 7)) : [];
  const vendors = new Map(d.vendors.map((v) => [v.id, v]));
  const keyOf = (e: (typeof exps)[number]) => (by === 'category' ? e.category : vendors.get(e.vendorId || '')?.name || e.payee || 'ללא ספק');
  const groups = new Map<string, { total: number; count: number; months: Record<string, number> }>();
  for (const e of exps) {
    const k = keyOf(e);
    const g = groups.get(k) || { total: 0, count: 0, months: {} };
    g.total = round2(g.total + e.amount);
    g.count++;
    const m = e.date.slice(0, 7);
    g.months[m] = round2((g.months[m] || 0) + e.amount);
    groups.set(k, g);
  }
  const list = [...groups.entries()].sort((a, b) => b[1].total - a[1].total);
  const total = round2(list.reduce((s, [, g]) => s + g.total, 0));
  const exportXlsx = () =>
    exportExcel('הוצאות-ספקים', [
      {
        name: by === 'category' ? 'לפי סעיף' : 'לפי ספק',
        rows: [[by === 'category' ? 'סעיף' : 'ספק', 'מס\' תשלומים', ...months.map((m) => HEB_MONTHS[Number(m.slice(5)) - 1]), 'סה"כ', '% מהסך'], ...list.map(([k, g]) => [k, g.count, ...months.map((m) => g.months[m] || ''), g.total, total ? Math.round((g.total / total) * 1000) / 10 : 0]), [], ['סה"כ', '', ...months.map((m) => round2(list.reduce((s, [, g]) => s + (g.months[m] || 0), 0))), total]],
      },
    ]);
  return (
    <div className="card">
      <div className="card-head">
        <Seg value={by} onChange={setBy} options={[{ value: 'category', label: 'לפי סעיף' }, { value: 'vendor', label: 'לפי ספק' }]} />
        <div className="row"><span>סה"כ: <b><Money v={total} /></b></span><ExcelBtn onClick={exportXlsx} /></div>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{by === 'category' ? 'סעיף' : 'ספק'}</th>{months.map((m) => <th key={m} className="amt">{HEB_MONTHS[Number(m.slice(5)) - 1]}</th>)}<th className="amt">סה"כ</th><th className="amt">%</th></tr></thead>
          <tbody>
            {list.map(([k, g]) => (
              <tr key={k}>
                <td className="bold">{k}</td>
                {months.map((m) => <td key={m} className="amt small">{g.months[m] ? <Money v={g.months[m]} /> : ''}</td>)}
                <td className="amt bold"><Money v={g.total} /></td>
                <td className="amt small">{total ? Math.round((g.total / total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td>סה"כ</td>{months.map((m) => <td key={m} className="amt small"><Money v={round2(list.reduce((s, [, g]) => s + (g.months[m] || 0), 0))} /></td>)}<td className="amt"><Money v={total} /></td><td /></tr></tfoot>
        </table>
        {list.length === 0 && <Empty>אין הוצאות בתקופה</Empty>}
      </div>
    </div>
  );
}

function CashReport({ from, to }: { from: string; to: string }) {
  const d = useData();
  const all = useMemo(() => ledgerRows(d).filter((r) => r.account === 'cash'), [d]);
  const opening = round2(all.filter((r) => r.date < from).reduce((s, r) => s + r.amount, 0));
  const rows = all.filter((r) => r.date >= from && r.date <= to);
  const inSum = round2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const outSum = round2(rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0));
  let bal = opening;
  const exportXlsx = () => {
    let b = opening;
    exportExcel('קופה-קטנה', [{ name: 'קופה קטנה', rows: [['תאריך', 'תיאור', 'צד', 'סעיף', 'כניסה', 'יציאה', 'יתרה'], ['', 'יתרת פתיחה', '', '', '', '', opening], ...rows.map((r) => { b = round2(b + r.amount); return [fmtDate(r.date), r.description, r.party, r.category, r.amount > 0 ? r.amount : '', r.amount < 0 ? -r.amount : '', b]; }), [], ['', 'סה"כ', '', '', inSum, outSum, b]] }]);
  };
  return (
    <div className="card">
      <div className="card-head"><h2>דוח תנועות קופה קטנה</h2><ExcelBtn onClick={exportXlsx} /></div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>תאריך</th><th>תיאור</th><th>צד</th><th>סעיף</th><th className="amt">כניסה</th><th className="amt">יציאה</th><th className="amt">יתרה</th></tr></thead>
          <tbody>
            <tr className="muted"><td>{fmtDate(from)}</td><td colSpan={5}>יתרת פתיחה</td><td className="amt"><Money v={opening} /></td></tr>
            {rows.map((r) => {
              bal = round2(bal + r.amount);
              return (
                <tr key={r.key}>
                  <td className="num">{fmtDate(r.date)}</td><td>{r.description}</td><td>{r.party}</td><td>{r.category}</td>
                  <td className="amt pos">{r.amount > 0 ? <Money v={r.amount} /> : ''}</td>
                  <td className="amt neg">{r.amount < 0 ? <Money v={-r.amount} /> : ''}</td>
                  <td className="amt bold"><Money v={bal} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={4}>סה"כ / יתרת סגירה</td><td className="amt"><Money v={inSum} /></td><td className="amt"><Money v={outSum} /></td><td className="amt"><Money v={bal} /></td></tr></tfoot>
        </table>
      </div>
      <div className="card-pad small muted">יתרת הסגירה אמורה להיות זהה לספירה הפיזית של המזומן בקופה. ניתן לבצע ספירת קופה במסך "קופה קטנה".</div>
    </div>
  );
}
