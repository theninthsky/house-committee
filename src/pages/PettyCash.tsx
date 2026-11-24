import { useMemo, useState } from 'react';
import { useData } from '../lib/store';
import { deleteTransfer, defaultExpense } from '../lib/actions';
import { accountBalance, ledgerRows } from '../lib/calc';
import { fmtDate, money, round2, todayISO } from '../lib/format';
import { exportExcel } from '../lib/excel';
import { attempt, confirmDialog, Empty, Field, Icon, Money, NumInput, PageHead } from '../components/ui';
import { openForm } from '../components/forms';
import { AttachmentChips } from '../components/attachments';

export function PettyCashPage() {
  const d = useData();
  const rows = useMemo(() => ledgerRows(d).filter((r) => r.account === 'cash'), [d]);
  const balance = accountBalance(d, 'cash', '9999-12-31');
  const [count, setCount] = useState<number | undefined>(undefined);
  const [from, setFrom] = useState(todayISO().slice(0, 4) + '-01-01');
  const opening = round2(rows.filter((r) => r.date < from).reduce((s, r) => s + r.amount, 0));
  const shown = rows.filter((r) => r.date >= from);
  let bal = opening;
  const diff = count === undefined ? null : round2(count - balance);

  const open = (key: string) => {
    const [type, id] = key.split(':');
    if (type === 'expense') {
      const e = d.expenses.find((x) => x.id === id);
      if (e) openForm({ kind: 'expense', edit: e });
    } else if (type === 'transfer') {
      const t = d.transfers.find((x) => x.id === id);
      if (t) openForm({ kind: 'transfer', edit: t });
    } else if (type === 'payment') openForm({ kind: 'receipt', paymentId: id });
  };

  const exportXlsx = () => {
    let b = opening;
    exportExcel('קופה-קטנה', [
      {
        name: 'קופה קטנה',
        rows: [
          ['תאריך', 'תיאור', 'צד', 'סעיף', 'כניסה', 'יציאה', 'יתרה'],
          ['', 'יתרה קודמת', '', '', '', '', opening],
          ...shown.map((r) => {
            b = round2(b + r.amount);
            return [fmtDate(r.date), r.description, r.party, r.category, r.amount > 0 ? r.amount : '', r.amount < 0 ? -r.amount : '', b];
          }),
        ],
      },
    ]);
  };

  return (
    <>
      <div className="print-only print-head"><h2>{d.settings.buildingName} – דוח תנועות קופה קטנה</h2></div>
      <PageHead
        title="קופה קטנה (מזומן)"
        sub="חשבון מזומן נפרד מהבנק – הכסף שבידי הגזבר"
        actions={
          <>
            <button className="btn primary" onClick={() => openForm({ kind: 'expense', prefill: defaultExpense({ account: 'cash', method: 'cash' }) })}><Icon name="plus" />הוצאה מהקופה</button>
            <button className="btn" onClick={() => openForm({ kind: 'payment', prefill: { method: 'cash', account: 'cash' } })}><Icon name="plus" />תשלום במזומן מדייר</button>
            <button className="btn" onClick={() => openForm({ kind: 'transfer', prefill: { from: 'bank', to: 'cash' } })}><Icon name="arrows" />משיכה מהבנק</button>
            <button className="btn" onClick={() => openForm({ kind: 'transfer', prefill: { from: 'cash', to: 'bank' } })}><Icon name="arrows" />הפקדה לבנק</button>
          </>
        }
      />
      <div className="grid grid-2 no-print">
        <div className="card card-pad stat">
          <div className="label">יתרה בקופה לפי הרישומים</div>
          <div className="value"><Money v={balance} /></div>
        </div>
        <div className="card card-pad">
          <div className="stat"><div className="label">ספירת קופה – אימות מול המזומן בפועל</div></div>
          <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
            <Field label="סכום שנספר (₪)"><NumInput value={count} onChange={setCount} /></Field>
            {diff !== null && (
              <div className={'banner ' + (diff === 0 ? 'info' : 'danger')} style={{ margin: 0, flex: 1 }}>
                {diff === 0 ? '✓ הקופה מאוזנת' : diff > 0 ? `עודף של ${money(diff)} בקופה` : `חסר ${money(-diff)} בקופה`}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>תנועות קופה קטנה</h2>
          <div className="row">
            <Field label=""><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <button className="btn sm" onClick={() => window.print()}><Icon name="print" />הדפסה</button>
            <button className="btn sm" onClick={exportXlsx}><Icon name="download" />Excel</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>תאריך</th><th>תיאור</th><th>צד</th><th>סעיף</th><th>קבלה</th><th className="amt">כניסה</th><th className="amt">יציאה</th><th className="amt">יתרה</th><th className="no-print" /></tr></thead>
            <tbody>
              <tr className="muted"><td>{fmtDate(from)}</td><td colSpan={6}>יתרה קודמת</td><td className="amt"><Money v={opening} /></td><td className="no-print" /></tr>
              {shown.map((r) => {
                bal = round2(bal + r.amount);
                return (
                  <tr key={r.key} className="clickable" onClick={() => open(r.key)}>
                    <td className="num">{fmtDate(r.date)}</td>
                    <td>{r.description}</td>
                    <td>{r.party}</td>
                    <td><span className="badge">{r.category}</span></td>
                    <td>{r.attachmentIds && <AttachmentChips ids={r.attachmentIds} />}</td>
                    <td className="amt pos">{r.amount > 0 ? <Money v={r.amount} /> : ''}</td>
                    <td className="amt neg">{r.amount < 0 ? <Money v={-r.amount} /> : ''}</td>
                    <td className="amt bold"><Money v={bal} /></td>
                    <td className="no-print">
                      {r.type === 'transfer' && (
                        <button className="icon-btn" onClick={async (e) => { e.stopPropagation(); if (await confirmDialog('מחיקת העברה', 'למחוק את ההעברה?', { danger: true, okLabel: 'מחיקה' })) attempt(() => deleteTransfer(r.id), 'נמחק'); }}><Icon name="trash" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <Empty icon="💵">אין תנועות מזומן בתקופה</Empty>}
        </div>
      </div>
    </>
  );
}
