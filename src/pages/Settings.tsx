import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../lib/types';
import { emptyData, replaceData, useData } from '../lib/store';
import { saveSettings, setYearLock } from '../lib/actions';
import { autoBackup, chooseBackupFolder, downloadBackup, folderBackupSupported, forgetBackupFolder, getBackupFolder, restoreBackup } from '../lib/backup';
import { fileClear } from '../lib/db';
import { fmtDateTime, todayISO } from '../lib/format';
import { exportExcel } from '../lib/excel';
import { attempt, confirmDialog, Field, FileDrop, Icon, NumInput, PageHead, promptDialog, toast } from '../components/ui';
import { loadDemoData } from '../lib/demo';
import { CloudBackupPanel } from '../components/cloud';

const TABS = [
  { id: 'building', label: 'פרטי הבניין' },
  { id: 'finance', label: 'כספים וסעיפים' },
  { id: 'periods', label: 'נעילת תקופות' },
  { id: 'backup', label: 'גיבוי ושחזור' },
  { id: 'audit', label: 'יומן פעולות' },
  { id: 'data', label: 'נתונים' },
];

export function SettingsPage({ tab = 'building' }: { tab?: string }) {
  return (
    <>
      <PageHead title="הגדרות" />
      <div className="tabs">
        {TABS.map((t) => <a key={t.id} href={'#/settings/' + t.id} className={tab === t.id ? 'on' : ''}>{t.label}</a>)}
      </div>
      {tab === 'building' && <BuildingTab />}
      {tab === 'finance' && <FinanceTab />}
      {tab === 'periods' && <PeriodsTab />}
      {tab === 'backup' && (
        <>
          <CloudBackupPanel />
          <BackupTab />
        </>
      )}
      {tab === 'audit' && <AuditTab />}
      {tab === 'data' && <DataTab />}
    </>
  );
}

function useDraft() {
  const d = useData();
  const [s, setS] = useState<Settings>(d.settings);
  useEffect(() => {
    setS(d.settings);
  }, [d.settings]);
  const upd = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));
  return { s, upd, d };
}

function readImage(file: File, maxW = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = img.width * scale;
      c.height = img.height * scale;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function BuildingTab() {
  const { s, upd } = useDraft();
  const save = () => attempt(() => saveSettings({ buildingName: s.buildingName, address: s.address, city: s.city, committeeId: s.committeeId, phone: s.phone, email: s.email, bankDetails: s.bankDetails, logo: s.logo, treasurerName: s.treasurerName, signature: s.signature, currentUser: s.currentUser }, 'עדכון פרטי הבניין'), 'נשמר');
  return (
    <div className="card card-pad">
      <div className="form">
        <div className="form-row">
          <Field label="שם הבניין / הוועד"><input className="input" value={s.buildingName} onChange={(e) => upd({ buildingName: e.target.value })} /></Field>
          <Field label="כתובת"><input className="input" value={s.address} onChange={(e) => upd({ address: e.target.value })} /></Field>
          <Field label="עיר"><input className="input" value={s.city || ''} onChange={(e) => upd({ city: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="מספר מזהה (עמותה / תיק, אם יש)"><input className="input" value={s.committeeId || ''} onChange={(e) => upd({ committeeId: e.target.value })} /></Field>
          <Field label="טלפון הוועד"><input className="input ltr" value={s.phone || ''} onChange={(e) => upd({ phone: e.target.value })} /></Field>
          <Field label="אימייל הוועד"><input className="input ltr" value={s.email || ''} onChange={(e) => upd({ email: e.target.value })} /></Field>
        </div>
        <Field label="פרטי חשבון הבנק של הוועד (להצגה לדיירים)"><input className="input" value={s.bankDetails || ''} onChange={(e) => upd({ bankDetails: e.target.value })} placeholder="בנק, סניף, מספר חשבון" /></Field>
        <div className="form-row">
          <Field label="שם הגזבר (יופיע בקבלות)"><input className="input" value={s.treasurerName} onChange={(e) => upd({ treasurerName: e.target.value })} /></Field>
          <Field label="המשתמש הנוכחי (ליומן הפעולות)" hint="מי שעובד כרגע על המערכת במחשב זה"><input className="input" value={s.currentUser} onChange={(e) => upd({ currentUser: e.target.value })} /></Field>
        </div>
        <div className="grid grid-2">
          <Field label="לוגו (לקבלות)">
            {s.logo && <div className="row mb"><img src={s.logo} alt="" style={{ maxHeight: 70, maxWidth: 180 }} /><button className="btn sm danger" onClick={() => upd({ logo: undefined })}>הסרה</button></div>}
            <FileDrop accept="image/*" onFiles={async ([f]) => upd({ logo: await readImage(f, 400) })}>העלאת תמונת לוגו</FileDrop>
          </Field>
          <Field label="חתימה דיגיטלית של הגזבר">
            <SignaturePad value={s.signature} onChange={(signature) => upd({ signature })} />
          </Field>
        </div>
        <div><button className="btn primary" onClick={save}><Icon name="check" />שמירה</button></div>
      </div>
    </div>
  );
}

function SignaturePad({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const c = ref.current!;
    c.width = c.offsetWidth * 2;
    c.height = c.offsetHeight * 2;
    const ctx = c.getContext('2d')!;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a2a6c';
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2];
  };
  return (
    <div>
      <canvas
        ref={ref}
        className="sig-pad"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
          setDirty(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty) onChange(ref.current!.toDataURL('image/png'));
        }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <span className="small muted">חתמו עם העכבר או האצבע</span>
        <button className="btn sm" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDirty(false); onChange(undefined); }}>ניקוי</button>
      </div>
    </div>
  );
}

