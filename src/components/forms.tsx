import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Account, Expense, Payment, PaymentMethod, Transfer } from '../lib/types';
import { getData, isLocked, useData } from '../lib/store';
import { addAttachment, defaultExpense, saveExpense, savePayment, saveTransfer } from '../lib/actions';
import { currentRate, sortUnits, unitAccount, unitFull } from '../lib/calc';
import { addMonths, currentMonth, describeMonths, METHOD_LABELS, money, monthLabel, todayISO, uid } from '../lib/format';
import { attempt, Field, FileDrop, Icon, Modal, NumInput, Seg, toast } from './ui';
import { AttachmentChips } from './attachments';
import { ReceiptModal } from './receipt';

// ===== Global form host – any screen can open a form =====

type FormReq =
  | { kind: 'payment'; unitId?: string; edit?: Payment; prefill?: Partial<Payment>; onSaved?: (p: Payment) => void }
  | { kind: 'expense'; edit?: Expense; prefill?: Partial<Expense>; onSaved?: (e: Expense) => void }
  | { kind: 'transfer'; edit?: Transfer; prefill?: Partial<Transfer>; onSaved?: (t: Transfer) => void }
  | { kind: 'receipt'; paymentId: string };

let current: FormReq | null = null;
const ls = new Set<() => void>();
const set = (f: FormReq | null) => {
  current = f;
  ls.forEach((l) => l());
};
export const openForm = (f: FormReq) => set(f);
export const closeForm = () => set(null);
// leaving the screen closes any open form
window.addEventListener('hashchange', () => current && set(null));

export function FormHost() {
  const f = useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => current,
  );
  if (!f) return null;
  if (f.kind === 'payment') return <PaymentForm key={f.edit?.id || 'new'} {...f} />;
  if (f.kind === 'expense') return <ExpenseForm key={f.edit?.id || 'new'} {...f} />;
  if (f.kind === 'transfer') return <TransferForm {...f} />;
  if (f.kind === 'receipt') return <ReceiptModal paymentId={f.paymentId} onClose={closeForm} />;
  return null;
}

const METHODS: PaymentMethod[] = ['transfer', 'standing_order', 'check', 'app', 'cash', 'credit'];

// ===== Payment from a tenant =====

