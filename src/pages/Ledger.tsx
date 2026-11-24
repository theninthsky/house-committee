import { useMemo, useState } from 'react';
import type { LedgerRow } from '../lib/types';
import { useData } from '../lib/store';
import { ledgerRows, OPENING_CATEGORY, sortUnits, TRANSFER_CATEGORY, unitFull } from '../lib/calc';
import { fmtDate, METHOD_LABELS, parseAmount, round2, todayISO } from '../lib/format';
import { exportExcel } from '../lib/excel';
import { Empty, Field, Icon, Money, PageHead } from '../components/ui';
import { openForm } from '../components/forms';
import { AttachmentChips } from '../components/attachments';

export function LedgerPage() {
  const d = useData();
  const all = useMemo(() => ledgerRows(d), [d]);
  const [from, setFrom] = useState(todayISO().slice(0, 4) + '-01-01');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('');
  const [vendor, setVendor] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [q, setQ] = useState('');

  const categories = Array.from(new Set(all.map((r) => r.category))).sort((a, b) => a.localeCompare(b, 'he'));

  const { rows, opening } = useMemo(() => {
    let l = all;
    if (account) l = l.filter((r) => r.account === account);
    // opening balance for the selected account before the period
    const opening = account && from ? round2(l.filter((r) => r.date < from).reduce((s, r) => s + r.amount, 0)) : 0;
    if (from) l = l.filter((r) => r.date >= from);
    if (to) l = l.filter((r) => r.date <= to);
    if (kind === 'in') l = l.filter((r) => r.amount > 0 && r.type !== 'transfer');
    if (kind === 'out') l = l.filter((r) => r.amount < 0 && r.type !== 'transfer');
    if (kind === 'transfer') l = l.filter((r) => r.type === 'transfer');
    if (category) l = l.filter((r) => r.category === category);
    if (unit) l = l.filter((r) => r.unitId === unit);
    if (vendor) l = l.filter((r) => r.vendorId === vendor);
    if (min) l = l.filter((r) => Math.abs(r.amount) >= parseAmount(min));
    if (max) l = l.filter((r) => Math.abs(r.amount) <= parseAmount(max));
    if (q.trim()) {
      const s = q.trim();
      l = l.filter((r) => [r.description, r.party, r.reference, r.category, String(r.receiptNumber || ''), String(Math.abs(r.amount))].some((x) => x && x.includes(s)));
    }
    return { rows: l, opening };
  }, [all, from, to, account, kind, category, unit, vendor, min, max, q]);

  const totIn = round2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const totOut = round2(rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0));
  const showBalance = !!account && !kind && !category && !unit && !vendor && !min && !max && !q;
  let bal = opening;

  const open = (r: LedgerRow) => {
    if (r.type === 'payment') {
      const p = d.payments.find((x) => x.id === r.id);
      if (p?.receiptNumber) openForm({ kind: 'receipt', paymentId: r.id });
      else if (p) openForm({ kind: 'payment', edit: p });
    } else if (r.type === 'expense') {
      const e = d.expenses.find((x) => x.id === r.id);
      if (e) openForm({ kind: 'expense', edit: e });
    } else if (r.type === 'transfer') {
      const t = d.transfers.find((x) => x.id === r.id);
      if (t) openForm({ kind: 'transfer', edit: t });
    }
  };

  const exportXlsx = () => {
    let b = opening;
    exportExcel('כרטסת-תנועות', [
      {
        name: 'כרטסת',
        rows: [
          ['תאריך', 'תאריך ערך', 'תיאור', 'צד', 'סעיף', 'חשבון', 'אמצעי', 'אסמכתא', 'קבלה', 'זכות (נכנס)', 'חובה (יצא)', ...(showBalance ? ['יתרה'] : [])],
          ...(showBalance && from ? [['', '', 'יתרה קודמת', '', '', '', '', '', '', '', '', opening]] : []),
          ...rows.map((r) => {
            b = round2(b + r.amount);
            return [fmtDate(r.date), fmtDate(r.valueDate), r.description, r.party, r.category, r.account === 'cash' ? 'קופה קטנה' : 'בנק', r.method ? METHOD_LABELS[r.method] : '', r.reference || '', r.receiptNumber ?? '', r.amount > 0 ? r.amount : '', r.amount < 0 ? -r.amount : '', ...(showBalance ? [b] : [])];
          }),
          [],
          ['', '', 'סה"כ', '', '', '', '', '', '', totIn, totOut],
        ],
      },
    ]);
  };

  return (
    <>
      <div className="print-only print-head"><h2>{d.settings.buildingName} – כרטסת תנועות</h2><div>{from && `מ-${fmtDate(from)}`} {to && `עד ${fmtDate(to)}`}</div></div>
      <PageHead
        title="כרטסת הנהלת חשבונות"
        sub="ריכוז כל התנועות הכספיות – הכנסות, הוצאות והעברות פנימיות"
        actions={
          <>
            <button className="btn" onClick={() => window.print()}><Icon name="print" />PDF / הדפסה</button>
            <button className="btn" onClick={exportXlsx}><Icon name="download" />Excel</button>
          </>
        }
      />
      <div className="card">
        <div className="filters">
          <Field label="חיפוש" className="grow"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="תיאור, שם, אסמכתא…" /></Field>
          <Field label="מתאריך"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="עד תאריך"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="חשבון">
            <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">הכול</option><option value="bank">בנק</option><option value="cash">קופה קטנה</option>
            </select>
          </Field>
          <Field label="סוג">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">הכול</option><option value="in">הכנסות</option><option value="out">הוצאות</option><option value="transfer">העברות פנימיות</option>
            </select>
          </Field>
          <Field label="סעיף">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">הכול</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="דייר">
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">הכול</option>
              {sortUnits(d.units).map((u) => <option key={u.id} value={u.id}>{unitFull(u)}</option>)}
            </select>
          </Field>
          <Field label="ספק">
            <select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">הכול</option>
              {d.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="סכום מ-"><input className="input ltr" value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 90 }} /></Field>
          <Field label="עד"><input className="input ltr" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 90 }} /></Field>
        </div>
        {!account && <div className="small muted" style={{ padding: '8px 18px' }}>בחרו חשבון (בנק / קופה קטנה) כדי לראות עמודת יתרה מצטברת.</div>}
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>תאריך</th><th>תיאור</th><th>צד</th><th>סעיף</th><th>חשבון</th><th>אסמכתא</th><th className="amt">זכות (נכנס)</th><th className="amt">חובה (יצא)</th>{showBalance && <th className="amt">יתרה</th>}</tr>
            </thead>
            <tbody>
              {showBalance && from && (
                <tr className="muted"><td>{fmtDate(from)}</td><td colSpan={7}>יתרה קודמת</td><td className="amt"><Money v={opening} /></td></tr>
              )}
              {rows.map((r) => {
                bal = round2(bal + r.amount);
                return (
                  <tr key={r.key} className={r.type !== 'opening' ? 'clickable' : ''} onClick={() => open(r)}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}{r.valueDate !== r.date && <div className="small muted">ערך {fmtDate(r.valueDate)}</div>}</td>
                    <td>{r.description}{r.attachmentIds?.length ? <> <AttachmentChips ids={r.attachmentIds} /></> : null}</td>
                    <td>{r.party}</td>
                    <td><span className={'badge ' + (r.category === TRANSFER_CATEGORY ? 'blue' : r.category === OPENING_CATEGORY ? '' : r.amount > 0 ? 'green' : '')}>{r.category}</span></td>
                    <td>{r.account === 'cash' ? 'קופה' : 'בנק'}{r.bankLineId && <span className="badge green" style={{ marginInlineStart: 4 }}>✓</span>}</td>
                    <td className="small">{r.receiptNumber ? `קבלה ${r.receiptNumber}` : r.reference}</td>
                    <td className="amt pos">{r.amount > 0 ? <Money v={r.amount} /> : ''}</td>
                    <td className="amt neg">{r.amount < 0 ? <Money v={-r.amount} /> : ''}</td>
                    {showBalance && <td className="amt bold"><Money v={bal} /></td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>סה"כ ({rows.length} תנועות)</td><td className="amt"><Money v={totIn} /></td><td className="amt"><Money v={totOut} /></td>{showBalance && <td className="amt"><Money v={bal} /></td>}</tr>
            </tfoot>
          </table>
          {rows.length === 0 && <Empty>לא נמצאו תנועות</Empty>}
        </div>
      </div>
    </>
  );
}
