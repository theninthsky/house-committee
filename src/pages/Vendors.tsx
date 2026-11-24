import { useState } from 'react';
import type { Vendor } from '../lib/types';
import { useData } from '../lib/store';
import { defaultExpense, deleteVendor, saveVendor } from '../lib/actions';
import { currentMonth, daysBetween, fmtDate, METHOD_LABELS, monthLabel, round2, todayISO, uid } from '../lib/format';
import type { PaymentMethod } from '../lib/types';
import { attempt, confirmDialog, Empty, Field, Icon, Modal, Money, navigate, NumInput, PageHead, Seg, toast } from '../components/ui';
import { openForm } from '../components/forms';

const FREQ = { monthly: 'חודשי', bimonthly: 'דו-חודשי', quarterly: 'רבעוני', yearly: 'שנתי' } as const;

export function VendorsPage() {
  const d = useData();
  const [edit, setEdit] = useState<Vendor | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const year = todayISO().slice(0, 4);
  const vendors = d.vendors.filter((v) => showArchived || !v.archived).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const newVendor = (type: Vendor['type']): Vendor => ({ id: uid(), name: '', type, category: type === 'fixed' ? 'ניקיון' : 'אחזקה שוטפת', frequency: 'monthly', paymentDay: 1, defaultMethod: 'transfer' });

  const pay = (v: Vendor) =>
    openForm({ kind: 'expense', prefill: defaultExpense({ vendorId: v.id, category: v.category, amount: v.monthlyAmount || 0, method: v.defaultMethod || 'transfer', description: v.type === 'fixed' ? `${v.service || v.name} – ${monthLabel(currentMonth())}` : v.service || '', forMonth: v.type === 'fixed' ? currentMonth() : undefined }) });

  const section = (type: Vendor['type']) => {
    const list = vendors.filter((v) => v.type === type);
    return (
      <div className="card">
        <div className="card-head">
          <h2>{type === 'fixed' ? 'ספקים קבועים (הוצאות חוזרות)' : 'ספקים מזדמנים'}</h2>
          <button className="btn sm" onClick={() => setEdit(newVendor(type))}><Icon name="plus" />ספק {type === 'fixed' ? 'קבוע' : 'מזדמן'}</button>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>ספק</th><th>סעיף</th>
                {type === 'fixed' && <><th>סכום צפוי</th><th>תדירות</th><th>החודש</th></>}
                <th>טלפון</th>
                <th>תוקף חוזה / ביטוח</th>
                <th className="amt">שולם {year}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const exps = d.expenses.filter((e) => e.vendorId === v.id);
                const ytd = round2(exps.filter((e) => e.date.startsWith(year)).reduce((s, e) => s + e.amount, 0));
                const paidThisMonth = exps.some((e) => e.forMonth === currentMonth() || (!e.forMonth && e.date.startsWith(currentMonth())));
                const days = v.contractEnd ? daysBetween(todayISO(), v.contractEnd) : null;
                return (
                  <tr key={v.id} className={v.archived ? 'muted' : ''}>
                    <td>
                      <div className="bold clickable" onClick={() => setEdit(v)}>{v.name}</div>
                      <div className="small muted">{v.service}{v.autoRecord && <span className="badge blue" style={{ marginInlineStart: 6 }}>הו"ק – רישום אוטומטי</span>}{v.archived && <span className="badge">ארכיון</span>}</div>
                    </td>
                    <td>{v.category}</td>
                    {type === 'fixed' && (
                      <>
                        <td>{v.monthlyAmount ? <Money v={v.monthlyAmount} /> : '—'}{v.paymentDay ? <div className="small muted">ב-{v.paymentDay} לחודש</div> : null}</td>
                        <td>{FREQ[v.frequency || 'monthly']}</td>
                        <td>{paidThisMonth ? <span className="badge green">שולם</span> : <span className="badge amber">טרם</span>}</td>
                      </>
                    )}
                    <td className="num">{v.phone}</td>
                    <td>
                      {v.contractEnd ? (
                        <span className={'badge ' + (days! < 0 ? 'red' : days! <= d.settings.contractAlertDays ? 'amber' : '')}>
                          {fmtDate(v.contractEnd)}{days! < 0 ? ' · פג' : days! <= d.settings.contractAlertDays ? ` · עוד ${days} ימים` : ''}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="amt clickable" onClick={() => navigate('/expenses?vendor=' + v.id)}><Money v={ytd} /></td>
                    <td>
                      <div className="row-actions">
                        {!v.archived && <button className="btn sm" onClick={() => pay(v)}>רשום תשלום</button>}
                        <button className="icon-btn" onClick={() => setEdit(v)}><Icon name="edit" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && <Empty icon="🧰">{type === 'fixed' ? 'הגדירו ספקי ליבה: ניקיון, גינון, מעליות, חשמל, ביטוח, עמלות בנק' : 'אינסטלטור, חשמלאי, מדביר, שיפוצניק…'}</Empty>}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHead title="ספקים" actions={<label className="check"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />הצג ארכיון</label>} />
      {section('fixed')}
      {section('occasional')}
      {edit && <VendorForm vendor={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function VendorForm({ vendor, onClose }: { vendor: Vendor; onClose: () => void }) {
  const d = useData();
  const [v, setV] = useState<Vendor>({ ...vendor });
  const isNew = !d.vendors.some((x) => x.id === vendor.id);
  const upd = (p: Partial<Vendor>) => setV((x) => ({ ...x, ...p }));
  const save = () => attempt(() => saveVendor({ ...v, autoFrom: v.autoRecord ? v.autoFrom || currentMonth() : v.autoFrom }), 'הספק נשמר') && onClose();
  const remove = async () => {
    if (!(await confirmDialog('מחיקת ספק', `למחוק את ${vendor.name}? ספק עם הוצאות רשומות יועבר לארכיון.`, { danger: true, okLabel: 'מחיקה' }))) return;
    attempt(() => {
      const r = deleteVendor(vendor.id);
      toast(r === 'archived' ? 'הספק הועבר לארכיון' : 'הספק נמחק');
      onClose();
    });
  };
  return (
    <Modal title={isNew ? 'ספק חדש' : `עריכת ${vendor.name}`} onClose={onClose} size="wide"
      footer={
        <>
          <button className="btn primary" onClick={save}><Icon name="check" />שמירה</button>
          <button className="btn" onClick={onClose}>ביטול</button>
          <span className="spacer" />
          {!isNew && v.archived && <button className="btn" onClick={() => upd({ archived: false })}>החזרה מהארכיון</button>}
          {!isNew && !v.archived && <button className="btn danger" onClick={remove}><Icon name="trash" />מחיקה</button>}
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <Field label="שם הספק"><input className="input" value={v.name} onChange={(e) => upd({ name: e.target.value })} autoFocus /></Field>
          <Field label="סוג"><Seg value={v.type} onChange={(type) => upd({ type })} options={[{ value: 'fixed', label: 'קבוע' }, { value: 'occasional', label: 'מזדמן' }]} /></Field>
        </div>
        <div className="form-row">
          <Field label="תחום שירות"><input className="input" value={v.service || ''} onChange={(e) => upd({ service: e.target.value })} placeholder="למשל: ניקיון חדר מדרגות" /></Field>
          <Field label="סעיף תקציבי">
            <select className="input" value={v.category} onChange={(e) => upd({ category: e.target.value })}>
              {d.settings.expenseCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row">
          <Field label="איש קשר"><input className="input" value={v.contactName || ''} onChange={(e) => upd({ contactName: e.target.value })} /></Field>
          <Field label="טלפון"><input className="input ltr" value={v.phone || ''} onChange={(e) => upd({ phone: e.target.value })} /></Field>
          <Field label="אימייל"><input className="input ltr" value={v.email || ''} onChange={(e) => upd({ email: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="תחילת חוזה / פוליסה"><input className="input" type="date" value={v.contractStart || ''} onChange={(e) => upd({ contractStart: e.target.value || undefined })} /></Field>
          <Field label="תוקף חוזה / פוליסה" hint={`התראה ${d.settings.contractAlertDays} יום לפני פקיעה`}><input className="input" type="date" value={v.contractEnd || ''} onChange={(e) => upd({ contractEnd: e.target.value || undefined })} /></Field>
        </div>
        {v.type === 'fixed' && (
          <>
            <div className="hr" />
            <h3>תשלום חוזר</h3>
            <div className="form-row">
              <Field label="סכום לתשלום (₪)"><NumInput value={v.monthlyAmount} onChange={(monthlyAmount) => upd({ monthlyAmount })} /></Field>
              <Field label="תדירות">
                <select className="input" value={v.frequency || 'monthly'} onChange={(e) => upd({ frequency: e.target.value as Vendor['frequency'] })}>
                  {Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="יום תשלום בחודש"><NumInput value={v.paymentDay} onChange={(n) => upd({ paymentDay: Math.max(1, Math.min(28, Math.round(n))) })} /></Field>
              <Field label="אמצעי תשלום">
                <select className="input" value={v.defaultMethod || 'transfer'} onChange={(e) => upd({ defaultMethod: e.target.value as PaymentMethod })}>
                  {(Object.keys(METHOD_LABELS) as PaymentMethod[]).filter((m) => m !== 'cash').map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                </select>
              </Field>
            </div>
            {v.frequency !== 'monthly' && (
              <Field label="חודש התשלום הראשון" hint="לחישוב מועדי תשלום דו-חודשיים / רבעוניים / שנתיים">
                <input className="input" type="month" value={v.autoFrom || ''} onChange={(e) => upd({ autoFrom: e.target.value || undefined })} style={{ maxWidth: 220 }} />
              </Field>
            )}
            <label className="check">
              <input type="checkbox" checked={!!v.autoRecord} onChange={(e) => upd({ autoRecord: e.target.checked, autoFrom: e.target.checked ? v.autoFrom || currentMonth() : v.autoFrom })} />
              הוראת קבע – רשום את ההוצאה אוטומטית בכל מועד תשלום
            </label>
            {v.autoRecord && (
              <Field label="רישום אוטומטי החל מחודש"><input className="input" type="month" value={v.autoFrom || currentMonth()} onChange={(e) => upd({ autoFrom: e.target.value })} style={{ maxWidth: 220 }} /></Field>
            )}
            {!v.autoRecord && <div className="small muted">ללא רישום אוטומטי – תוצג תזכורת בלוח הבקרה עד שיירשם תשלום לחודש.</div>}
          </>
        )}
        <Field label="הערות"><textarea className="input" value={v.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
