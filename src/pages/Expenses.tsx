import { useMemo, useState } from 'react';
import { useData } from '../lib/store';
import { deleteExpense } from '../lib/actions';
import { fmtDate, METHOD_LABELS, round2, todayISO } from '../lib/format';
import { exportExcel } from '../lib/excel';
import { attempt, confirmDialog, Empty, Field, Icon, Money, PageHead, useQuery } from '../components/ui';
import { openForm } from '../components/forms';
import { AttachmentChips } from '../components/attachments';

export function ExpensesPage() {
  const d = useData();
  const query = useQuery();
  const [vendor, setVendor] = useState(query.get('vendor') || '');
  const [category, setCategory] = useState('');
  const [account, setAccount] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(todayISO().slice(0, 4) + '-01-01');
  const [to, setTo] = useState('');
  const vendors = new Map(d.vendors.map((v) => [v.id, v]));

  const list = useMemo(() => {
    let l = [...d.expenses];
    if (vendor) l = l.filter((e) => e.vendorId === vendor);
    if (category) l = l.filter((e) => e.category === category);
    if (account) l = l.filter((e) => e.account === account);
    if (from) l = l.filter((e) => e.date >= from);
    if (to) l = l.filter((e) => e.date <= to);
    if (q.trim()) {
      const s = q.trim();
      l = l.filter((e) => [e.description, e.payee, vendors.get(e.vendorId || '')?.name, e.reference, e.checkNumber, String(e.amount)].some((x) => x && x.includes(s)));
    }
    return l.sort((a, b) => b.date.localeCompare(a.date));
  }, [d, vendor, category, account, q, from, to]);
  const total = round2(list.reduce((s, e) => s + e.amount, 0));

  const exportXlsx = () =>
    exportExcel('הוצאות', [
      {
        name: 'הוצאות',
        rows: [
          ['תאריך', 'ספק / מוטב', 'סעיף', 'תיאור', 'אמצעי תשלום', 'אסמכתא / צ\'ק', 'חשבון', 'סכום', 'מסמך מצורף'],
          ...list.map((e) => [fmtDate(e.date), vendors.get(e.vendorId || '')?.name || e.payee || '', e.category, e.description, METHOD_LABELS[e.method], e.checkNumber || e.reference || '', e.account === 'cash' ? 'קופה קטנה' : 'בנק', e.amount, e.attachmentIds.length ? 'כן' : '']),
          [],
          ['', '', '', 'סה"כ', '', '', '', total],
        ],
      },
    ]);

  return (
    <>
      <PageHead
        title="הוצאות"
        actions={
          <>
            <button className="btn primary" onClick={() => openForm({ kind: 'expense' })}><Icon name="plus" />הוצאה חדשה</button>
            <button className="btn" onClick={exportXlsx}><Icon name="download" />Excel</button>
          </>
        }
      />
      <div className="card">
        <div className="filters">
          <Field label="חיפוש" className="grow"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="תיאור, ספק, אסמכתא, סכום…" /></Field>
          <Field label="ספק">
            <select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">הכול</option>
              {d.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="סעיף">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">הכול</option>
              {d.settings.expenseCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="חשבון">
            <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">הכול</option>
              <option value="bank">בנק</option>
              <option value="cash">קופה קטנה</option>
            </select>
          </Field>
          <Field label="מתאריך"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="עד תאריך"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="card-head" style={{ borderBottom: 0, paddingBlock: 10 }}>
          <span className="muted">{list.length} הוצאות</span>
          <span>סה"כ: <b><Money v={total} /></b></span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>תאריך</th><th>ספק / מוטב</th><th>סעיף</th><th>תיאור</th><th>אמצעי תשלום</th><th>מסמכים</th><th className="amt">סכום</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td className="num">{fmtDate(e.date)}</td>
                  <td>{vendors.get(e.vendorId || '')?.name || e.payee || <span className="muted">—</span>}</td>
                  <td><span className="badge">{e.category}</span></td>
                  <td>{e.description}{e.auto && <span className="badge blue" style={{ marginInlineStart: 6 }}>אוטומטי</span>}</td>
                  <td>
                    {METHOD_LABELS[e.method]}
                    {e.checkNumber && <div className="small muted">צ'ק #{e.checkNumber} · פירעון {fmtDate(e.valueDate)}</div>}
                    {e.account === 'cash' && <span className="badge amber" style={{ marginInlineStart: 6 }}>קופה</span>}
                    {e.bankLineId && <span className="badge green" style={{ marginInlineStart: 6 }}>✓ בנק</span>}
                  </td>
                  <td><AttachmentChips ids={e.attachmentIds} /></td>
                  <td className="amt bold"><Money v={e.amount} /></td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => openForm({ kind: 'expense', edit: e })}><Icon name="edit" /></button>
                      <button className="icon-btn" onClick={async () => { if (await confirmDialog('מחיקת הוצאה', `למחוק את "${e.description}"?`, { danger: true, okLabel: 'מחיקה' })) attempt(() => deleteExpense(e.id), 'ההוצאה נמחקה'); }}><Icon name="trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <Empty icon="🧾">לא נמצאו הוצאות</Empty>}
        </div>
      </div>
    </>
  );
}
