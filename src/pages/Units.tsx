import { useState } from 'react';
import type { Charge, Unit } from '../lib/types';
import { useData } from '../lib/store';
import { cancelPayment, deleteCharge, deleteUnit, saveCharge, saveUnit } from '../lib/actions';
import { currentRate, payerName, payerPhone, sortUnits, unitAccount, unitFull, unitStatement } from '../lib/calc';
import { cleanPhone, currentMonth, fmtDate, money, monthLabel, todayISO, uid } from '../lib/format';
import { exportExcel } from '../lib/excel';
import { attempt, confirmDialog, Empty, Field, Icon, Modal, Money, navigate, NumInput, PageHead, promptDialog, Seg } from '../components/ui';
import { openForm } from '../components/forms';

export function UnitsPage() {
  const d = useData();
  const [edit, setEdit] = useState<Unit | null>(null);
  const units = sortUnits(d.units);
  const newUnit = (): Unit => ({ id: uid(), aptNumber: String(units.length + 1), ownerName: '', payer: 'owner', billingStart: currentMonth(), rates: [{ from: currentMonth(), amount: d.settings.defaultMonthly }] });
  return (
    <>
      <PageHead title="דיירים" sub={`${units.length} דירות בבניין`} actions={<button className="btn primary" onClick={() => setEdit(newUnit())}><Icon name="plus" />דירה חדשה</button>} />
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>דירה</th><th>בעלים</th><th>שוכר</th><th>טלפון</th><th>דמי ועד</th><th className="amt">יתרה</th><th /></tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const acc = unitAccount(d, u);
                const left = u.moveOut && u.moveOut <= todayISO();
                return (
                  <tr key={u.id} className={'clickable' + (left ? ' muted' : '')} onClick={() => navigate('/units/' + u.id)}>
                    <td className="bold">{u.aptNumber}</td>
                    <td>{u.ownerName || <span className="muted">—</span>}{u.payer === 'owner' && u.tenantName ? <span className="badge" style={{ marginInlineStart: 6 }}>משלם</span> : null}</td>
                    <td>{u.tenantName || <span className="muted">—</span>}{u.payer === 'tenant' && <span className="badge blue" style={{ marginInlineStart: 6 }}>משלם</span>}</td>
                    <td className="num">{payerPhone(u)}</td>
                    <td><Money v={currentRate(u)} /></td>
                    <td className="amt bold">
                      {acc.balance > 0 ? <span className="neg num">חוב {money(acc.balance)}</span> : acc.balance < 0 ? <span className="pos num">זכות {money(-acc.balance)}</span> : <span className="muted">0</span>}
                    </td>
                    <td><div className="row-actions"><button className="icon-btn" onClick={(e) => { e.stopPropagation(); setEdit(u); }}><Icon name="edit" /></button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {units.length === 0 && <Empty icon="🏠">עדיין לא הוגדרו דירות</Empty>}
        </div>
      </div>
      {edit && <UnitForm unit={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

export function UnitForm({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const d = useData();
  const [u, setU] = useState<Unit>(() => structuredClone(unit));
  const isNew = !d.units.some((x) => x.id === unit.id);
  const upd = (p: Partial<Unit>) => setU((x) => ({ ...x, ...p }));
  const rates = [...u.rates].sort((a, b) => a.from.localeCompare(b.from));
  const save = () => attempt(() => saveUnit({ ...u, rates }), 'כרטיס הדייר נשמר') && onClose();
  const remove = async () => {
    if (!(await confirmDialog('מחיקת דירה', `למחוק את ${unitFull(unit)} וכל החיובים שלה?`, { danger: true, okLabel: 'מחיקה' }))) return;
    if (attempt(() => deleteUnit(unit.id), 'הדירה נמחקה')) {
      onClose();
      navigate('/units');
    }
  };
  return (
    <Modal title={isNew ? 'דירה חדשה' : `עריכת ${unitFull(unit)}`} onClose={onClose} size="wide"
      footer={
        <>
          <button className="btn primary" onClick={save}><Icon name="check" />שמירה</button>
          <button className="btn" onClick={onClose}>ביטול</button>
          <span className="spacer" />
          {!isNew && <button className="btn danger" onClick={remove}><Icon name="trash" />מחיקה</button>}
        </>
      }
    >
      <div className="form">
        <div className="form-row">
          <Field label="מספר דירה"><input className="input" value={u.aptNumber} onChange={(e) => upd({ aptNumber: e.target.value })} /></Field>
          <Field label="קומה"><input className="input" value={u.floor || ''} onChange={(e) => upd({ floor: e.target.value })} /></Field>
          <Field label="מי משלם ומקבל קבלות">
            <Seg value={u.payer} onChange={(payer) => upd({ payer })} options={[{ value: 'owner', label: 'הבעלים' }, { value: 'tenant', label: 'השוכר' }]} />
          </Field>
        </div>
        <h3>בעלים</h3>
        <div className="form-row">
          <Field label="שם מלא"><input className="input" value={u.ownerName} onChange={(e) => upd({ ownerName: e.target.value })} /></Field>
          <Field label="טלפון"><input className="input ltr" value={u.ownerPhone || ''} onChange={(e) => upd({ ownerPhone: e.target.value })} /></Field>
          <Field label="אימייל (לשליחת קבלות)"><input className="input ltr" type="email" value={u.ownerEmail || ''} onChange={(e) => upd({ ownerEmail: e.target.value })} /></Field>
        </div>
        <h3>שוכר (אם יש)</h3>
        <div className="form-row">
          <Field label="שם מלא"><input className="input" value={u.tenantName || ''} onChange={(e) => upd({ tenantName: e.target.value })} /></Field>
          <Field label="טלפון"><input className="input ltr" value={u.tenantPhone || ''} onChange={(e) => upd({ tenantPhone: e.target.value })} /></Field>
          <Field label="אימייל"><input className="input ltr" type="email" value={u.tenantEmail || ''} onChange={(e) => upd({ tenantEmail: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="תאריך אכלוס"><input className="input" type="date" value={u.moveIn || ''} onChange={(e) => upd({ moveIn: e.target.value || undefined })} /></Field>
          <Field label="תאריך עזיבה" hint="לאחר חודש זה לא ייווצרו חיובים"><input className="input" type="date" value={u.moveOut || ''} onChange={(e) => upd({ moveOut: e.target.value || undefined })} /></Field>
          <Field label="חיוב אוטומטי החל מחודש"><input className="input" type="month" value={u.billingStart} onChange={(e) => upd({ billingStart: e.target.value })} /></Field>
        </div>
        <div className="hr" />
        <div className="row between">
          <h3>היסטוריית תעריפי דמי ועד</h3>
          <button className="btn sm" onClick={() => upd({ rates: [...u.rates, { from: currentMonth(), amount: currentRate(u) || d.settings.defaultMonthly }] })}><Icon name="plus" />העלאת / שינוי תעריף</button>
        </div>
        <table className="t">
          <thead><tr><th>החל מחודש</th><th>סכום חודשי (₪)</th><th /></tr></thead>
          <tbody>
            {u.rates.map((r, i) => (
              <tr key={i}>
                <td><input className="input" type="month" value={r.from} onChange={(e) => upd({ rates: u.rates.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} /></td>
                <td><NumInput value={r.amount} onChange={(amount) => upd({ rates: u.rates.map((x, j) => (j === i ? { ...x, amount } : x)) })} /></td>
                <td>{u.rates.length > 1 && <button className="icon-btn" onClick={() => upd({ rates: u.rates.filter((_, j) => j !== i) })}><Icon name="trash" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small muted">שינוי תעריף מעדכן אוטומטית את החיובים החודשיים מהחודש שנבחר (בשנים שאינן נעולות).</div>
        <Field label="הערות"><textarea className="input" value={u.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function UnitPage({ id }: { id: string }) {
  const d = useData();
  const u = d.units.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [charge, setCharge] = useState<Charge | null>(null);
  if (!u) return <Empty>הדירה לא נמצאה. <a href="#/units">חזרה לרשימה</a></Empty>;
  const acc = unitAccount(d, u);
  const rows = unitStatement(d, u.id);
  const phone = cleanPhone(payerPhone(u));

  const exportXlsx = () => {
    exportExcel(`כרטסת-דירה-${u.aptNumber}`, [
      {
        name: 'כרטסת',
        rows: [
          [`כרטסת ${unitFull(u)}`],
          [`נכון ל-${fmtDate(todayISO())}`],
          [],
          ['תאריך', 'תיאור', 'קבלה', 'חיוב', 'תשלום', 'יתרה'],
          ...rows.map((r) => [fmtDate(r.date), r.description, r.receiptNumber ?? '', r.charge || '', r.payment || '', r.balance]),
          [],
          ['', 'יתרה סופית', '', acc.totalCharged, acc.totalPaid, acc.balance],
        ],
      },
    ]);
  };

  const shareText = () => {
    const msg = `שלום ${payerName(u)},\nמצב החשבון של דירה ${u.aptNumber} בוועד הבית נכון ל-${fmtDate(todayISO())}:\n${acc.balance > 0 ? `יתרת חוב: ${money(acc.balance)}` : acc.balance < 0 ? `יתרת זכות: ${money(-acc.balance)}` : 'אין חוב פתוח 🙏'}\n${acc.charges.filter((a) => a.remaining > 0).map((a) => `• ${a.charge.description} ${monthLabel(a.charge.month)}: ${money(a.remaining)}`).join('\n')}\nתודה, ${d.settings.treasurerName || 'ועד הבית'}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const addCharge = () => setCharge({ id: uid(), unitId: u.id, month: currentMonth(), date: todayISO(), amount: 0, kind: 'special', description: '' });

  return (
    <>
      <div className="print-only print-head"><h2>{d.settings.buildingName} – כרטסת {unitFull(u)}</h2><div>נכון ל-{fmtDate(todayISO())}</div></div>
      <PageHead
        title={unitFull(u)}
        sub={<a href="#/units">← כל הדיירים</a>}
        actions={
          <>
            <button className="btn primary" onClick={() => openForm({ kind: 'payment', unitId: u.id })}><Icon name="plus" />קליטת תשלום</button>
            <button className="btn" onClick={addCharge}><Icon name="plus" />חיוב נוסף</button>
            <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" />עריכת כרטיס</button>
            <button className="btn" onClick={() => window.print()}><Icon name="print" />PDF / הדפסה</button>
            <button className="btn" onClick={exportXlsx}><Icon name="download" />Excel</button>
            {phone && <button className="btn success" onClick={shareText}><Icon name="whatsapp" />שליחת מצב חשבון</button>}
          </>
        }
      />
      <div className="grid grid-3 no-print">
        <div className="card card-pad stat">
          <div className="label">יתרה נוכחית</div>
          <div className={'value ' + (acc.balance > 0 ? 'neg' : acc.balance < 0 ? 'pos' : '')}>
            {acc.balance > 0 ? 'חוב ' : acc.balance < 0 ? 'זכות ' : ''}<span className="num">{money(Math.abs(acc.balance))}</span>
          </div>
          <div className="meta">סה"כ חיובים <span className="num">{money(acc.totalCharged)}</span> · סה"כ שולם <span className="num">{money(acc.totalPaid)}</span></div>
        </div>
        <div className="card card-pad">
          <dl className="kv">
            <dt>בעלים</dt><dd>{u.ownerName || '—'} {u.ownerPhone && <span className="num muted">{u.ownerPhone}</span>}</dd>
            {u.tenantName && <><dt>שוכר</dt><dd>{u.tenantName} {u.tenantPhone && <span className="num muted">{u.tenantPhone}</span>}</dd></>}
            <dt>אימייל</dt><dd className="num">{u.payer === 'tenant' ? u.tenantEmail || u.ownerEmail : u.ownerEmail || '—'}</dd>
            {u.moveIn && <><dt>אכלוס</dt><dd>{fmtDate(u.moveIn)}</dd></>}
            {u.moveOut && <><dt>עזיבה</dt><dd>{fmtDate(u.moveOut)}</dd></>}
          </dl>
        </div>
        <div className="card card-pad">
          <div className="label bold small muted" style={{ marginBottom: 6 }}>תעריפים</div>
          {[...u.rates].sort((a, b) => a.from.localeCompare(b.from)).map((r) => (
            <div key={r.from} className="row between"><span>מ-{monthLabel(r.from)}</span><Money v={r.amount} /></div>
          ))}
          {u.notes && <div className="small muted mt">{u.notes}</div>}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>כרטסת דייר</h2><span className="muted small">לחיצה על חיוב לעריכה · על תשלום לצפייה בקבלה</span></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>תאריך</th><th>תיאור</th><th>קבלה</th><th className="amt">חיוב</th><th className="amt">תשלום</th><th className="amt">יתרה</th><th className="no-print" /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const p = r.paymentId ? d.payments.find((x) => x.id === r.paymentId) : undefined;
                const c = r.chargeId ? d.charges.find((x) => x.id === r.chargeId) : undefined;
                return (
                  <tr key={r.key} className={(r.cancelled ? 'cancelled ' : '') + 'clickable'} onClick={() => (c ? setCharge(c) : p?.receiptNumber ? openForm({ kind: 'receipt', paymentId: p.id }) : p && openForm({ kind: 'payment', edit: p }))}>
                    <td className="num">{fmtDate(r.date)}</td>
                    <td>{r.description}{c?.kind === 'special' && <span className="badge violet" style={{ marginInlineStart: 6 }}>מיוחד</span>}</td>
                    <td className="num">{r.receiptNumber ?? ''}</td>
                    <td className="amt">{r.charge ? <Money v={r.charge} /> : ''}</td>
                    <td className="amt pos">{r.payment ? <Money v={r.payment} /> : ''}</td>
                    <td className={'amt bold ' + (r.balance > 0 ? 'neg' : r.balance < 0 ? 'pos' : '')}><Money v={r.balance} /></td>
                    <td className="no-print">
                      {p && !p.cancelled && (
                        <div className="row-actions">
                          <button className="icon-btn" title="עריכה" onClick={(e) => { e.stopPropagation(); openForm({ kind: 'payment', edit: p }); }}><Icon name="edit" /></button>
                          <button className="icon-btn" title="ביטול תקבול" onClick={async (e) => { e.stopPropagation(); const reason = await promptDialog('ביטול תקבול', 'סיבת הביטול', { danger: true, okLabel: 'ביטול התקבול' }); if (reason) attempt(() => cancelPayment(p.id, reason), 'התקבול בוטל'); }}><Icon name="ban" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={3}>סה"כ</td><td className="amt"><Money v={acc.totalCharged} /></td><td className="amt"><Money v={acc.totalPaid} /></td><td className="amt"><Money v={acc.balance} /></td><td className="no-print" /></tr>
            </tfoot>
          </table>
          {rows.length === 0 && <Empty>אין עדיין חיובים או תשלומים</Empty>}
        </div>
      </div>
      {edit && <UnitForm unit={u} onClose={() => setEdit(false)} />}
      {charge && <ChargeForm charge={charge} onClose={() => setCharge(null)} />}
    </>
  );
}

export function ChargeForm({ charge, onClose }: { charge: Charge; onClose: () => void }) {
  const d = useData();
  const [c, setC] = useState<Charge>({ ...charge });
  const isNew = !d.charges.some((x) => x.id === charge.id);
  const upd = (p: Partial<Charge>) => setC((x) => ({ ...x, ...p }));
  const save = () => attempt(() => saveCharge({ ...c, month: c.kind === 'monthly' ? c.month : c.date.slice(0, 7) }), 'החיוב נשמר') && onClose();
  const remove = async () => {
    const msg = c.auto ? 'החיוב החודשי יאופס (פטור) ולא ייווצר מחדש.' : 'למחוק את החיוב?';
    if (!(await confirmDialog('ביטול חיוב', msg, { danger: true, okLabel: 'אישור' }))) return;
    if (attempt(() => deleteCharge(c.id), 'החיוב בוטל')) onClose();
  };
  return (
    <Modal title={isNew ? 'חיוב נוסף' : 'עריכת חיוב'} onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save}><Icon name="check" />שמירה</button>
          <button className="btn" onClick={onClose}>ביטול</button>
          <span className="spacer" />
          {!isNew && <button className="btn danger" onClick={remove}><Icon name="trash" />{c.auto ? 'פטור מחיוב' : 'מחיקה'}</button>}
        </>
      }
    >
      <div className="form">
        <div className="small muted">{unitFull(d.units.find((u) => u.id === c.unitId))}</div>
        {c.kind === 'monthly' ? (
          <div className="banner info" style={{ marginBottom: 0 }}>חיוב חודשי אוטומטי – {monthLabel(c.month)}. שינוי סכום ינעל אותו מפני עדכוני תעריף.</div>
        ) : (
          <Field label="סוג חיוב"><Seg value={c.kind} onChange={(kind) => upd({ kind })} options={[{ value: 'special', label: 'חיוב מיוחד / חד-פעמי' }]} /></Field>
        )}
        <Field label="תיאור"><input className="input" value={c.description} onChange={(e) => upd({ description: e.target.value })} placeholder="למשל: יתרת חוב משנה קודמת / צביעת חדר מדרגות" /></Field>
        <div className="form-row">
          <Field label="סכום (₪)"><NumInput value={c.amount} onChange={(amount) => upd({ amount })} /></Field>
          {c.kind !== 'monthly' && <Field label="תאריך חיוב"><input className="input" type="date" value={c.date} onChange={(e) => upd({ date: e.target.value })} /></Field>}
        </div>
      </div>
    </Modal>
  );
}
