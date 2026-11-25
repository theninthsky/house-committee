import { useState } from 'react';
import type { Unit } from '../lib/types';
import { update } from '../lib/store';
import { runAutoSync } from '../lib/actions';
import { loadDemoData } from '../lib/demo';
import { restoreBackup } from '../lib/backup';
import { currentMonth, todayISO, uid } from '../lib/format';
import { attempt, Field, FileDrop, Icon, NumInput, toast } from '../components/ui';
import { SetupCloudRestore } from '../components/cloud';

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [s, setS] = useState({
    buildingName: '',
    address: '',
    city: '',
    treasurerName: '',
    units: 11,
    monthly: 250,
    billingStart: currentMonth(),
    openingDate: todayISO().slice(0, 8) + '01',
    openingBank: 0,
    openingCash: 0,
    nextReceiptNumber: 1,
  });
  const [rows, setRows] = useState<{ apt: string; name: string; phone: string; email: string }[]>([]);

  const toRows = () => {
    const n = Math.max(1, Math.min(200, s.units));
    setRows((prev) => Array.from({ length: n }, (_, i) => prev[i] || { apt: String(i + 1), name: '', phone: '', email: '' }));
    setStep(1);
  };

  const finish = () => {
    attempt(() => {
      update(
        (d) => {
          Object.assign(d.settings, {
            buildingName: s.buildingName.trim() || 'ועד הבית',
            address: s.address,
            city: s.city,
            treasurerName: s.treasurerName,
            currentUser: s.treasurerName,
            defaultMonthly: s.monthly,
            openingDate: s.openingDate,
            openingBank: s.openingBank,
            openingCash: s.openingCash,
            nextReceiptNumber: Math.max(1, Math.floor(s.nextReceiptNumber)),
            setupDone: true,
          });
          d.units = rows.map(
            (r): Unit => ({
              id: uid(),
              aptNumber: r.apt.trim() || '?',
              ownerName: r.name.trim(),
              ownerPhone: r.phone.trim() || undefined,
              ownerEmail: r.email.trim() || undefined,
              payer: 'owner',
              billingStart: s.billingStart,
              rates: [{ from: s.billingStart, amount: s.monthly }],
            }),
          );
        },
        { action: 'create', entity: 'setup', summary: `הקמת המערכת: ${rows.length} דירות, דמי ועד ₪${s.monthly}` },
      );
      runAutoSync();
    }, 'המערכת מוכנה לעבודה!');
  };

  return (
    <div className="setup">
      <div className="card card-pad" style={{ padding: 28 }}>
        <h1 style={{ marginBottom: 4 }}>🏢 ברוכים הבאים למערכת ניהול ועד הבית</h1>
        <div className="muted mb">כמה פרטים בסיסיים ונתחיל. הכול ניתן לשינוי אחר כך במסך ההגדרות.</div>

        {step === 0 && (
          <div className="form">
            <div className="form-row">
              <Field label="שם הבניין / הוועד"><input className="input" value={s.buildingName} onChange={(e) => setS({ ...s, buildingName: e.target.value })} placeholder="ועד הבית רחוב הרצל 12" autoFocus /></Field>
              <Field label="שם הגזבר"><input className="input" value={s.treasurerName} onChange={(e) => setS({ ...s, treasurerName: e.target.value })} /></Field>
            </div>
            <div className="form-row">
              <Field label="כתובת"><input className="input" value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} /></Field>
              <Field label="עיר"><input className="input" value={s.city} onChange={(e) => setS({ ...s, city: e.target.value })} /></Field>
            </div>
            <div className="form-row">
              <Field label="מספר דירות"><NumInput value={s.units} onChange={(units) => setS({ ...s, units })} /></Field>
              <Field label="דמי ועד חודשיים לדירה (₪)"><NumInput value={s.monthly} onChange={(monthly) => setS({ ...s, monthly })} /></Field>
              <Field label="חיוב ראשון בחודש" hint="ממנו ייווצרו חיובים חודשיים אוטומטיים"><input className="input" type="month" value={s.billingStart} onChange={(e) => setS({ ...s, billingStart: e.target.value })} /></Field>
            </div>
            <div className="hr" />
            <h3>יתרות פתיחה</h3>
            <div className="form-row">
              <Field label="נכון לתאריך"><input className="input" type="date" value={s.openingDate} onChange={(e) => setS({ ...s, openingDate: e.target.value })} /></Field>
              <Field label="יתרה בבנק (₪)"><NumInput value={s.openingBank} onChange={(openingBank) => setS({ ...s, openingBank })} /></Field>
              <Field label="מזומן בקופה הקטנה (₪)"><NumInput value={s.openingCash} onChange={(openingCash) => setS({ ...s, openingCash })} /></Field>
              <Field label="מספר הקבלה הבא" hint="אם כבר הופקו קבלות בעבר"><NumInput value={s.nextReceiptNumber} onChange={(nextReceiptNumber) => setS({ ...s, nextReceiptNumber })} /></Field>
            </div>
            <div className="row mt">
              <button className="btn primary lg" onClick={toRows}>המשך לפרטי הדיירים ←</button>
              <span className="spacer" />
            </div>
            <div className="hr" />
            <div className="row">
              <button className="btn" onClick={() => { loadDemoData(); toast('נטענו נתוני דוגמה – אפשר לשחק ולמחוק מההגדרות'); }}>
                <Icon name="sparkle" />רוצים להתנסות? טעינת נתוני דוגמה
              </button>
            </div>
            <div className="mt">
              <FileDrop accept=".json,application/json" onFiles={async ([f]) => { try { await restoreBackup(f); toast('הנתונים שוחזרו מהגיבוי'); } catch (e) { toast((e as Error).message, 'error'); } }}>
                <Icon name="upload" /> יש לכם קובץ גיבוי? גררו אותו לכאן לשחזור
              </FileDrop>
            </div>
            <SetupCloudRestore />
          </div>
        )}

        {step === 1 && (
          <div className="form">
            <div className="muted">אפשר להשאיר שדות ריקים ולהשלים מאוחר יותר בכרטיס הדייר.</div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th style={{ width: 90 }}>דירה</th><th>שם הבעלים / הדייר</th><th>טלפון</th><th>אימייל</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><input className="input" value={r.apt} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, apt: e.target.value } : x)))} /></td>
                      <td><input className="input" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                      <td><input className="input ltr" value={r.phone} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} /></td>
                      <td><input className="input ltr" value={r.email} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button className="btn primary lg" onClick={finish}><Icon name="check" />סיום והתחלת עבודה</button>
              <button className="btn" onClick={() => setStep(0)}>→ חזרה</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
