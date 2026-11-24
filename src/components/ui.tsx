import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { money } from '../lib/format';
import { LockedError, ValidationError } from '../lib/store';

// ===== Router (hash based – works on any static host) =====

const routeListeners = new Set<() => void>();
window.addEventListener('hashchange', () => routeListeners.forEach((l) => l()));

export function useRoute(): string[] {
  const hash = useSyncExternalStore(
    (l) => {
      routeListeners.add(l);
      return () => routeListeners.delete(l);
    },
    () => window.location.hash,
  );
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  return path ? path.split('/').map(decodeURIComponent) : [];
}

export function useQuery(): URLSearchParams {
  useRoute();
  const q = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(q);
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('#') ? path : '#' + path;
}

// ===== Toasts =====

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastId = 0;

export function toast(text: string, kind: Toast['kind'] = 'success') {
  const t = { id: ++toastId, text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, kind === 'error' ? 6000 : 3200);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Run an action; show friendly errors. Returns true on success. */
export function attempt(fn: () => void, okMsg?: string): boolean {
  try {
    fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    if (e instanceof LockedError || e instanceof ValidationError) toast(e.message, 'error');
    else {
      console.error(e);
      toast('שגיאה: ' + (e as Error).message, 'error');
    }
    return false;
  }
}

// ===== Confirm / prompt dialogs =====

type DialogReq = { title: string; text?: ReactNode; okLabel?: string; danger?: boolean; input?: { label: string; value?: string }; resolve: (v: string | false) => void };
let dialog: DialogReq | null = null;
const dialogListeners = new Set<() => void>();
const setDialog = (d: DialogReq | null) => {
  dialog = d;
  dialogListeners.forEach((l) => l());
};

export function confirmDialog(title: string, text?: ReactNode, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => setDialog({ title, text, ...opts, resolve: (v) => resolve(v !== false) }));
}

export function promptDialog(title: string, label: string, opts: { text?: ReactNode; okLabel?: string; danger?: boolean; value?: string } = {}): Promise<string | false> {
  return new Promise((resolve) => setDialog({ title, text: opts.text, okLabel: opts.okLabel, danger: opts.danger, input: { label, value: opts.value }, resolve }));
}

export function DialogHost() {
  const d = useSyncExternalStore(
    (l) => {
      dialogListeners.add(l);
      return () => dialogListeners.delete(l);
    },
    () => dialog,
  );
  const [val, setVal] = useState('');
  useEffect(() => {
    setVal(d?.input?.value || '');
  }, [d]);
  if (!d) return null;
  const close = (v: string | false) => {
    setDialog(null);
    d.resolve(v);
  };
  return (
    <Modal title={d.title} onClose={() => close(false)} size="narrow"
      footer={
        <>
          <button className={'btn ' + (d.danger ? 'danger' : 'primary')} disabled={!!d.input && !val.trim()} onClick={() => close(d.input ? val : 'ok')}>
            {d.okLabel || 'אישור'}
          </button>
          <button className="btn" onClick={() => close(false)}>ביטול</button>
        </>
      }
    >
      {d.text && <div style={{ marginBottom: d.input ? 12 : 0 }}>{d.text}</div>}
      {d.input && (
        <Field label={d.input.label}>
          <input className="input" autoFocus value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && val.trim() && close(val)} />
        </Field>
      )}
    </Modal>
  );
}

// ===== Modal =====

export function Modal(props: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'narrow' | 'wide'; printKeep?: boolean }) {
  const { onClose } = props;
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const downOnBack = useRef(false);
  return (
    <div
      className={'modal-back' + (props.printKeep ? ' print-keep' : '')}
      onMouseDown={(e) => (downOnBack.current = e.target === e.currentTarget)}
      onMouseUp={(e) => downOnBack.current && e.target === e.currentTarget && onClose()}
    >
      <div className={'modal ' + (props.size || '')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

// ===== Form bits =====

export function Field(props: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={'field ' + (props.className || '')}>
      <label>{props.label}</label>
      {props.children}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  );
}

export function NumInput(props: { value: number | undefined; onChange: (n: number) => void; placeholder?: string; autoFocus?: boolean; min?: number; step?: number }) {
  const [text, setText] = useState(props.value === undefined || props.value === 0 ? '' : String(props.value));
  const last = useRef(props.value);
  useEffect(() => {
    if (props.value !== last.current) {
      setText(props.value === undefined || props.value === 0 ? '' : String(props.value));
      last.current = props.value;
    }
  }, [props.value]);
  return (
    <input
      className="input"
      type="text"
      inputMode="decimal"
      dir="ltr"
      style={{ textAlign: 'right' }}
      autoFocus={props.autoFocus}
      placeholder={props.placeholder ?? '0'}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.-]/g, '');
        setText(t);
        const n = parseFloat(t);
        last.current = isNaN(n) ? 0 : n;
        props.onChange(isNaN(n) ? 0 : n);
      }}
    />
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button type="button" key={o.value} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Money({ v, colored, decimals }: { v: number; colored?: boolean; decimals?: boolean }) {
  const cls = colored ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : '';
  return <span className={'num ' + cls}>{money(v, decimals)}</span>;
}

export function Empty({ icon = '📭', children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      {children}
    </div>
  );
}

export function PageHead(props: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub && <div className="sub">{props.sub}</div>}
      </div>
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}

// ===== Icons (inline, stroke based) =====

const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  receipt: 'M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2-3 2zM8 8h8M8 12h8M8 16h5',
  truck: 'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  cart: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM20 17v5H6.5A2.5 2.5 0 0 1 4 19.5',
  wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z',
  bank: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3',
  chart: 'M3 3v18h18M7 16v-5M12 16V8M17 16v-8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  check: 'M20 6 9 17l-5-5',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  unlink: 'M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 1 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-1',
  menu: 'M3 6h18M3 12h18M3 18h18',
  clip: 'M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  history: 'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8M12 7v5l4 2',
  ban: 'M4.93 4.93l14.14 14.14M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  arrows: 'M7 16V4M7 4 3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4',
  whatsapp: 'M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  sparkle: 'M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z',
};

export function Icon({ name, className, size }: { name: keyof typeof PATHS | string; className?: string; size?: number }) {
  return (
    <svg className={className || 'ico'} width={size || 18} height={size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || ''} />
    </svg>
  );
}

// ===== File drop =====

export function FileDrop(props: { onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={'dropzone' + (over ? ' over' : '')}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) props.onFiles(files);
      }}
    >
      <input
        ref={ref}
        type="file"
        hidden
        accept={props.accept}
        multiple={props.multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) props.onFiles(files);
        }}
      />
      {props.children || 'גררו קובץ לכאן או לחצו לבחירה'}
    </div>
  );
}
