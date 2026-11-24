import { useMemo, useState } from 'react';
import { useData } from '../lib/store';
import { createSpecialCharge } from '../lib/actions';
import { collectionMatrix, sortUnits, unitAccount, unitFull, type CellStatus } from '../lib/calc';
import { currentMonth, fmtDate, HEB_MONTHS, money, round2, todayISO } from '../lib/format';
import { exportExcel } from '../lib/excel';
import { attempt, Field, Icon, Modal, Money, navigate, NumInput, PageHead, Seg } from '../components/ui';
import { openForm } from '../components/forms';

const STATUS_LABEL: Record<CellStatus, string> = { paid: 'שולם', partial: 'שולם חלקית', overdue: 'פיגור', due: 'לתשלום', credit: 'זכות', none: '' };

export function CollectionPage() {
  const d = useData();
  const thisYear = Number(currentMonth().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [special, setSpecial] = useState(false);
  const matrix = useMemo(() => collectionMatrix(d, year), [d, year]);
  const years = Array.from(new Set([thisYear, thisYear - 1, thisYear - 2, ...d.charges.map((c) => Number(c.month.slice(0, 4)))])).sort((a, b) => b - a);

  const colTotals = Array.from({ length: 12 }, (_, i) => {
    let due = 0, paid = 0;
    for (const r of matrix) {
      const c = r.cells[i];
      if (c.status === 'credit' || c.status === 'none') continue;
      due += c.due;
      paid += c.paid;
    }
    return { due: round2(due), paid: round2(paid) };
  });

  // special charge groups
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; description: string; date: string; total: number; units: number; paidUnits: number; open: number }>();
    for (const c of d.charges.filter((x) => x.kind === 'special' && x.groupId)) {
      const g = map.get(c.groupId!) || { id: c.groupId!, description: c.description, date: c.date, total: 0, units: 0, paidUnits: 0, open: 0 };
      g.total += c.amount;
      g.units += 1;
      map.set(c.groupId!, g);
    }
    for (const u of d.units) {
      const acc = unitAccount(d, u, '9999-12');
      for (const a of acc.charges) {
        if (a.charge.kind !== 'special' || !a.charge.groupId) continue;
        const g = map.get(a.charge.groupId)!;
        if (a.remaining <= 0) g.paidUnits++;
        g.open = round2(g.open + a.remaining);
      }
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [d]);

  const exportXlsx = () => {
    exportExcel(`מטריצת-גבייה-${year}`, [
      {
        name: String(year),
        rows: [
          ['דירה', 'שם', ...HEB_MONTHS, 'יתרה נוכחית'],
          ...matrix.map((r) => [r.unit.aptNumber, unitFull(r.unit), ...r.cells.map((c) => (c.status === 'none' ? '' : `${STATUS_LABEL[c.status]} ${c.paid}/${c.due}`)), r.balance]),
        ],
      },
    ]);
  };

  return (
    <>
      <div className="print-only print-head"><h2>{d.settings.buildingName} – מטריצת גבייה {year}</h2></div>
      <PageHead
        title="מטריצת גבייה"
        sub="מצב התשלומים של כל הדירות לאורך השנה. לחיצה על משבצת פותחת קליטת תשלום."
        actions={
          <>
            <button className="btn primary" onClick={() => setSpecial(true)}><Icon name="plus" />חיוב מיוחד לכל הבניין</button>
            <button className="btn" onClick={() => window.print()}><Icon name="print" />הדפסה</button>
            <button className="btn" onClick={exportXlsx}><Icon name="download" />Excel</button>
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <Seg value={String(year)} onChange={(y) => setYear(Number(y))} options={years.slice(0, 5).map((y) => ({ value: String(y), label: String(y) }))} />
          <div className="legend">
            <span><i className="cell paid" style={{ height: 14, minWidth: 14 }} />שולם</span>
            <span><i className="cell partial" style={{ height: 14, minWidth: 14 }} />שולם חלקית</span>
            <span><i className="cell overdue" style={{ height: 14, minWidth: 14 }} />פיגור</span>
            <span><i className="cell due" style={{ height: 14, minWidth: 14 }} />החודש – טרם שולם</span>
            <span><i className="cell credit" style={{ height: 14, minWidth: 14 }} />זכות (שולם מראש)</span>
          </div>
        </div>
        <div className="table-wrap card-pad">
          <table className="matrix">
            <thead>
              <tr>
                <th className="unit">דירה</th>
                {HEB_MONTHS.map((m) => <th key={m}>{m}</th>)}
                <th>יתרה</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.unit.id}>
                  <td className="unit clickable" onClick={() => navigate('/units/' + r.unit.id)}>
                    {r.unit.aptNumber} <span className="n">{(r.unit.payer === 'tenant' && r.unit.tenantName) || r.unit.ownerName}</span>
                  </td>
                  {r.cells.map((c, i) => (
                    <td key={i}>
                      <div
                        className={'cell ' + c.status}
                        title={c.status === 'none' ? '' : `${STATUS_LABEL[c.status]} · שולם ${money(c.paid)} מתוך ${money(c.due)}`}
                        onClick={() => c.status !== 'none' && c.status !== 'paid' && c.status !== 'credit' ? openForm({ kind: 'payment', unitId: r.unit.id }) : c.status !== 'none' && navigate('/units/' + r.unit.id)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {c.status === 'paid' ? '✓' : c.status === 'credit' ? 'זכות' : c.status === 'partial' ? <span className="num">{Math.round(c.paid)}</span> : c.status === 'overdue' || c.status === 'due' ? <span className="num">{Math.round(c.due)}</span> : '—'}
                      </div>
                    </td>
                  ))}
                  <td className={'bold ' + (r.balance > 0 ? 'neg' : r.balance < 0 ? 'pos' : 'muted')} style={{ whiteSpace: 'nowrap', paddingInlineStart: 8 }}><Money v={r.balance} /></td>
                </tr>
              ))}
              <tr>
                <td className="unit muted">נגבה / לגבייה</td>
                {colTotals.map((t, i) => (
                  <td key={i} className="small" style={{ textAlign: 'center' }}>
                    {t.due ? <><div className="bold num">{Math.round((t.paid / t.due) * 100)}%</div><div className="muted num">{Math.round(t.paid)}</div></> : ''}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>חיובים מיוחדים</h2></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>תאריך</th><th>תיאור</th><th>דירות</th><th>שילמו במלואו</th><th className="amt">סה"כ חויב</th><th className="amt">יתרה לגבייה</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="num">{fmtDate(g.date)}</td>
                  <td className="bold">{g.description}</td>
                  <td>{g.units}</td>
                  <td>{g.paidUnits} / {g.units}</td>
                  <td className="amt"><Money v={g.total} /></td>
                  <td className={'amt bold ' + (g.open > 0 ? 'neg' : 'pos')}><Money v={g.open} /></td>
                </tr>
              ))}
              {groups.length === 0 && <tr><td colSpan={6} className="muted">אין חיובים מיוחדים. לדוגמה: גבייה חד-פעמית לשיפוץ גג או צביעת חדר מדרגות.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {special && <SpecialChargeForm onClose={() => setSpecial(false)} />}
    </>
  );
}

