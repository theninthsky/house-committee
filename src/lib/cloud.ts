// Backups to Google Drive and OneDrive, entirely from the browser (no server).
// Each provider is enabled only when its OAuth client ID is configured at build time:
//   VITE_GOOGLE_CLIENT_ID – Google Cloud OAuth client (type "Web application")
//   VITE_MS_CLIENT_ID     – Microsoft Entra app registration (platform "Single-page application")
// Connection state is per device (stored in IndexedDB, not in the backed-up data).

import { useSyncExternalStore } from 'react';
import { kvGet, kvSet } from './db';
import { buildBackup, markBackedUp, restoreBackup } from './backup';
import { todayISO, toISO } from './format';

export type ProviderId = 'google' | 'onedrive';

export interface CloudFile {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

interface ProviderState {
  account: string;
  auto: boolean;
  lastBackupAt?: string;
  folderId?: string;
}

interface CloudState {
  google?: ProviderState;
  onedrive?: ProviderState;
  /** providers whose daily backup is due but need a click to sign in again */
  pending: ProviderId[];
}

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
export const MS_CLIENT_ID: string = import.meta.env.VITE_MS_CLIENT_ID || '';

export const PROVIDERS: { id: ProviderId; label: string; configured: boolean }[] = [
  { id: 'google', label: 'Google Drive', configured: !!GOOGLE_CLIENT_ID },
  { id: 'onedrive', label: 'OneDrive', configured: !!MS_CLIENT_ID },
];
export const anyCloudConfigured = PROVIDERS.some((p) => p.configured);
export const providerLabel = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!.label;

const KEEP_BACKUPS = 30;
const FOLDER_NAME = 'גיבויי ועד הבית';
const FILE_PREFIX = 'vaad-backup-';

// ===== Device-local state =====

let state: CloudState = { pending: [] };
const listeners = new Set<() => void>();
let loadedState = false;

async function ensureState() {
  if (loadedState) return;
  const saved = await kvGet<Omit<CloudState, 'pending'>>('cloud');
  state = { ...(saved || {}), pending: [] };
  loadedState = true;
  emit();
}

function emit() {
  listeners.forEach((l) => l());
}

async function setProvider(id: ProviderId, patch: Partial<ProviderState> | null) {
  const next = { ...state };
  if (patch === null) delete next[id];
  else next[id] = { ...(state[id] as ProviderState), ...patch };
  state = next;
  emit();
  const { pending: _p, ...persist } = state;
  void _p;
  await kvSet('cloud', persist);
}

function setPending(ids: ProviderId[]) {
  state = { ...state, pending: ids };
  emit();
}

export function useCloud(): CloudState {
  void ensureState();
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export class CloudError extends Error {}

// ===== Google Drive =====

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken: (o?: { prompt?: string; hint?: string }) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (r: GisTokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }) => GisTokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

const G_SCOPES = 'https://www.googleapis.com/auth/drive.file openid email';
let gisPromise: Promise<void> | null = null;
let gToken: { token: string; exp: number } | null = (() => {
  try {
    const raw = sessionStorage.getItem('g-token');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
})();

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new CloudError('לא ניתן לטעון את שירות ההתחברות של Google. בדקו את החיבור לאינטרנט.'));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

async function googleToken(interactive: boolean, forceConsent = false): Promise<string | null> {
  if (gToken && gToken.exp > Date.now() + 60_000) return gToken.token;
  if (!interactive) return null;
  await loadGis();
  const hint = state.google?.account;
  const resp = await new Promise<GisTokenResponse>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: G_SCOPES,
      hint,
      callback: resolve,
      error_callback: (e) => reject(new CloudError(e.type === 'popup_closed' ? 'חלון ההתחברות נסגר' : e.type === 'popup_failed_to_open' ? 'הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים לאתר זה.' : 'ההתחברות ל-Google נכשלה')),
    });
    client.requestAccessToken({ prompt: forceConsent || !hint ? 'consent' : '' });
  });
  if (!resp.access_token) throw new CloudError('ההתחברות ל-Google נכשלה: ' + (resp.error_description || resp.error || ''));
  gToken = { token: resp.access_token, exp: Date.now() + (resp.expires_in || 3600) * 1000 };
  try {
    sessionStorage.setItem('g-token', JSON.stringify(gToken));
  } catch {
    /* ignore */
  }
  return gToken.token;
}

async function gfetch(url: string, init: RequestInit = {}, interactive = true): Promise<Response> {
  const token = await googleToken(interactive);
  if (!token) throw new CloudError('נדרשת התחברות מחדש ל-Google Drive');
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    gToken = null;
    sessionStorage.removeItem('g-token');
    throw new CloudError('פג תוקף ההתחברות ל-Google Drive. התחברו מחדש.');
  }
  if (!res.ok) throw new CloudError(`שגיאה מ-Google Drive (${res.status})`);
  return res;
}