function FinanceTab() {
  const { s, upd, d } = useDraft();
  const maxReceipt = Math.max(0, ...d.payments.map((p) => p.receiptNumber || 0));
  const save = () =>
    attempt(() => {
      if (s.nextReceiptNumber <= maxReceipt) throw new Error(`מספר הקבלה הבא חייב להיות גדול מ-${maxReceipt} (הקבלה האחרונה שהופקה)`);
      saveSettings({ openingDate: s.openingDate, openingBank: s.openingBank, openingCash: s.openingCash, defaultMonthly: s.defaultMonthly, nextReceiptNumber: Math.floor(s.nextReceiptNumber), checkAlertDays: s.checkAlertDays, contractAlertDays: s.contractAlertDays, matchDays: s.matchDays, backupReminderDays: s.backupReminderDays, expenseCategories: s.expenseCategories }, 'עדכון הגדרות כספים');
    }, 'נשמר');
  const addCat = async () => {
    const c = await promptDialog('סעיף הוצאה חדש', 'שם הסעיף');
    if (c && !s.expenseCategories.includes(c.trim())) upd({ expenseCategories: [...s.expenseCategories, c.trim()] });
  };
  const used = new Set([...d.expenses.map((e) => e.category), ...d.vendors.map((v) => v.category)]);
  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <div className="form">
          <h3>יתרות פתיחה</h3>
          <div className="form-row">
            <Field label="נכון לתאריך"><input className="input" type="date" value={s.openingDate} onChange={(e) => upd({ openingDate: e.target.value })} /></Field>
            <Field label="יתרה בבנק"><NumInput value={s.openingBank} onChange={(openingBank) => upd({ openingBank })} /></Field>
            <Field label="מזומן בקופה"><NumInput value={s.openingCash} onChange={(openingCash) => upd({ openingCash })} /></Field>
          </div>
          <div className="small muted">חובות פתוחים של דיירים מלפני תאריך הפתיחה – הוסיפו כ"חיוב נוסף" בכרטיס הדייר.</div>
          <div className="hr" />
          <div className="form-row">
            <Field label="דמי ועד ברירת מחדל לדירה חדשה"><NumInput value={s.defaultMonthly} onChange={(defaultMonthly) => upd({ defaultMonthly })} /></Field>
            <Field label="מספר הקבלה הבא" hint={maxReceipt ? `הקבלה האחרונה: ${maxReceipt}` : 'רצף אוטומטי ללא כפילויות'}><NumInput value={s.nextReceiptNumber} onChange={(nextReceiptNumber) => upd({ nextReceiptNumber })} /></Field>
          </div>
          <h3>התראות</h3>
          <div className="form-row">
            <Field label="ימי התראה לפני פירעון צ'ק"><NumInput value={s.checkAlertDays} onChange={(checkAlertDays) => upd({ checkAlertDays })} /></Field>
            <Field label="ימי התראה לפני פקיעת חוזה"><NumInput value={s.contractAlertDays} onChange={(contractAlertDays) => upd({ contractAlertDays })} /></Field>
            <Field label="תזכורת גיבוי כל (ימים)"><NumInput value={s.backupReminderDays} onChange={(backupReminderDays) => upd({ backupReminderDays })} /></Field>
            <Field label="טווח ימים להתאמת בנק אוטומטית"><NumInput value={s.matchDays} onChange={(matchDays) => upd({ matchDays })} /></Field>
          </div>
          <div><button className="btn primary" onClick={save}><Icon name="check" />שמירה</button></div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="row between mb"><h3>סעיפי הוצאות</h3><button className="btn sm" onClick={addCat}><Icon name="plus" />סעיף</button></div>
        <div className="row" style={{ gap: 6 }}>
          {s.expenseCategories.map((c) => (
            <span key={c} className="badge" style={{ fontSize: 13, padding: '4px 10px' }}>
              {c}
              {!used.has(c) && <button className="icon-btn" style={{ padding: 0 }} onClick={() => upd({ expenseCategories: s.expenseCategories.filter((x) => x !== c) })}><Icon name="x" size={12} /></button>}
            </span>
          ))}
        </div>
        <div className="small muted mt">סעיפי הכנסה: גבייה שוטפת (דמי ועד) וגבייה מיוחדת – נקבעים לפי סוג התקבול. לחצו "שמירה" לאחר שינוי.</div>
      </div>
    </div>
  );
}

