import type { AppData } from './types';
import { fileClear, fileGet, fileSet, kvDel, kvGet, kvSet } from './db';
import { getData, normalize, replaceData, update } from './store';
import { todayISO } from './format';

interface BackupFile {
  app: 'house-committee';
  createdAt: string;
  data: AppData;
  files: Record<string, { type: string; base64: string }>;
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

export async function buildBackup(): Promise<Blob> {
  const data = getData();
  const files: BackupFile['files'] = {};
  for (const a of data.attachments) {
    const b = await fileGet(a.id);
    if (b) files[a.id] = { type: a.type || b.type, base64: await blobToBase64(b) };
  }
  const payload: BackupFile = { app: 'house-committee', createdAt: new Date().toISOString(), data, files };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export function backupFileName() {
  return `vaad-backup-${todayISO()}.json`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function markBackedUp(where: string) {
  update(
    (d) => {
      d.settings.lastBackupAt = new Date().toISOString();
    },
    { action: 'settings', entity: 'backup', summary: `גיבוי נתונים (${where})` },
  );
}

export async function downloadBackup() {
  const blob = await buildBackup();
  downloadBlob(blob, backupFileName());
  markBackedUp('הורדת קובץ');
}

export async function restoreBackup(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text) as BackupFile;
  if (parsed.app !== 'house-committee' || !parsed.data) throw new Error('הקובץ אינו קובץ גיבוי של המערכת');
  await fileClear();
  for (const [id, f] of Object.entries(parsed.files || {})) await fileSet(id, base64ToBlob(f.base64, f.type));
  const data = normalize(parsed.data);
  data.audit.push({ id: 'r' + Date.now(), ts: new Date().toISOString(), user: data.settings.currentUser || 'גזבר', action: 'restore', entity: 'backup', summary: `שחזור מגיבוי מתאריך ${parsed.createdAt.slice(0, 10)}` });
  await replaceData(data);
}

// ===== Automatic backup to a folder (e.g. a Google Drive / Dropbox / iCloud synced folder) =====

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export const folderBackupSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function chooseBackupFolder(): Promise<string> {
  const handle = (await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'vaad-backup' })) as DirHandle;
  await kvSet('backupDir', handle);
  await writeBackupToFolder(handle);
  return handle.name;
}

export async function getBackupFolder(): Promise<DirHandle | undefined> {
  try {
    return await kvGet<DirHandle>('backupDir');
  } catch {
    return undefined;
  }
}

export async function forgetBackupFolder() {
  await kvDel('backupDir');
}

async function writeBackupToFolder(handle: DirHandle) {
  const blob = await buildBackup();
  const fh = await handle.getFileHandle(backupFileName(), { create: true });
  const w = await (fh as any).createWritable();
  await w.write(blob);
  await w.close();
  markBackedUp(`תיקייה "${handle.name}"`);
}

/**
 * Daily automatic backup. If permission is still granted it runs silently;
 * otherwise returns 'needs-permission' so the UI can ask the user with one click.
 */
export async function autoBackup(interactive = false): Promise<'done' | 'not-needed' | 'needs-permission' | 'no-folder' | 'error'> {
  const handle = await getBackupFolder();
  if (!handle) return 'no-folder';
  const last = getData().settings.lastBackupAt;
  if (!interactive && last && last.slice(0, 10) === todayISO()) return 'not-needed';
  try {
    let perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (perm !== 'granted' && interactive) perm = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
    if (perm !== 'granted') return 'needs-permission';
    await writeBackupToFolder(handle);
    return 'done';
  } catch (e) {
    console.error(e);
    return 'error';
  }
}
