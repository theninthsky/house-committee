import { useEffect, useState } from 'react';
import {
  backupToCloud,
  CloudError,
  connectProvider,
  disconnectProvider,
  listCloudBackups,
  PROVIDERS,
  providerLabel,
  restoreFromCloud,
  setAutoBackup,
  useCloud,
  type CloudFile,
  type ProviderId,
} from '../lib/cloud';
import { fmtDateTime } from '../lib/format';
import { confirmDialog, Empty, Icon, Modal, toast } from './ui';

function errText(e: unknown) {
  return e instanceof CloudError ? e.message : 'שגיאה: ' + ((e as Error)?.message || String(e));
}

function sizeText(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const LOGO: Record<ProviderId, JSX.Element> = {
  google: (
    <svg width="22" height="22" viewBox="0 0 87.3 78" aria-hidden="true">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" fill="#00ac47" />
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" />
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  ),
  onedrive: (
    <svg width="24" height="22" viewBox="0 0 24 16" aria-hidden="true">
      <path d="M9.6 4.1a6 6 0 0 1 10 2.9A4.5 4.5 0 0 1 19.5 16H6a5 5 0 0 1-1.2-9.9 5.5 5.5 0 0 1 4.8-2z" fill="#0f78d4" />
      <path d="M9.6 4.1A6 6 0 0 1 19.6 7l-6.1 3.7L6 16a5 5 0 0 1-1.2-9.9 5.5 5.5 0 0 1 4.8-2z" fill="#28a8ea" />
    </svg>
  ),
};

/** Settings → backup: connect / back up / restore for each configured provider */
export function CloudBackupPanel() {
  const cloud = useCloud();
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreFrom, setRestoreFrom] = useState<ProviderId | null>(null);
  const configured = PROVIDERS.filter((p) => p.configured);
  if (!configured.length) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card card-pad">
      <h3>גיבוי לענן</h3>
      <p className="muted">התחברו פעם אחת, והמערכת תשמור גיבוי בענן. ניתן לשחזר ממנו בכל מכשיר. נשמרים 30 הגיבויים האחרונים.</p>
      <div className="cloud-list">
        {configured.map((p) => {
          const s = cloud[p.id];
          return (
            <div key={p.id} className="cloud-row">
              <div className="cloud-logo">{LOGO[p.id]}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold">{p.label}</div>
                {s ? (
                  <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    מחובר: <span className="num">{s.account}</span>
                    {' · '}
                    {s.lastBackupAt ? `גיבוי אחרון ${fmtDateTime(s.lastBackupAt)}` : 'טרם בוצע גיבוי'}
                  </div>
                ) : (
                  <div className="small muted">לא מחובר</div>
                )}
              </div>
              {s ? (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn primary sm" disabled={!!busy} onClick={() => run(p.id + 'b', async () => { await backupToCloud(p.id); toast(`הגיבוי נשמר ב-${p.label}`); })}>
                    <Icon name="upload" size={14} />{busy === p.id + 'b' ? 'מגבה…' : 'גבה עכשיו'}
                  </button>
                  <button className="btn sm" disabled={!!busy} onClick={() => setRestoreFrom(p.id)}><Icon name="history" size={14} />שחזור</button>
                </div>
              ) : (
                <button className="btn primary sm" disabled={!!busy} onClick={() => run(p.id + 'c', async () => { const acc = await connectProvider(p.id); toast(`חובר ל-${p.label} (${acc})`); await backupToCloud(p.id); toast(`גיבוי ראשון נשמר ב-${p.label}`); })}>
                  {busy === p.id + 'c' ? 'מתחבר…' : `התחברות ל-${p.label}`}
                </button>
              )}
              {s && (
                <div className="cloud-sub">
                  <label className="check small" style={{ fontWeight: 500 }}>
                    <input type="checkbox" checked={s.auto} onChange={(e) => void setAutoBackup(p.id, e.target.checked)} />
                    גיבוי אוטומטי פעם ביום
                  </label>
                  <button className="btn sm ghost" disabled={!!busy} onClick={async () => { if (await confirmDialog(`ניתוק ${p.label}`, 'הגיבויים שכבר נשמרו בענן יישארו שם. ניתן להתחבר מחדש בכל עת.', { okLabel: 'ניתוק' })) run(p.id + 'd', () => disconnectProvider(p.id)); }}>ניתוק</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="small muted mt">
        {cloud.google && 'ב-Google Drive הגיבויים נשמרים בתיקייה "גיבויי ועד הבית". '}
        {cloud.onedrive && 'ב-OneDrive הגיבויים נשמרים בתיקייה Apps (יישומים). '}
        ב-Google Drive ייתכן שתתבקשו לאשר את ההתחברות בלחיצה אחת פעם ביום.
      </div>
      {restoreFrom && <CloudRestoreModal provider={restoreFrom} onClose={() => setRestoreFrom(null)} />}
    </div>
  );
}

/** List the backups in a provider and restore one */
export function CloudRestoreModal({ provider, onClose, onRestored }: { provider: ProviderId; onClose: () => void; onRestored?: () => void }) {
  const [files, setFiles] = useState<CloudFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    listCloudBackups(provider)
      .then(setFiles)
      .catch((e) => setError(errText(e)));
  }, [provider]);

  const restore = async (f: CloudFile) => {
    const ok = await confirmDialog('שחזור מגיבוי בענן', `להחליף את כל הנתונים במכשיר זה בגיבוי מ-${fmtDateTime(f.createdAt)}? שינויים שנעשו במכשיר זה אחרי מועד הגיבוי יימחקו.`, { danger: true, okLabel: 'שחזור' });
    if (!ok) return;
    setBusy(f.id);
    try {
      await restoreFromCloud(provider, f);
      toast('הנתונים שוחזרו מהענן');
      onRestored?.();
      onClose();
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`שחזור מ-${providerLabel(provider)}`} onClose={onClose}>
      {error && <div className="banner danger">{error}</div>}
      {!files && !error && <div className="muted">טוען את רשימת הגיבויים…</div>}
      {files && files.length === 0 && <Empty icon="☁️">אין עדיין גיבויים בחשבון זה</Empty>}
      {files && files.length > 0 && (
        <table className="t">
          <thead><tr><th>מועד הגיבוי</th><th>גודל</th><th /></tr></thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={f.id}>
                <td className="num">{fmtDateTime(f.createdAt)} {i === 0 && <span className="badge green">האחרון</span>}</td>
                <td className="small muted num">{sizeText(f.size)}</td>
                <td><button className={'btn sm ' + (i === 0 ? 'primary' : '')} disabled={!!busy} onClick={() => restore(f)}>{busy === f.id ? 'משחזר…' : 'שחזור'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/** Shown when a daily backup is due but the provider needs a click to sign in again */
export function CloudPendingBanner() {
  const cloud = useCloud();
  const [busy, setBusy] = useState(false);
  if (!cloud.pending.length) return null;
  const id = cloud.pending[0];
  return (
    <div className="banner warn no-print">
      <Icon name="upload" />
      <span className="grow">הגיבוי היומי ל-{providerLabel(id)} ממתין לאישור התחברות.</span>
      <button
        className="btn primary sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await backupToCloud(id, true);
            toast(`הגיבוי נשמר ב-${providerLabel(id)}`);
          } catch (e) {
            toast(errText(e), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'מגבה…' : 'גבה עכשיו'}
      </button>
    </div>
  );
}

/** Setup screen: start a new device from the latest cloud backup */
export function SetupCloudRestore() {
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const configured = PROVIDERS.filter((p) => p.configured);
  if (!configured.length) return null;
  const start = async (id: ProviderId) => {
    setBusy(id);
    try {
      await connectProvider(id);
      setProvider(id);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt">
      <div className="bold mb" style={{ marginBottom: 8 }}>כבר עובדים עם המערכת במכשיר אחר? שחזרו מהגיבוי בענן:</div>
      <div className="row">
        {configured.map((p) => (
          <button key={p.id} className="btn" disabled={!!busy} onClick={() => start(p.id)}>
            {LOGO[p.id]}{busy === p.id ? 'מתחבר…' : `שחזור מ-${p.label}`}
          </button>
        ))}
      </div>
      {provider && <CloudRestoreModal provider={provider} onClose={() => setProvider(null)} />}
    </div>
  );
}