function PeriodsTab() {
  const d = useData();
  const years = Array.from(new Set([Number(todayISO().slice(0, 4)), ...d.payments.map((p) => Number(p.date.slice(0, 4))), ...d.expenses.map((e) => Number(e.date.slice(0, 4))), ...d.settings.lockedYears])).sort((a, b) => b - a);
  const toggle = async (y: number, locked: boolean) => {
    const ok = await confirmDialog(locked ? `פתיחת שנת ${y}` : `נעילת שנת ${y}`, locked ? 'פתיחת שנה נעולה מאפשרת שינוי נתונים היסטוריים. הפעולה תתועד ביומן.' : 'לאחר הנעילה לא ניתן יהיה להוסיף, לערוך או למחוק תנועות בשנה זו. מומלץ לנעול לאחר אישור המאזן השנתי באסיפת הדיירים.', { danger: locked, okLabel: locked ? 'פתיחה' : 'נעילה' });
    if (ok) attempt(() => setYearLock(y, !locked), locked ? 'השנה נפתחה' : 'השנה ננעלה');
  };
  return (
    <div className="card">
      <div className="card-head"><h2>נעילת שנות פעילות</h2></div>
      <table className="t">
        <tbody>
          {years.map((y) => {
            const locked = d.settings.lockedYears.includes(y);
            return (
              <tr key={y}>
                <td className="bold" style={{ fontSize: 16 }}>{y}</td>
                <td>{locked ? <span className="badge red"><Icon name="lock" size={12} /> נעולה</span> : <span className="badge green">פתוחה</span>}</td>
                <td><button className={'btn sm ' + (locked ? '' : 'primary')} onClick={() => toggle(y, locked)}><Icon name={locked ? 'unlock' : 'lock'} size={14} />{locked ? 'פתיחה' : 'נעילה'}</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BackupTab() {
  const d = useData();
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    getBackupFolder().then((h) => setFolder(h?.name || null));
  }, []);
  return (
    <div className="grid grid-2">
      <div className="card card-pad">
        <h3>גיבוי ידני</h3>
        <p className="muted">קובץ אחד הכולל את כל הנתונים, כולל החשבוניות והקבלות הסרוקות. שמרו אותו בענן (Google Drive / Dropbox) או שלחו לעצמכם במייל.</p>
        <div className="row">
          <button className="btn primary" onClick={() => downloadBackup().then(() => toast('קובץ הגיבוי ירד'))}><Icon name="download" />הורדת קובץ גיבוי</button>
        </div>
        <div className="small muted mt">גיבוי אחרון: {d.settings.lastBackupAt ? fmtDateTime(d.settings.lastBackupAt) : 'אף פעם'}</div>
        <div className="hr" />
        <h3>גיבוי יומי אוטומטי לתיקייה</h3>
        {folderBackupSupported ? (
          <>
            <p className="muted">בחרו תיקייה שמסונכרנת לענן (למשל Google Drive במחשב). בכל יום שבו המערכת נפתחת יישמר בה קובץ גיבוי.</p>
            {folder ? (
              <div className="row">
                <span className="badge green">תיקייה: {folder}</span>
                <button className="btn sm" onClick={() => autoBackup(true).then((r) => toast(r === 'done' ? 'הגיבוי נשמר בתיקייה' : r === 'needs-permission' ? 'נדרש אישור גישה לתיקייה' : 'הגיבוי נכשל', r === 'done' ? 'success' : 'error'))}>גבה עכשיו</button>
                <button className="btn sm danger" onClick={() => forgetBackupFolder().then(() => setFolder(null))}>הפסקה</button>
              </div>
            ) : (
              <button className="btn" onClick={() => chooseBackupFolder().then((n) => { setFolder(n); toast('הגיבוי האוטומטי הופעל'); }).catch((e) => e.name !== 'AbortError' && toast(e.message, 'error'))}><Icon name="file" />בחירת תיקיית גיבוי</button>
            )}
            <div className="small muted mt">אם הדפדפן יבקש אישור גישה לתיקייה – יוצג כפתור בלוח הבקרה.</div>
          </>
        ) : (
          <p className="muted">גיבוי אוטומטי לתיקייה זמין בדפדפני Chrome ו-Edge במחשב. בדפדפן זה השתמשו בהורדת קובץ גיבוי – תוצג תזכורת כל {d.settings.backupReminderDays} ימים.</p>
        )}
      </div>
      <div className="card card-pad">
        <h3>שחזור מגיבוי</h3>
        <p className="muted">השחזור מחליף את כל הנתונים הנוכחיים בנתונים מהקובץ.</p>
        <FileDrop accept=".json,application/json" onFiles={async ([f]) => {
          if (!(await confirmDialog('שחזור מגיבוי', `להחליף את כל הנתונים הנוכחיים בנתונים מהקובץ "${f.name}"? מומלץ להוריד גיבוי של המצב הנוכחי קודם.`, { danger: true, okLabel: 'שחזור' }))) return;
          try { await restoreBackup(f); toast('הנתונים שוחזרו בהצלחה'); } catch (e) { toast((e as Error).message, 'error'); }
        }}>
          <Icon name="upload" /> גררו קובץ גיבוי (.json) או לחצו לבחירה
        </FileDrop>
        <div className="hr" />
        <h3>מעבר למחשב אחר</h3>
        <p className="muted small">הנתונים נשמרים בדפדפן במחשב זה. כדי לעבוד ממחשב אחר: הורידו גיבוי כאן ושחזרו אותו שם. אל תעבדו בשני מחשבים במקביל – השחזור דורס את הנתונים.</p>
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = { create: 'הוספה', update: 'עריכה', delete: 'מחיקה', cancel: 'ביטול', lock: 'נעילה', unlock: 'פתיחה', import: 'ייבוא', restore: 'שחזור', settings: 'הגדרות' };

function AuditTab() {
  const d = useData();
  const [q, setQ] = useState('');
  const list = [...d.audit].reverse().filter((a) => !q || a.summary.includes(q) || a.user.includes(q));
  return (
    <div className="card">
      <div className="card-head">
        <input className="input" style={{ maxWidth: 300 }} placeholder="חיפוש ביומן…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn sm" onClick={() => exportExcel('יומן-פעולות', [{ name: 'יומן', rows: [['זמן', 'משתמש', 'פעולה', 'פירוט'], ...list.map((a) => [fmtDateTime(a.ts), a.user, ACTION_LABEL[a.action] || a.action, a.summary])] }])}><Icon name="download" />Excel</button>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>זמן</th><th>משתמש</th><th>פעולה</th><th>פירוט</th></tr></thead>
          <tbody>
            {list.slice(0, 500).map((a) => (
              <tr key={a.id}>
                <td className="num small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.ts)}</td>
                <td>{a.user}</td>
                <td><span className={'badge ' + (a.action === 'delete' || a.action === 'cancel' ? 'red' : a.action === 'create' ? 'green' : a.action === 'lock' || a.action === 'unlock' ? 'violet' : '')}>{ACTION_LABEL[a.action] || a.action}</span></td>
                <td>{a.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataTab() {
  const d = useData();
  const reset = async () => {
    const r = await promptDialog('איפוס המערכת', 'הקלידו "מחק הכול" לאישור', { text: 'כל הנתונים בדפדפן זה יימחקו לצמיתות, כולל קבצים מצורפים. מומלץ להוריד גיבוי קודם.', danger: true, okLabel: 'מחיקת כל הנתונים' });
    if (r !== 'מחק הכול') {
      if (r) toast('הטקסט לא תאם – לא בוצעה מחיקה', 'error');
      return;
    }
    await fileClear();
    await replaceData(emptyData());
    window.location.hash = '#/';
    toast('המערכת אופסה');
  };
  return (
    <div className="card card-pad">
      <dl className="kv">
        <dt>דירות</dt><dd>{d.units.length}</dd>
        <dt>תקבולים</dt><dd>{d.payments.length}</dd>
        <dt>הוצאות</dt><dd>{d.expenses.length}</dd>
        <dt>תנועות בנק מיובאות</dt><dd>{d.bankLines.length}</dd>
        <dt>קבצים מצורפים</dt><dd>{d.attachments.length}</dd>
        <dt>רשומות ביומן</dt><dd>{d.audit.length}</dd>
      </dl>
      <div className="hr" />
      <div className="row">
        {d.settings.demo ? (
          <button className="btn danger" onClick={reset}><Icon name="trash" />מחיקת נתוני הדוגמה והתחלה מחדש</button>
        ) : (
          <button className="btn danger" onClick={reset}><Icon name="trash" />איפוס המערכת (מחיקת כל הנתונים)</button>
        )}
        {!d.payments.length && !d.expenses.length && <button className="btn" onClick={loadDemoData}><Icon name="sparkle" />טעינת נתוני דוגמה</button>}
      </div>
    </div>
  );
}
