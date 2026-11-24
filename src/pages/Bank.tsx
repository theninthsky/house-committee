import { useEffect, useMemo, useState } from 'react';
import type { BankLine, LedgerRow } from '../lib/types';
import { getData, useData } from '../lib/store';
import { applyAutoMatches, defaultExpense, deleteBankBatch, importBankLines, matchBankLine, saveExpense, saveReconciliation, setBankLineIgnored, unmatchBankLine } from '../lib/actions';
import { bankBookRows, detectColumns, entityKey, gridToLines, guessKind, lineKey, proposeMatches, readSheet, type ColumnMap, type Grid } from '../lib/bank';
import { accountBalance } from '../lib/calc';
import { daysBetween, fmtDate, money, parseAmount, round2, todayISO, uid } from '../lib/format';
import { buildDemoStatementCsv } from '../lib/demo';
import { downloadBlob } from '../lib/backup';
import { attempt, confirmDialog, Empty, Field, FileDrop, Icon, Modal, Money, NumInput, PageHead, Seg, toast, useQuery } from '../components/ui';
import { openForm } from '../components/forms';

export function BankPage() {
  const d = useData();
  const query = useQuery();
  const [importing, setImporting] = useState<{ file: File; grid: Grid } | null>(null);
  const [showImport, setShowImport] = useState(query.get('import') === '1' || d.bankLines.length === 0);
  const batches = [...d.bankBatches].sort((a, b) => b.toDate.localeCompare(a.toDate));
  const [batchId, setBatchId] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'open' | 'matched'>('open');
  const [picker, setPicker] = useState<BankLine | null>(null);

  useEffect(() => {
    if (!batchId && batches[0]) setBatchId(batches[0].id);
  }, [batches.length]);

  const batch = d.bankBatches.find((b) => b.id === batchId);
  const lines = d.bankLines.filter((l) => l.batchId === batchId).sort((a, b) => a.date.localeCompare(b.date));
  const shown = lines.filter((l) => (filter === 'open' ? !l.matchedTo && !l.ignored : filter === 'matched' ? !!l.matchedTo : true));
  const endDate = batch?.toDate || todayISO();
  const book = useMemo(() => bankBookRows(d), [d]);
  const bookByKey = useMemo(() => new Map(book.map((r) => [entityKey(r), r])), [book]);
  // Items considered "open": from the last approved reconciliation (or a week before this statement starts) until its end
  const prevRec = [...d.reconciliations].filter((r) => !batch || r.date < batch.toDate).sort((a, b) => b.date.localeCompare(a.date))[0];
  const windowStart = prevRec ? addDaysIso(prevRec.date, 1) : batch ? addDaysIso(batch.fromDate, -7) : '0000';
  const outstanding = book.filter((r) => !r.bankLineId && r.valueDate <= endDate && r.valueDate >= windowStart);
  const unmatchedLines = lines.filter((l) => !l.matchedTo && !l.ignored);
  const matchedCount = lines.filter((l) => l.matchedTo).length;

  const bookBalance = accountBalance(d, 'bank', endDate);
  const [manualStmt, setManualStmt] = useState<number | undefined>(undefined);
  const stmtBalance = batch?.closingBalance ?? manualStmt;
  const outstandingSum = round2(outstanding.reduce((s, r) => s + r.amount, 0));
  const bankOnlySum = round2(unmatchedLines.reduce((s, l) => s + l.amount, 0));
  const adjusted = stmtBalance === undefined ? undefined : round2(stmtBalance + outstandingSum - bankOnlySum);
  const diff = adjusted === undefined ? undefined : round2(bookBalance - adjusted);

  const onFile = async (files: File[]) => {
    try {
      const grid = await readSheet(files[0]);
      if (!grid.length) throw new Error('הקובץ ריק');
      setImporting({ file: files[0], grid });
    } catch (e) {
      toast('לא ניתן לקרוא את הקובץ: ' + (e as Error).message, 'error');
    }
  };

  const autoMatch = (silent = false) => {
    const pairs = proposeMatches(getData());
    applyAutoMatches(pairs);
    if (!silent || pairs.length) toast(pairs.length ? `הותאמו אוטומטית ${pairs.length} תנועות` : 'לא נמצאו התאמות אוטומטיות נוספות', pairs.length ? 'success' : 'info');
  };

  const recordFee = (l: BankLine) => {
    const e = defaultExpense({ date: l.date, valueDate: l.date, amount: Math.abs(l.amount), category: 'עמלות בנק', description: l.description || 'עמלת בנק', payee: 'הבנק', method: 'standing_order', reference: l.reference });
    if (attempt(() => saveExpense(e))) {
      matchBankLine(l.id, 'expense:' + e.id, { silent: true });
      toast('נרשמה הוצאת עמלה והותאמה');
    }
  };

  const recordOther = (l: BankLine) => {
    if (l.amount > 0) {
      openForm({ kind: 'payment', prefill: { amount: l.amount, date: l.date, valueDate: l.date, reference: l.reference, method: 'transfer', account: 'bank' }, onSaved: (p) => matchBankLine(l.id, 'payment:' + p.id) });
    } else {
      openForm({ kind: 'expense', prefill: defaultExpense({ amount: -l.amount, date: l.date, valueDate: l.date, description: l.description, reference: l.reference }), onSaved: (e) => matchBankLine(l.id, 'expense:' + e.id) });
    }
  };

  const recordDeposit = (l: BankLine) =>
    openForm({ kind: 'transfer', prefill: { from: l.amount > 0 ? 'cash' : 'bank', to: l.amount > 0 ? 'bank' : 'cash', amount: Math.abs(l.amount), date: l.date, description: l.description, reference: l.reference }, onSaved: (t) => matchBankLine(l.id, 'transfer:' + t.id) });

  const approve = () => {
    if (stmtBalance === undefined) return;
    attempt(() => saveReconciliation(endDate, stmtBalance, bookBalance), 'ההתאמה אושרה ונשמרה');
  };

  return (
    <>
      <PageHead
        title="התאמות בנק"
        sub="ייבוא דף בנק והשוואה לתנועות הרשומות במערכת"
        actions={
          <>
            <button className="btn primary" onClick={() => setShowImport(!showImport)}><Icon name="upload" />ייבוא דף בנק</button>
            {lines.length > 0 && <button className="btn" onClick={() => autoMatch()}><Icon name="link" />התאמה אוטומטית</button>}
          </>
        }
      />

      {(showImport || batches.length === 0) && (
        <div className="card card-pad mb">
          <FileDrop accept=".csv,.xlsx,.xls,.txt" onFiles={onFile}>
            <div style={{ fontSize: 16, fontWeight: 700 }}><Icon name="upload" /> גררו לכאן קובץ Excel או CSV שהורדתם מאתר הבנק</div>
            <div className="small" style={{ marginTop: 4 }}>המערכת תזהה את העמודות (תאריך, תיאור, אסמכתא, חובה, זכות, יתרה) – ותאפשר לתקן לפני הייבוא</div>
          </FileDrop>
          {d.settings.demo && (
            <div className="row mt">
              <button className="btn sm" onClick={() => downloadBlob(new Blob([buildDemoStatementCsv()], { type: 'text/csv' }), 'דף-בנק-לדוגמה.csv')}><Icon name="download" />הורדת דף בנק לדוגמה (לנתוני הדוגמה)</button>
            </div>
          )}
        </div>
      )}

      {batches.length === 0 ? (
        <div className="card"><Empty icon="🏦">עדיין לא יובאו דפי בנק</Empty></div>
      ) : (
        <>
          <div className="card mb">
            <div className="card-head">
              <div className="row">
                <Field label="דף בנק">
                  <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                    {batches.map((b) => <option key={b.id} value={b.id}>{fmtDate(b.fromDate)} – {fmtDate(b.toDate)} · {b.fileName}</option>)}
                  </select>
                </Field>
                {batch && <button className="btn sm danger" style={{ alignSelf: 'flex-end' }} onClick={async () => { if (await confirmDialog('מחיקת דף בנק', 'למחוק את דף הבנק וכל ההתאמות שלו? התנועות במערכת לא יימחקו.', { danger: true, okLabel: 'מחיקה' })) attempt(() => { deleteBankBatch(batch.id); setBatchId(''); }, 'דף הבנק נמחק'); }}><Icon name="trash" /></button>}
              </div>
              <div className="row">
                <span className="badge green">✓ {matchedCount} מותאמות</span>
                <span className="badge amber">{unmatchedLines.length} בבנק בלבד</span>
                <span className="badge blue">{outstanding.length} במערכת בלבד</span>
              </div>
            </div>
            <div className="card-pad">
              <div className="grid grid-4" style={{ gap: 12 }}>
                <div className="stat">
                  <div className="label">יתרה לפי דף הבנק ({fmtDate(endDate)})</div>
                  {batch?.closingBalance !== undefined ? <div className="value" style={{ fontSize: 22 }}><Money v={batch.closingBalance} /></div> : <NumInput value={manualStmt} onChange={setManualStmt} placeholder="הזינו יתרה" />}
                </div>
                <div className="stat">
                  <div className="label">+ במערכת וטרם בבנק</div>
                  <div className="value" style={{ fontSize: 22 }}><Money v={outstandingSum} /></div>
                  <div className="meta">צ'קים שטרם נפרעו, הפקדות בדרך</div>
                </div>
                <div className="stat">
                  <div className="label">− בבנק וטרם נרשמו</div>
                  <div className="value" style={{ fontSize: 22 }}><Money v={bankOnlySum} /></div>
                  <div className="meta">עמלות, הפקדות שלא נקלטו</div>
                </div>
                <div className="stat">
                  <div className="label">יתרה בספרים</div>
                  <div className="value" style={{ fontSize: 22 }}><Money v={bookBalance} /></div>
                  {diff !== undefined && (diff === 0 ? <div className="meta pos bold">✓ מאוזן</div> : <div className="meta neg bold">פער: {money(diff)}</div>)}
                </div>
              </div>
              {diff === 0 && stmtBalance !== undefined && (
                <div className="banner info mt" style={{ marginBottom: 0 }}>
                  <span className="grow">הבנק והספרים מתואמים ליום {fmtDate(endDate)}{unmatchedLines.length || outstanding.length ? ' (עם פריטים פתוחים מוסברים)' : ''}.</span>
                  <button className="btn primary sm" onClick={approve}><Icon name="check" />אישור ושמירת ההתאמה</button>
                </div>
              )}
              {diff !== undefined && diff !== 0 && unmatchedLines.length === 0 && (
                <div className="banner warn mt" style={{ marginBottom: 0 }}>קיים פער שאינו מוסבר בפריטים פתוחים – בדקו את יתרת הפתיחה או תנועות שנרשמו בסכום שגוי.</div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>תנועות בדף הבנק</h2>
              <Seg value={filter} onChange={setFilter} options={[{ value: 'open', label: `לא מותאמות (${unmatchedLines.length})` }, { value: 'matched', label: `מותאמות (${matchedCount})` }, { value: 'all', label: `הכול (${lines.length})` }]} />
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th style={{ width: 30 }} /><th>תאריך</th><th>תיאור בבנק</th><th>אסמכתא</th><th className="amt">סכום</th><th>מותאם ל / פעולות</th></tr></thead>
                <tbody>
                  {shown.map((l) => {
                    const m = l.matchedTo ? bookByKey.get(l.matchedTo) : undefined;
                    const kind = guessKind(l);
                    return (
                      <tr key={l.id} className={l.ignored ? 'muted' : ''}>
                        <td>{l.matchedTo ? <span className="pos bold" style={{ fontSize: 18 }}>✔</span> : l.ignored ? '–' : <span className="badge amber">!</span>}</td>
                        <td className="num">{fmtDate(l.date)}</td>
                        <td>{l.description}</td>
                        <td className="small num">{l.reference}</td>
                        <td className={'amt bold ' + (l.amount > 0 ? 'pos' : 'neg')}><Money v={l.amount} /></td>
                        <td>
                          {l.matchedTo ? (
                            <div className="row" style={{ gap: 6 }}>
                              <span className="small">{m ? `${fmtDate(m.date)} · ${m.party || m.description}` : 'תנועה שנמחקה'}</span>
                              <button className="icon-btn" title="ביטול התאמה" onClick={() => unmatchBankLine(l.id)}><Icon name="unlink" size={15} /></button>
                            </div>
                          ) : l.ignored ? (
                            <button className="btn sm ghost" onClick={() => setBankLineIgnored(l.id, false)}>החזרה</button>
                          ) : (
                            <div className="row" style={{ gap: 4 }}>
                              <button className="btn sm" onClick={() => setPicker(l)}><Icon name="link" size={14} />התאמה ידנית</button>
                              {l.amount < 0 && <button className={'btn sm ' + (kind === 'fee' ? 'primary' : '')} onClick={() => recordFee(l)}>רשום כהוצאת עמלה</button>}
                              <button className="btn sm" onClick={() => recordOther(l)}>{l.amount > 0 ? 'רשום תקבול מדייר' : 'רשום הוצאה'}</button>
                              <button className="btn sm ghost" onClick={() => recordDeposit(l)}>{l.amount > 0 ? 'הפקדת מזומן' : 'משיכה לקופה'}</button>
                              <button className="btn sm ghost" title="התעלם (למשל תנועה שאינה שייכת)" onClick={() => setBankLineIgnored(l.id, true)}>התעלם</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length === 0 && <Empty icon="✅">{filter === 'open' ? 'כל התנועות בדף הבנק מותאמות!' : 'אין תנועות'}</Empty>}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>רשום במערכת וטרם הופיע בבנק</h2><span className="small muted">עד {fmtDate(endDate)}</span></div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>תאריך ערך</th><th>תיאור</th><th>צד</th><th>אסמכתא</th><th className="amt">סכום</th><th>הערה</th></tr></thead>
                <tbody>
                  {outstanding.map((r) => (
                    <tr key={r.key}>
                      <td className="num">{fmtDate(r.valueDate)}</td>
                      <td>{r.description}</td>
                      <td>{r.party}</td>
                      <td className="small">{r.reference}</td>
                      <td className={'amt bold ' + (r.amount > 0 ? 'pos' : 'neg')}><Money v={r.amount} /></td>
                      <td className="small muted">{r.method === 'check' && r.amount < 0 ? "צ'ק לספק שטרם נפרע" : r.amount > 0 ? 'הפקדה שטרם נקלטה' : daysBetween(r.valueDate, endDate) > 10 ? 'לבדיקה' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {outstanding.length === 0 && <Empty icon="✅">אין פריטים פתוחים</Empty>}
            </div>
          </div>
        </>
      )}

      {d.reconciliations.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>היסטוריית התאמות מאושרות</h2></div>
          <table className="t">
            <thead><tr><th>ליום</th><th className="amt">יתרה בבנק</th><th className="amt">יתרה בספרים</th><th>אושר ב</th></tr></thead>
            <tbody>
              {[...d.reconciliations].reverse().map((r) => (
                <tr key={r.id}><td className="num">{fmtDate(r.date)}</td><td className="amt"><Money v={r.statementBalance} /></td><td className="amt"><Money v={r.systemBalance} /></td><td className="num small">{fmtDate(r.createdAt.slice(0, 10))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {importing && (
        <ImportModal
          file={importing.file}
          grid={importing.grid}
          onClose={() => setImporting(null)}
          onDone={(id) => {
            setImporting(null);
            setShowImport(false);
            setBatchId(id);
            setTimeout(() => autoMatch(true), 0);
          }}
        />
      )}
      {picker && <MatchPicker line={picker} rows={book.filter((r) => !r.bankLineId)} onClose={() => setPicker(null)} />}
    </>
  );
}

function addDaysIso(iso: string, n: number) {
  const dt = new Date(iso + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}

const FIELDS: { key: keyof Omit<ColumnMap, 'headerRow'>; label: string }[] = [
  { key: 'date', label: 'תאריך' },
  { key: 'description', label: 'תיאור' },
  { key: 'reference', label: 'אסמכתא' },
  { key: 'credit', label: 'זכות (נכנס)' },
  { key: 'debit', label: 'חובה (יצא)' },
  { key: 'amount', label: 'סכום (עם סימן) – במקום חובה/זכות' },
  { key: 'balance', label: 'יתרה' },
];

function ImportModal({ file, grid, onClose, onDone }: { file: File; grid: Grid; onClose: () => void; onDone: (batchId: string) => void }) {
  const d = useData();
  const [map, setMap] = useState<ColumnMap>(() => detectColumns(grid));
  const header = grid[map.headerRow] || [];
  const width = Math.max(...grid.slice(0, 40).map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => ({ i, name: header[i] != null && header[i] !== '' ? String(header[i]) : `עמודה ${i + 1}` }));
  const tmpId = 'preview';
  const parsed = useMemo(() => gridToLines(grid, map, tmpId), [grid, map]);
  const existing = new Set(d.bankLines.map((l) => lineKey(l)));
  const fresh = parsed.filter((l) => !existing.has(lineKey(l)));
  const dupCount = parsed.length - fresh.length;

  const doImport = () => {
    if (!fresh.length) return toast('אין תנועות חדשות לייבוא', 'error');
    const batchId = uid();
    const lines = fresh.map((l, i) => ({ ...l, id: batchId + '-' + i, batchId }));
    const dates = lines.map((l) => l.date).sort();
    // closing balance: the balance on the latest-dated row (bank files may be in either order)
    const withBal = parsed.filter((l) => l.balance !== undefined);
    let closing: number | undefined;
    if (withBal.length) {
      const newestFirst = withBal[0].date > withBal[withBal.length - 1].date;
      closing = (newestFirst ? withBal[0] : withBal[withBal.length - 1]).balance;
    }
    attempt(() => {
      importBankLines({ id: batchId, fileName: file.name, importedAt: new Date().toISOString(), fromDate: dates[0], toDate: dates[dates.length - 1], lines: lines.length, closingBalance: closing }, lines);
      onDone(batchId);
    }, `יובאו ${lines.length} תנועות`);
  };

  return (
    <Modal title={`ייבוא: ${file.name}`} onClose={onClose} size="wide"
      footer={<><button className="btn primary" onClick={doImport} disabled={!fresh.length}><Icon name="check" />ייבוא {fresh.length} תנועות</button><button className="btn" onClick={onClose}>ביטול</button>{dupCount > 0 && <span className="muted">{dupCount} תנועות כבר קיימות וידולגו</span>}</>}
    >
      <div className="form">
        <div className="form-row">
          <Field label="שורת כותרות" hint="השורה בקובץ שבה מופיעים שמות העמודות">
            <select className="input" value={map.headerRow} onChange={(e) => setMap({ ...detectColumns(grid.slice(Number(e.target.value))), headerRow: Number(e.target.value) })}>
              {grid.slice(0, 30).map((r, i) => <option key={i} value={i}>{i + 1}: {r.filter((c) => c != null && c !== '').slice(0, 5).map(String).join(' | ').slice(0, 70)}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-row">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <select className="input" value={map[f.key]} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
                <option value={-1}>— אין —</option>
                {cols.map((c) => <option key={c.i} value={c.i}>{c.name}</option>)}
              </select>
            </Field>
          ))}
        </div>
        <h3>תצוגה מקדימה ({parsed.length} תנועות זוהו)</h3>
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="t">
            <thead><tr><th>תאריך</th><th>תיאור</th><th>אסמכתא</th><th className="amt">סכום</th><th className="amt">יתרה</th></tr></thead>
            <tbody>
              {parsed.slice(0, 50).map((l) => (
                <tr key={l.id} className={existing.has(lineKey(l)) ? 'muted' : ''}>
                  <td className="num">{fmtDate(l.date)}</td><td>{l.description}</td><td className="small">{l.reference}</td>
                  <td className={'amt ' + (l.amount > 0 ? 'pos' : 'neg')}><Money v={l.amount} /></td>
                  <td className="amt">{l.balance !== undefined ? <Money v={l.balance} /> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.length === 0 && <Empty>לא זוהו תנועות – בדקו את שורת הכותרות ואת מיפוי העמודות</Empty>}
        </div>
      </div>
    </Modal>
  );
}

function MatchPicker({ line, rows, onClose }: { line: BankLine; rows: LedgerRow[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [amt, setAmt] = useState('');
  const sorted = rows
    .filter((r) => Math.sign(r.amount) === Math.sign(line.amount))
    .filter((r) => !q || [r.description, r.party, r.reference].some((x) => x && x.includes(q)))
    .filter((r) => !amt || Math.abs(Math.abs(r.amount) - parseAmount(amt)) < 0.01)
    .map((r) => ({ r, score: Math.abs(r.amount - line.amount) * 10 + Math.abs(daysBetween(r.valueDate, line.date)) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 40);
  return (
    <Modal title="התאמה ידנית" onClose={onClose} size="wide">
      <div className="banner info">
        תנועת בנק: {fmtDate(line.date)} · {line.description} · <b className="num">{money(line.amount)}</b>
      </div>
      <div className="row mb">
        <input className="input" style={{ flex: 1 }} placeholder="חיפוש…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="input ltr" style={{ width: 120 }} placeholder="סכום" value={amt} onChange={(e) => setAmt(e.target.value)} />
      </div>
      <table className="t">
        <thead><tr><th>תאריך</th><th>תיאור</th><th>צד</th><th className="amt">סכום</th><th /></tr></thead>
        <tbody>
          {sorted.map(({ r }) => (
            <tr key={r.key}>
              <td className="num">{fmtDate(r.valueDate)}</td>
              <td>{r.description}</td>
              <td>{r.party}</td>
              <td className={'amt ' + (Math.abs(r.amount - line.amount) < 0.01 ? 'pos bold' : '')}><Money v={r.amount} /></td>
              <td><button className="btn sm primary" onClick={() => { matchBankLine(line.id, entityKey(r)); toast('הותאם'); onClose(); }}>התאם</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <Empty>אין תנועות פתוחות מתאימות במערכת. השתמשו בכפתורי הרישום כדי להוסיף.</Empty>}
    </Modal>
  );
}