async function googleFolder(interactive: boolean): Promise<string> {
  const cached = state.google?.folderId;
  if (cached) return cached;
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await gfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, {}, interactive)).json();
  let id: string = found.files?.[0]?.id;
  if (!id) {
    const created = await (
      await gfetch(
        'https://www.googleapis.com/drive/v3/files?fields=id',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) },
        interactive,
      )
    ).json();
    id = created.id;
  }
  await setProvider('google', { folderId: id });
  return id;
}

const google = {
  async connect(): Promise<string> {
    await googleToken(true, true);
    const info = await (await gfetch('https://www.googleapis.com/oauth2/v3/userinfo')).json();
    return info.email || 'Google';
  },
  async disconnect() {
    const t = gToken?.token;
    gToken = null;
    sessionStorage.removeItem('g-token');
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t);
  },
  canSilent: () => !!(gToken && gToken.exp > Date.now() + 60_000),
  async upload(blob: Blob, name: string, interactive: boolean) {
    const folder = await googleFolder(interactive);
    const init = await gfetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json', 'X-Upload-Content-Length': String(blob.size) },
        body: JSON.stringify({ name, parents: [folder], mimeType: 'application/json' }),
      },
      interactive,
    );
    const location = init.headers.get('Location');
    if (!location) throw new CloudError('Google Drive לא החזיר כתובת העלאה');
    const put = await fetch(location, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/json' } });
    if (!put.ok) throw new CloudError(`ההעלאה ל-Google Drive נכשלה (${put.status})`);
  },
  async list(interactive = true): Promise<CloudFile[]> {
    const folder = await googleFolder(interactive);
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
    const res = await (await gfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=files(id,name,size,createdTime)&spaces=drive`, {}, interactive)).json();
    return (res.files || []).map((f: { id: string; name: string; size?: string; createdTime: string }) => ({ id: f.id, name: f.name, size: Number(f.size || 0), createdAt: f.createdTime }));
  },
  async download(id: string): Promise<Blob> {
    return (await gfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).blob();
  },
  async remove(id: string, interactive = true) {
    await gfetch(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }, interactive);
  },
};

// ===== OneDrive (Microsoft Graph) =====

const MS_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];
type Msal = import('@azure/msal-browser').PublicClientApplication;
let msalPromise: Promise<Msal> | null = null;

function getMsal(): Promise<Msal> {
  if (!msalPromise) {
    msalPromise = (async () => {
      const { PublicClientApplication } = await import('@azure/msal-browser');
      const pca = new PublicClientApplication({
        auth: {
          clientId: MS_CLIENT_ID,
          authority: 'https://login.microsoftonline.com/common',
          // blank page – the popup lands here and is closed by MSAL
          redirectUri: new URL('auth-redirect.html', window.location.href).href,
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await pca.initialize();
      return pca;
    })();
  }
  return msalPromise;
}

async function msToken(interactive: boolean): Promise<string | null> {
  const pca = await getMsal();
  const { InteractionRequiredAuthError, BrowserAuthError } = await import('@azure/msal-browser');
  const account = pca.getAllAccounts()[0];
  if (account) {
    try {
      return (await pca.acquireTokenSilent({ scopes: MS_SCOPES, account })).accessToken;
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError) && !(e instanceof BrowserAuthError)) throw e;
    }
  }
  if (!interactive) return null;
  try {
    const r = account
      ? await pca.acquireTokenPopup({ scopes: MS_SCOPES, account })
      : await pca.loginPopup({ scopes: MS_SCOPES, prompt: 'select_account' });
    return r.accessToken;
  } catch (e) {
    const code = (e as { errorCode?: string }).errorCode;
    if (code === 'user_cancelled') throw new CloudError('חלון ההתחברות נסגר');
    if (code === 'popup_window_error') throw new CloudError('הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים לאתר זה.');
    throw new CloudError('ההתחברות ל-Microsoft נכשלה: ' + ((e as Error).message || ''));
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function msfetch(url: string, init: RequestInit = {}, interactive = true): Promise<Response> {
  const token = await msToken(interactive);
  if (!token) throw new CloudError('נדרשת התחברות מחדש ל-OneDrive');
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new CloudError(`שגיאה מ-OneDrive (${res.status})`);
  return res;
}

const onedrive = {
  async connect(): Promise<string> {
    await msToken(true);
    const pca = await getMsal();
    return pca.getAllAccounts()[0]?.username || 'OneDrive';
  },
  async disconnect() {
    const pca = await getMsal();
    const account = pca.getAllAccounts()[0];
    await pca.clearCache(account ? { account } : undefined);
  },
  async upload(blob: Blob, name: string, interactive: boolean) {
    const path = `${GRAPH}/me/drive/special/approot:/${encodeURIComponent(name)}:`;
    if (blob.size <= 4 * 1024 * 1024) {
      await msfetch(`${path}/content`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/json' } }, interactive);
      return;
    }
    // large backups (many scanned invoices): upload session in 5 MiB chunks (multiple of 320 KiB)
    const session = await (
      await msfetch(`${path}/createUploadSession`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) }, interactive)
    ).json();
    const CHUNK = 5 * 1024 * 1024;
    for (let start = 0; start < blob.size; start += CHUNK) {
      const end = Math.min(start + CHUNK, blob.size);
      const res = await fetch(session.uploadUrl, { method: 'PUT', body: blob.slice(start, end), headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` } });
      if (!res.ok) throw new CloudError(`ההעלאה ל-OneDrive נכשלה (${res.status})`);
    }
  },
  async list(interactive = true): Promise<CloudFile[]> {
    const res = await (await msfetch(`${GRAPH}/me/drive/special/approot/children?$select=id,name,size,createdDateTime&$top=200`, {}, interactive)).json();
    return (res.value || [])
      .map((f: { id: string; name: string; size: number; createdDateTime: string }) => ({ id: f.id, name: f.name, size: f.size, createdAt: f.createdDateTime }))
      .sort((a: CloudFile, b: CloudFile) => b.createdAt.localeCompare(a.createdAt));
  },
  async download(id: string): Promise<Blob> {
    const meta = await (await msfetch(`${GRAPH}/me/drive/items/${id}?$select=id,@microsoft.graph.downloadUrl`)).json();
    const url = meta['@microsoft.graph.downloadUrl'];
    if (!url) throw new CloudError('לא ניתן להוריד את הקובץ מ-OneDrive');
    const res = await fetch(url);
    if (!res.ok) throw new CloudError(`ההורדה מ-OneDrive נכשלה (${res.status})`);
    return res.blob();
  },
  async remove(id: string, interactive = true) {
    await msfetch(`${GRAPH}/me/drive/items/${id}`, { method: 'DELETE' }, interactive);
  },
};

