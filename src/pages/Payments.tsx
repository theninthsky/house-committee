import { useMemo, useState } from 'react';
import { useData } from '../lib/store';
import { cancelPayment, deletePayment, issueReceipt } from '../lib/actions';
import { sortUnits, unitFull } from '../lib/calc';
import { fmtDate, METHOD_LABELS, round2, todayISO } from '../lib/format';
import { exportExcel } from '../lib/excel';
import type { PaymentMethod } from '../lib/types';
import { attempt, confirmDialog, Empty, Field, Icon, Money, PageHead, promptDialog, Seg } from '../components/ui';
import { openForm } from '../components/forms';

export function PaymentsPage() {
  const d = useData();
  const [view, setView] = useState<'all' | 'checks'>('all');
  const [q, setQ] = useState('');
  const [unit, setUnit] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState(todayISO().slice(0, 4) + '-01-01');
  const [to, setTo] = useState('');
  const units = new Map(d.units.map((u) => [u.id, u]));

  const list = useMemo(() => {
    let l = [...d.payments];
    if (view === 'checks') l = l.filter((p) => p.method === 'check' && !p.cancelled && p.valueDate >= todayISO());
    else {
      if (from) l = l.filter((p) => p.date >= from);
      if (to) l = l.filter((p) => p.date <= to);
    }
    if (unit) l = l.filter((p) => p.unitId === unit);
    if (method) l = l.filter((p) => p.method === method);
    if (q.trim()) {
      const s = q.trim();
      l = l.filter((p) => [p.forText, p.reference, p.checkNumber, String(p.receiptNumber || ''), unitFull(units.get(p.unitId)), String(p.amount)].some((x) => x && x.includes(s)));
    }
    return l.sort((a, b) => (view === 'checks' ? a.valueDate.localeCompare(b.valueDate) : b.date.localeCompare(a.date) || (b.receiptNumber || 0) - (a.receiptNumber || 0)));
  }, [d, view, q, unit, method, from, to]);

  const total = round2(list.filter((p) => !p.cancelled).reduce((s, p) => s + p.amount, 0));

  const exportXlsx = () =>
    exportExcel('תקבולים', [
      {
        name: 'תקבולים',
        rows: [
          ['מס\' קבלה', 'תאריך', 'תאריך ערך', 'דירה', 'עבור', 'אמצעי תשלום', 'אסמכתא / צ\'ק', 'חשבון', 'סכום', 'סטטוס'],
          ...list.map((p) => [p.receiptNumber ?? '', fmtDate(p.date), fmtDate(p.valueDate), unitFull(units.get(p.unitId)), p.forText, METHOD_LABELS[p.method], p.checkNumber || p.reference || '', p.account === 'cash' ? 'קופה קטנה' : 'בנק', p.amount, p.cancelled ? 'מבוטל' : '']),
        ],
      },
    ]);

  return (
    <>
      <PageHead
        title="תקבולים וקבלות"
        sub={`הקבלה הבאה: מס' ${d.settings.nextReceiptNumber}`}
        actions={
          <>
            <button className="btn primary" onClick={() => openForm({ kind: 'payment' })}><Icon name="plus" />קליטת תשלום</button>
            <button className="btn" onClick={exportXlsx}><Icon name="download" />Excel</button>
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <Seg value={view} onChange={setView} options={[{ value: 'all', label: 'כל התקבולים' }, { value: 'checks', label: "צ'קים דחויים לפירעון" }]} />
          <div className="muted">{list.length} תקבולים · סה"כ <b className="num">₪{total.toLocaleString('he-IL')}</b></div>
        </div>
        <div className="filters">
          <Field label="חיפוש" className="grow"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שם, מס' קבלה, אסמכתא, סכום…" /></Field>
          <Field label="דירה">
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">הכול</option>
              {sortUnits(d.units).map((u) => <option key={u.id} value={u.id}>{unitFull(u)}</option>)}
            </select>
          </Field>
          <Field label="אמצעי תשלום">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">הכול</option>
              {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </Field>
          {view === 'all' && (
            <>
              <Field label="מתאריך"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="עד תאריך"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </>
          )}
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>קבלה</th><th>תאריך</th><th>דירה</th><th>עבור</th><th>אמצעי תשלום</th>{view === 'checks' && <th>פירעון</th>}<th className="amt">סכום</th><th /></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={p.cancelled ? 'cancelled' : ''}>
                  <td className="num bold">{p.receiptNumber ?? <span className="muted">—</span>}</td>
                  <td className="num">{fmtDate(p.date)}</td>
                  <td>{unitFull(units.get(p.unitId))}</td>
                  <td>{p.forText}{p.kind === 'special' && <span className="badge violet" style={{ marginInlineStart: 6 }}>מיוחד</span>}{p.cancelled && <span className="badge red" style={{ marginInlineStart: 6 }}>מבוטל</span>}</td>
                  <td>
                    {METHOD_LABELS[p.method]}
                    {p.checkNumber && <span className="small muted"> #{p.checkNumber}</span>}
                    {p.account === 'cash' && <span className="badge amber" style={{ marginInlineStart: 6 }}>קופה</span>}
                    {p.bankLineId && <span className="badge green" style={{ marginInlineStart: 6 }} title="הותאם לדף הבנק">✓ בנק</span>}
                  </td>
                  {view === 'checks' && <td className="num bold">{fmtDate(p.valueDate)}</td>}
                  <td className="amt bold"><Money v={p.amount} /></td>
                  <td>
                    <div className="row-actions">
                      {p.receiptNumber ? (
                        <button className="btn sm" onClick={() => openForm({ kind: 'receipt', paymentId: p.id })}><Icon name="receipt" size={14} />קבלה</button>
                      ) : !p.cancelled ? (
                        <button className="btn sm" onClick={() => attempt(() => { issueReceipt(p.id); openForm({ kind: 'receipt', paymentId: p.id }); })}>הפק קבלה</button>
                      ) : null}
                      {!p.cancelled && <button className="icon-btn" title="עריכה" onClick={() => openForm({ kind: 'payment', edit: p })}><Icon name="edit" /></button>}
                      {!p.cancelled && p.receiptNumber && (
                        <button className="icon-btn" title="ביטול קבלה" onClick={async () => { const r = await promptDialog(`ביטול קבלה מס' ${p.receiptNumber}`, 'סיבת הביטול', { text: 'הקבלה תסומן כמבוטלת ומספרה יישמר ברצף. התקבול לא ייחשב ביתרות.', danger: true, okLabel: 'ביטול הקבלה' }); if (r) attempt(() => cancelPayment(p.id, r), 'הקבלה בוטלה'); }}>
                          <Icon name="ban" />
                        </button>
                      )}
                      {!p.receiptNumber && (
                        <button className="icon-btn" title="מחיקה" onClick={async () => { if (await confirmDialog('מחיקת תקבול', 'למחוק את התקבול?', { danger: true, okLabel: 'מחיקה' })) attempt(() => deletePayment(p.id), 'נמחק'); }}>
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <Empty icon="🧾">{view === 'checks' ? "אין צ'קים דחויים שטרם נפרעו" : 'לא נמצאו תקבולים'}</Empty>}
        </div>
      </div>
    </>
  );
}