function SpecialChargeForm({ onClose }: { onClose: () => void }) {
  const d = useData();
  const units = sortUnits(d.units).filter((u) => !u.moveOut || u.moveOut >= todayISO());
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<'per' | 'total'>('per');
  const [amount, setAmount] = useState(0);
  const [selected, setSelected] = useState<string[]>(units.map((u) => u.id));
  const [custom, setCustom] = useState<Record<string, number>>({});
  const per = mode === 'per' ? amount : selected.length ? round2(amount / selected.length) : 0;
  const amounts = Object.fromEntries(selected.map((id) => [id, custom[id] ?? per]));
  const total = round2(selected.reduce((s, id) => s + (amounts[id] || 0), 0));
  const save = () => attempt(() => createSpecialCharge({ unitIds: selected, amounts, date, description: desc }), 'החיוב המיוחד נוצר') && onClose();
  return (
    <Modal title="חיוב מיוחד (גבייה חד-פעמית)" onClose={onClose} size="wide"
      footer={<><button className="btn primary" onClick={save}><Icon name="check" />יצירת חיוב ל-{selected.length} דירות ({money(total)})</button><button className="btn" onClick={onClose}>ביטול</button></>}
    >
      <div className="form">
        <div className="form-row">
          <Field label="תיאור"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="למשל: שיפוץ גג / צביעת חדר מדרגות" autoFocus /></Field>
          <Field label="תאריך חיוב"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="אופן חישוב"><Seg value={mode} onChange={(m) => { setMode(m); setCustom({}); }} options={[{ value: 'per', label: 'סכום לכל דירה' }, { value: 'total', label: 'סכום כולל – חלוקה שווה' }]} /></Field>
          <Field label={mode === 'per' ? 'סכום לדירה (₪)' : 'סכום כולל (₪)'}><NumInput value={amount} onChange={(v) => { setAmount(v); setCustom({}); }} /></Field>
        </div>
        <table className="t">
          <thead><tr><th style={{ width: 40 }}><input type="checkbox" checked={selected.length === units.length} onChange={(e) => setSelected(e.target.checked ? units.map((u) => u.id) : [])} /></th><th>דירה</th><th>סכום (ניתן לשנות לדירה בודדת)</th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td><input type="checkbox" checked={selected.includes(u.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} /></td>
                <td>{unitFull(u)}</td>
                <td style={{ maxWidth: 160 }}>{selected.includes(u.id) && <NumInput value={amounts[u.id]} onChange={(v) => setCustom({ ...custom, [u.id]: v })} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