const impl = { google, onedrive };

// ===== Public API =====

export async function connectProvider(id: ProviderId) {
  await ensureState();
  const account = await impl[id].connect();
  await setProvider(id, { account, auto: state[id]?.auto ?? true, folderId: id === 'google' && state.google?.account !== account ? undefined : state[id]?.folderId });
  return account;
}

export async function disconnectProvider(id: ProviderId) {
  try {
    await impl[id].disconnect();
  } finally {
    await setProvider(id, null);
    setPending(state.pending.filter((p) => p !== id));
  }
}

export async function setAutoBackup(id: ProviderId, auto: boolean) {
  await setProvider(id, { auto });
}

function cloudFileName() {
  const d = new Date();
  return `${FILE_PREFIX}${toISO(d)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.json`;
}

/** Upload a backup now. With interactive=false it fails (returns false) instead of opening a sign-in popup. */
export async function backupToCloud(id: ProviderId, interactive = true): Promise<boolean> {
  await ensureState();
  if (!interactive) {
    const silentOk = id === 'google' ? google.canSilent() : !!(await msToken(false).catch(() => null));
    if (!silentOk) return false;
  }
  const blob = await buildBackup();
  await impl[id].upload(blob, cloudFileName(), interactive);
  await setProvider(id, { lastBackupAt: new Date().toISOString() });
  setPending(state.pending.filter((p) => p !== id));
  markBackedUp(providerLabel(id));
  // keep the newest backups only
  try {
    const files = (await impl[id].list(interactive)).filter((f) => f.name.startsWith(FILE_PREFIX));
    for (const f of files.slice(KEEP_BACKUPS)) await impl[id].remove(f.id, interactive);
  } catch (e) {
    console.warn('pruning old backups failed', e);
  }
  return true;
}

export async function listCloudBackups(id: ProviderId): Promise<CloudFile[]> {
  return (await impl[id].list(true)).filter((f) => f.name.startsWith(FILE_PREFIX) && f.name.endsWith('.json'));
}

export async function restoreFromCloud(id: ProviderId, file: CloudFile) {
  const blob = await impl[id].download(file.id);
  await restoreBackup(new File([blob], file.name, { type: 'application/json' }));
}

/**
 * Daily automatic backup for connected providers. Runs silently when a valid sign-in exists;
 * otherwise marks the provider as pending so the UI can offer a one-click backup.
 */
export async function runDailyCloudBackup(): Promise<ProviderId[]> {
  await ensureState();
  const done: ProviderId[] = [];
  const pending: ProviderId[] = [];
  for (const p of PROVIDERS) {
    const s = state[p.id];
    if (!p.configured || !s || !s.auto) continue;
    if (s.lastBackupAt && toISO(new Date(s.lastBackupAt)) === todayISO()) continue;
    try {
      if (await backupToCloud(p.id, false)) done.push(p.id);
      else pending.push(p.id);
    } catch (e) {
      console.warn('automatic cloud backup failed', e);
      pending.push(p.id);
    }
  }
  setPending(pending);
  return done;
}