function PaymentForm(props: { unitId?: string; edit?: Payment; prefill?: Partial<Payment>; onSaved?: (p: Payment) => void }) {
  const d = useData();
  const units = sortUnits(d.units);
  const today = todayISO();
  const [p, setP] = useState<Payment>(() =>
    props.edit
      ? { ...props.edit }
      : {
          id: uid(),
          unitId: props.unitId || '',
          date: today,
          valueDate: today,
          amount: 0,
          method: 'transfer',
          kind: 'regular',
          forText: '',
          account: 'bank',
          createdAt: '',
          ...props.prefill,
        },
  );
  const [issue, setIssue] = useState(true);
  const [months, setMonths] = useState<string[]>([]);
  const [textTouched, setTextTouched] = useState(!!props.edit);
  const unit = d.units.find((u) => u.id === p.unitId);
  const acc = unit ? unitAccount(d, unit) : null;
  const rate = unit ? currentRate(unit) : 0;

  // months offered: open monthly charges + next 12 months
  const monthOptions = useMemo(() => {
    if (!acc) return [] as { m: string; due: number; open: boolean }[];
    const open = acc.charges.filter((a) => a.charge.kind === 'monthly' && a.remaining > 0).map((a) => ({ m: a.charge.month, due: a.remaining, open: true }));
    const out = [...open];
    let m = currentMonth();
    const has = new Set(acc.charges.filter((a) => a.charge.kind === 'monthly').map((a) => a.charge.month));
    for (let i = 0; i < 12; i++) {
      m = i === 0 ? m : addMonths(m, 1);
      if (!has.has(m) && !out.some((o) => o.m === m)) out.push({ m, due: rate, open: false });
    }
    return out.sort((a, b) => a.m.localeCompare(b.m));
  }, [acc, rate]);

  const specialOpen = acc ? acc.charges.filter((a) => a.charge.kind === 'special' && a.remaining > 0) : [];

  const upd = (patch: Partial<Payment>) => setP((x) => ({ ...x, ...patch }));

  const autoText = (ms: string[], kind = p.kind) => {
    if (kind === 'special') return specialOpen.map((a) => a.charge.description).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') || 'גבייה מיוחדת';
    return ms.length ? `דמי ועד ${describeMonths(ms)}` : 'דמי ועד';
  };

  const toggleMonth = (m: string) => {
    const next = months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort();
    setMonths(next);
    const total = next.reduce((s, x) => s + (monthOptions.find((o) => o.m === x)?.due || 0), 0);
    upd({ amount: total || p.amount, ...(textTouched ? {} : { forText: autoText(next) }) });
  };

  const setMethod = (method: PaymentMethod) => {
    upd({ method, account: method === 'cash' ? 'cash' : 'bank', valueDate: method === 'check' ? p.valueDate : p.date });
  };

  const pickUnit = (unitId: string) => {
    const u = d.units.find((x) => x.id === unitId);
    if (!u) return upd({ unitId });
    const a = unitAccount(d, u);
    const open = a.charges.filter((c) => c.charge.kind === 'monthly' && c.remaining > 0);
    const ms = open.length ? open.map((c) => c.charge.month) : [currentMonth()];
    const amount = open.length ? open.reduce((s, c) => s + c.remaining, 0) : currentRate(u);
    setMonths(ms);
    setP((x) => ({ ...x, unitId, amount: props.prefill?.amount || amount, forText: textTouched ? x.forText : `דמי ועד ${describeMonths(ms)}` }));
  };

  // opened for a specific unit (e.g. from the matrix): preselect its open months
  useEffect(() => {
    if (props.unitId && !props.edit) pickUnit(props.unitId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    const final = { ...p, forText: p.forText || autoText(months), valueDate: p.method === 'check' ? p.valueDate || p.date : p.date };
    let saved: Payment | undefined;
    const ok = attempt(() => {
      saved = savePayment(final, { issueReceipt: !props.edit && issue });
    });
    if (!ok || !saved) return;
    toast(saved.receiptNumber && !props.edit ? `התקבול נרשם · קבלה מס' ${saved.receiptNumber}` : 'התקבול נשמר');
    props.onSaved?.(saved);
    if (saved.receiptNumber && !props.edit) openForm({ kind: 'receipt', paymentId: saved.id });
    else closeForm();
  };

  const locked = isLocked(d, p.date);

  return (
    <Modal title={props.edit ? 'עריכת תקבול' : 'קליטת תשלום מדייר'} onClose={closeForm} size="wide"
      footer={
        <>
          <button className="btn primary" onClick={submit} disabled={locked}>
            <Icon name="check" />
            {props.edit ? 'שמירה' : issue ? 'שמירה והפקת קבלה' : 'שמירה'}
          </button>
          <button className="btn" onClick={closeForm}>ביטול</button>
          <span className="spacer" />
          {!props.edit && (
            <label className="check">
              <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} /> הפק קבלה (מס' {d.settings.nextReceiptNumber})
            </label>
          )}
        </>
      }
    >
      <div className="form">
        {locked && <div className="banner danger">התאריך בשנה נעולה – לא ניתן לשמור.</div>}
        {props.edit?.receiptNumber && <div className="banner info">לתקבול זה הופקה קבלה מס' {props.edit.receiptNumber}. ניתן לעדכן פרטים משניים בלבד.</div>}
        <div className="form-row">
          <Field label="דירה / דייר">
            <select className="input" value={p.unitId} onChange={(e) => pickUnit(e.target.value)} disabled={!!props.edit?.receiptNumber} autoFocus={!p.unitId}>
              <option value="">בחרו דירה…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{unitFull(u)}</option>
              ))}
            </select>
          </Field>
          <Field label="סוג גבייה">
            <Seg value={p.kind} onChange={(kind) => upd({ kind, ...(textTouched ? {} : { forText: autoText(months, kind) }) })} options={[{ value: 'regular', label: 'דמי ועד' }, { value: 'special', label: 'גבייה מיוחדת' }]} />
          </Field>
        </div>
        {acc && (
          <div className="banner info" style={{ marginBottom: 0 }}>
            {acc.balance > 0 ? <>יתרת חוב נוכחית: <b className="num">{money(acc.balance)}</b></> : acc.balance < 0 ? <>יתרת זכות: <b className="num">{money(-acc.balance)}</b></> : 'אין חוב פתוח'}
            <span className="grow" />
            תעריף חודשי: <b className="num">{money(rate)}</b>
          </div>
        )}
        {unit && p.kind === 'regular' && !props.edit && (
          <Field label="עבור חודשים" hint="בחירת חודשים ממלאת אוטומטית את הסכום ואת התיאור בקבלה">
            <div className="checklist">
              {monthOptions.map((o) => (
                <label key={o.m} className="check" style={{ fontWeight: 500 }}>
                  <input type="checkbox" checked={months.includes(o.m)} onChange={() => toggleMonth(o.m)} />
                  {monthLabel(o.m)} {o.open && <span className="badge red">פתוח</span>}
                </label>
              ))}
            </div>
          </Field>
        )}
        {unit && p.kind === 'special' && specialOpen.length > 0 && (
          <div className="small muted">
            חיובים מיוחדים פתוחים: {specialOpen.map((a) => `${a.charge.description} (${money(a.remaining)})`).join(', ')}
          </div>
        )}
        <div className="form-row">
          <Field label="סכום (₪)">
            <NumInput value={p.amount} onChange={(amount) => upd({ amount })} />
          </Field>
          <Field label="תאריך קבלה">
            <input className="input" type="date" value={p.date} onChange={(e) => upd({ date: e.target.value, valueDate: p.method === 'check' ? p.valueDate : e.target.value })} />
          </Field>
        </div>
        <Field label="אמצעי תשלום">
          <Seg value={p.method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))} />
        </Field>
        {p.method === 'check' && (
          <div className="form-row">
            <Field label="מספר צ'ק">
              <input className="input ltr" value={p.checkNumber || ''} onChange={(e) => upd({ checkNumber: e.target.value })} />
            </Field>
            <Field label="בנק / סניף">
              <input className="input" value={p.checkBank || ''} onChange={(e) => upd({ checkBank: e.target.value })} />
            </Field>
            <Field label="תאריך פירעון" hint="לצ'ק דחוי – היתרה בבנק תתעדכן בתאריך זה">
              <input className="input" type="date" value={p.valueDate} onChange={(e) => upd({ valueDate: e.target.value })} />
            </Field>
          </div>
        )}
        <div className="form-row">
          {p.method !== 'check' && p.method !== 'cash' && (
            <Field label="אסמכתא">
              <input className="input ltr" value={p.reference || ''} onChange={(e) => upd({ reference: e.target.value })} />
            </Field>
          )}
          <Field label="נכנס ל" hint={p.account === 'cash' ? 'יתרת הקופה הקטנה תגדל' : 'יתרת הבנק תגדל'}>
            <Seg value={p.account} onChange={(account: Account) => upd({ account })} options={[{ value: 'bank', label: 'חשבון בנק' }, { value: 'cash', label: 'קופה קטנה (מזומן)' }]} />
          </Field>
        </div>
        <Field label="פירוט בקבלה (עבור)">
          <input className="input" value={p.forText} placeholder={autoText(months)} onChange={(e) => { setTextTouched(true); upd({ forText: e.target.value }); }} />
        </Field>
        <Field label="הערות (פנימי)">
          <input className="input" value={p.notes || ''} onChange={(e) => upd({ notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ===== Expense =====

function ExpenseForm(props: { edit?: Expense; prefill?: Partial<Expense>; onSaved?: (e: Expense) => void }) {
  const d = useData();
  const [e, setE] = useState<Expense>(() => (props.edit ? { ...props.edit } : defaultExpense(props.prefill)));
  const [busy, setBusy] = useState(false);
  const vendors = d.vendors.filter((v) => !v.archived || v.id === e.vendorId).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const vendor = d.vendors.find((v) => v.id === e.vendorId);
  const upd = (patch: Partial<Expense>) => setE((x) => ({ ...x, ...patch }));

  const pickVendor = (id: string) => {
    const v = d.vendors.find((x) => x.id === id);
    if (!v) return upd({ vendorId: undefined });
    upd({
      vendorId: id,
      payee: undefined,
      category: v.category || e.category,
      amount: e.amount || v.monthlyAmount || 0,
      method: props.prefill?.method || (e.account === 'cash' ? 'cash' : v.defaultMethod || e.method),
      description: e.description || (v.type === 'fixed' ? `${v.service || v.name} – ${monthLabel(e.date.slice(0, 7))}` : v.service || ''),
      forMonth: v.type === 'fixed' ? e.forMonth || e.date.slice(0, 7) : undefined,
    });
  };

  const setMethod = (method: PaymentMethod) => upd({ method, account: method === 'cash' ? 'cash' : e.account === 'cash' ? 'bank' : e.account, valueDate: method === 'check' ? e.valueDate : e.date });

  const onFiles = async (files: File[]) => {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of files) {
        if (f.size > 15 * 1024 * 1024) {
          toast(`הקובץ ${f.name} גדול מדי (מעל 15MB)`, 'error');
          continue;
        }
        ids.push(await addAttachment(f));
      }
      setE((x) => ({ ...x, attachmentIds: [...x.attachmentIds, ...ids] }));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const final = { ...e, valueDate: e.method === 'check' ? e.valueDate || e.date : e.date };
    if (!attempt(() => saveExpense(final), 'ההוצאה נשמרה')) return;
    props.onSaved?.(getData().expenses.find((x) => x.id === final.id) || final);
    closeForm();
  };

  const locked = isLocked(d, e.date);

  return (
    <Modal title={props.edit ? 'עריכת הוצאה' : e.account === 'cash' ? 'הוצאה מהקופה הקטנה' : 'רישום הוצאה חדשה'} onClose={closeForm} size="wide"
      footer={
        <>
          <button className="btn primary" onClick={submit} disabled={busy || locked}><Icon name="check" />שמירה</button>
          <button className="btn" onClick={closeForm}>ביטול</button>
        </>
      }
    >
      <div className="form">
        {locked && <div className="banner danger">התאריך בשנה נעולה – לא ניתן לשמור.</div>}
        <div className="form-row">
          <Field label="ספק">
            <select className="input" value={e.vendorId || ''} onChange={(ev) => pickVendor(ev.target.value)}>
              <option value="">— ללא ספק / ספק מזדמן —</option>
              <optgroup label="ספקים קבועים">
                {vendors.filter((v) => v.type === 'fixed').map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
              <optgroup label="ספקים מזדמנים">
                {vendors.filter((v) => v.type === 'occasional').map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            </select>
          </Field>
          {!e.vendorId && (
            <Field label="שם המוטב / חנות">
              <input className="input" value={e.payee || ''} onChange={(ev) => upd({ payee: ev.target.value })} placeholder="למשל: חנות כלי בית" />
            </Field>
          )}
          <Field label="סעיף תקציבי">
            <select className="input" value={e.category} onChange={(ev) => upd({ category: ev.target.value })}>
              <option value="">בחרו סעיף…</option>
              {d.settings.expenseCategories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label="תיאור">
          <input className="input" value={e.description} onChange={(ev) => upd({ description: ev.target.value })} placeholder="למשל: תיקון נזילה בחדר המדרגות" />
        </Field>
        <div className="form-row">
          <Field label="סכום (₪)">
            <NumInput value={e.amount} onChange={(amount) => upd({ amount })} />
          </Field>
          <Field label="תאריך">
            <input className="input" type="date" value={e.date} onChange={(ev) => upd({ date: ev.target.value, valueDate: e.method === 'check' ? e.valueDate : ev.target.value })} />
          </Field>
          {vendor?.type === 'fixed' && (
            <Field label="עבור חודש">
              <input className="input" type="month" value={e.forMonth || ''} onChange={(ev) => upd({ forMonth: ev.target.value || undefined })} />
            </Field>
          )}
        </div>
        <Field label="אמצעי תשלום">
          <Seg value={e.method} onChange={setMethod} options={METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))} />
        </Field>
        <div className="form-row">
          {e.method === 'check' ? (
            <>
              <Field label="מספר צ'ק">
                <input className="input ltr" value={e.checkNumber || ''} onChange={(ev) => upd({ checkNumber: ev.target.value })} />
              </Field>
              <Field label="תאריך פירעון הצ'ק">
                <input className="input" type="date" value={e.valueDate} onChange={(ev) => upd({ valueDate: ev.target.value })} />
              </Field>
            </>
          ) : (
            <Field label="אסמכתא / מס' חשבונית">
              <input className="input ltr" value={e.reference || ''} onChange={(ev) => upd({ reference: ev.target.value })} />
            </Field>
          )}
          <Field label="יצא מ">
            <Seg value={e.account} onChange={(account: Account) => upd({ account, method: account === 'cash' ? 'cash' : e.method === 'cash' ? 'transfer' : e.method })} options={[{ value: 'bank', label: 'חשבון בנק' }, { value: 'cash', label: 'קופה קטנה' }]} />
          </Field>
        </div>
        <Field label="חשבונית / קבלה מהספק (PDF או תמונה)">
          <FileDrop onFiles={onFiles} accept="image/*,application/pdf" multiple>
            {busy ? 'מעלה…' : <><Icon name="upload" /> גררו קובץ או לחצו לצילום / בחירה</>}
          </FileDrop>
          <div className="mt" style={{ marginTop: 8 }}>
            <AttachmentChips ids={e.attachmentIds} onRemove={(id) => upd({ attachmentIds: e.attachmentIds.filter((x) => x !== id) })} />
          </div>
        </Field>
        <Field label="הערות">
          <input className="input" value={e.notes || ''} onChange={(ev) => upd({ notes: ev.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ===== Transfer between bank and petty cash =====

function TransferForm(props: { edit?: Transfer; prefill?: Partial<Transfer>; onSaved?: (t: Transfer) => void }) {
  const d = useData();
  const [t, setT] = useState<Transfer>(() => props.edit ? { ...props.edit } : { id: uid(), date: todayISO(), from: 'bank', to: 'cash', amount: 0, description: '', createdAt: '', ...props.prefill });
  const upd = (patch: Partial<Transfer>) => setT((x) => ({ ...x, ...patch }));
  const dir = t.from === 'bank' ? 'withdraw' : 'deposit';
  const submit = () => {
    if (!attempt(() => saveTransfer(t), 'ההעברה נשמרה')) return;
    props.onSaved?.(t);
    closeForm();
  };
  return (
    <Modal title="העברה בין הבנק לקופה הקטנה" onClose={closeForm}
      footer={
        <>
          <button className="btn primary" onClick={submit} disabled={isLocked(d, t.date)}><Icon name="check" />שמירה</button>
          <button className="btn" onClick={closeForm}>ביטול</button>
        </>
      }
    >
      <div className="form">
        <Field label="סוג פעולה">
          <Seg value={dir} onChange={(v) => upd(v === 'withdraw' ? { from: 'bank', to: 'cash' } : { from: 'cash', to: 'bank' })}
            options={[{ value: 'withdraw', label: 'משיכת מזומן מהבנק לקופה' }, { value: 'deposit', label: 'הפקדת מזומן מהקופה לבנק' }]} />
        </Field>
        <div className="small muted">פעולה פנימית – לא נרשמת כהכנסה או כהוצאה, רק מעבירה כסף בין שני החשבונות.</div>
        <div className="form-row">
          <Field label="סכום (₪)"><NumInput value={t.amount} onChange={(amount) => upd({ amount })} autoFocus /></Field>
          <Field label="תאריך"><input className="input" type="date" value={t.date} onChange={(e) => upd({ date: e.target.value })} /></Field>
          <Field label="אסמכתא"><input className="input ltr" value={t.reference || ''} onChange={(e) => upd({ reference: e.target.value })} /></Field>
        </div>
        <Field label="תיאור"><input className="input" value={t.description} onChange={(e) => upd({ description: e.target.value })} placeholder={dir === 'withdraw' ? 'משיכת מזומן לקופה קטנה' : 'הפקדת מזומן לבנק'} /></Field>
      </div>
    </Modal>
  );
}
