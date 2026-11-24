import { useRef, useState } from 'react';
import type { AppData, Payment } from '../lib/types';
import { useData } from '../lib/store';
import { payerEmail, payerName, payerPhone } from '../lib/calc';
import { cleanPhone, fmtDate, METHOD_LABELS, money } from '../lib/format';
import { elementToPdf, shareOrDownload } from '../lib/pdf';
import { Icon, Modal, toast } from './ui';

export function ReceiptSheet({ d, p }: { d: AppData; p: Payment }) {
  const s = d.settings;
  const u = d.units.find((x) => x.id === p.unitId);
  const methodText = (() => {
    const base = METHOD_LABELS[p.method];
    if (p.method === 'check') return `${base} מס' ${p.checkNumber || '—'}${p.checkBank ? `, ${p.checkBank}` : ''}, לפירעון ${fmtDate(p.valueDate)}`;
    return p.reference ? `${base}, אסמכתא ${p.reference}` : base;
  })();
  return (
    <div className="receipt-sheet" dir="rtl">
      <div className="r-head">
        <div>
          <div className="r-bname">{s.buildingName || 'ועד הבית'}</div>
          <div>{[s.address, s.city].filter(Boolean).join(', ')}</div>
          {s.committeeId && <div>מס' מזהה: {s.committeeId}</div>}
          {(s.phone || s.email) && <div>{[s.phone, s.email].filter(Boolean).join(' · ')}</div>}
        </div>
        {s.logo && <img className="r-logo" src={s.logo} alt="" />}
      </div>
      <div className="r-title">קבלה</div>
      <div className="r-no">מספר <b>{p.receiptNumber}</b> · תאריך הפקה {fmtDate(p.createdAt?.slice(0, 10) || p.date)}</div>
      <div className="r-orig">מקור</div>
      {p.cancelled && (
        <div style={{ textAlign: 'center' }}>
          <div className="r-void">מבוטלת</div>
          {p.cancelReason && <div className="small">{p.cancelReason}</div>}
        </div>
      )}
      <table>
        <tbody>
          <tr><th>התקבל מאת</th><td>{payerName(u)}</td></tr>
          <tr><th>מספר דירה</th><td>{u?.aptNumber}</td></tr>
          <tr><th>עבור</th><td>{p.forText}</td></tr>
          <tr><th>אמצעי תשלום</th><td>{methodText}</td></tr>
          <tr><th>תאריך ערך</th><td>{fmtDate(p.valueDate || p.date)}</td></tr>
          <tr><th>סכום</th><td className="r-total">{money(p.amount, true)}</td></tr>
        </tbody>
      </table>
      <div className="r-sign">
        <div className="small">תודה רבה!</div>
        <div>
          {s.signature && <img src={s.signature} alt="חתימה" />}
          <div className="line">{s.treasurerName ? `${s.treasurerName}, גזבר הוועד` : 'חתימת הגזבר'}</div>
        </div>
      </div>
      <div className="r-note">ועד הבית אינו עוסק מורשה. מסמך זה הוא קבלה על תקבול בלבד ואינו חשבונית מס.</div>
    </div>
  );
}

export function receiptFileName(p: Payment) {
  return `קבלה-${p.receiptNumber}.pdf`;
}

export function ReceiptModal({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const d = useData();
  const p = d.payments.find((x) => x.id === paymentId);
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  const u = d.units.find((x) => x.id === p.unitId);
  const phone = cleanPhone(payerPhone(u));
  const email = payerEmail(u);
  const msg = `שלום ${payerName(u)},\nמצורפת קבלה מס' ${p.receiptNumber} על סך ${money(p.amount, true)} עבור ${p.forText}.\nתודה, ${d.settings.treasurerName || 'ועד הבית'}`;

  const makePdf = async () => {
    const el = ref.current?.querySelector('.receipt-sheet') as HTMLElement;
    return elementToPdf(el);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast('שגיאה ביצירת ה-PDF: ' + (e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const download = () => run(async () => {
    const blob = await makePdf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = receiptFileName(p);
    a.click();
  });

  const share = () => run(async () => {
    const blob = await makePdf();
    const r = await shareOrDownload(blob, receiptFileName(p), msg);
    if (r === 'downloaded') toast('הקובץ ירד למחשב – ניתן לצרף אותו להודעה', 'info');
  });

  const whatsapp = () => run(async () => {
    const blob = await makePdf();
    const r = await shareOrDownload(blob, receiptFileName(p), msg);
    if (r === 'downloaded') {
      toast('ה-PDF ירד למחשב. בחלון הוואטסאפ שנפתח יש לצרף אותו (📎).', 'info');
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    }
  });

  const mail = () => run(async () => {
    const blob = await makePdf();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = receiptFileName(p);
    a.click();
    toast('ה-PDF ירד למחשב. יש לצרף אותו למייל שנפתח.', 'info');
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(`קבלה מס' ${p.receiptNumber} – ${d.settings.buildingName || 'ועד הבית'}`)}&body=${encodeURIComponent(msg)}`;
  });

  const print = () => {
    document.body.classList.add('printing-modal');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-modal'), 500);
  };

  return (
    <Modal title={`קבלה מס' ${p.receiptNumber}`} onClose={onClose} size="wide" printKeep
      footer={
        <>
          <button className="btn primary" onClick={share} disabled={busy}><Icon name="share" />שיתוף</button>
          <button className="btn success" onClick={whatsapp} disabled={busy || !phone} title={phone ? '' : 'אין טלפון בכרטיס הדייר'}><Icon name="whatsapp" />וואטסאפ</button>
          <button className="btn" onClick={mail} disabled={busy || !email} title={email ? '' : 'אין אימייל בכרטיס הדייר'}><Icon name="mail" />אימייל</button>
          <button className="btn" onClick={download} disabled={busy}><Icon name="download" />הורדת PDF</button>
          <button className="btn" onClick={print}><Icon name="print" />הדפסה</button>
          <span className="spacer" />
          {busy && <span className="muted">מכין PDF…</span>}
        </>
      }
    >
      <div ref={ref} style={{ overflowX: 'auto' }}>
        <ReceiptSheet d={d} p={p} />
      </div>
    </Modal>
  );
}
