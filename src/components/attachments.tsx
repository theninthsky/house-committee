import { useEffect, useState } from 'react';
import { fileGet } from '../lib/db';
import { useData } from '../lib/store';
import { Icon, Modal, toast } from './ui';

export function AttachmentChips({ ids, onRemove }: { ids: string[]; onRemove?: (id: string) => void }) {
  const d = useData();
  const [view, setView] = useState<string | null>(null);
  if (!ids.length) return null;
  return (
    <span className="row" style={{ gap: 4 }}>
      {ids.map((id) => {
        const a = d.attachments.find((x) => x.id === id);
        return (
          <span key={id} className="attach-chip" title={a?.name} onClick={(e) => { e.stopPropagation(); setView(id); }}>
            <Icon name="clip" size={13} />
            {a?.name || 'קובץ'}
            {onRemove && (
              <button className="icon-btn" style={{ padding: 0 }} onClick={(e) => { e.stopPropagation(); onRemove(id); }} aria-label="הסר">
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        );
      })}
      {view && <AttachmentViewer id={view} onClose={() => setView(null)} />}
    </span>
  );
}

export function AttachmentViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useData();
  const a = d.attachments.find((x) => x.id === id);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    fileGet(id).then((b) => {
      if (!b) {
        toast('הקובץ לא נמצא', 'error');
        return;
      }
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  const isImg = (a?.type || '').startsWith('image/');
  return (
    <Modal title={a?.name || 'קובץ מצורף'} onClose={onClose} size="wide"
      footer={url && (
        <>
          <a className="btn primary" href={url} download={a?.name}><Icon name="download" />הורדה</a>
          <a className="btn" href={url} target="_blank" rel="noreferrer"><Icon name="eye" />פתיחה בחלון חדש</a>
        </>
      )}
    >
      {!url ? <div className="muted">טוען…</div> : isImg ? <img src={url} className="img-preview" alt={a?.name} /> : a?.type === 'application/pdf' ? <iframe src={url} title="pdf" style={{ width: '100%', height: '70vh', border: 0 }} /> : <div>לא ניתן להציג תצוגה מקדימה. ניתן להוריד את הקובץ.</div>}
    </Modal>
  );
}
