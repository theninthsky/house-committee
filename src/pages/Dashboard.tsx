import { useMemo } from 'react';
import { useData } from '../lib/store';
import { accountBalance, alerts, ledgerRows, monthCollectionStatus, profitAndLoss, projectedBalance } from '../lib/calc';
import { currentMonth, fmtDate, money, monthLabel, monthRange, addMonths, todayISO } from '../lib/format';
import { Icon, Money, navigate, PageHead } from '../components/ui';
import { openForm } from '../components/forms';
import { defaultExpense } from '../lib/actions';

export function Dashboard() {
  const d = useData();
  const rows = useMemo(() => ledgerRows(d), [d]);
  const bank = accountBalance(d, 'bank', todayISO(), rows);
  const bankProj = projectedBalance(d, 'bank', rows);
  const cash = accountBalance(d, 'cash', todayISO(), rows);
  const st = monthCollectionStatus(d);
  const al = useMemo(() => alerts(d), [d]);
  const lastRec = [...d.reconciliations].sort((a, b) => b.date.localeCompare(a.date))[0];
  const recent = [...rows].filter((r) => r.type !== 'opening').reverse().slice(0, 8);
  const pct = st.total ? Math.round((st.paidCount / st.total) * 100) : 0;

  // last 6 months income/expense bars
  const cur = currentMonth();
  const months = monthRange(addMonths(cur, -5), cur);
  const series = months.map((m) => {
    const pl = profitAndLoss(d, m + '-01', m + '-31');
    return { m, inc: pl.totalIncome, exp: pl.totalExpense };
  });
  const max = Math.max(1, ...series.flatMap((s) => [s.inc, s.exp]));

  const payVendor = (vendorId: string) => {
    const v = d.vendors.find((x) => x.id === vendorId)!;
    openForm({
      kind: 'expense',
      prefill: defaultExpense({ vendorId, category: v.category, amount: v.monthlyAmount || 0, method: v.defaultMethod || 'transfer', description: `${v.service || v.name} – ${monthLabel(cur)}`, forMonth: cur }),
    });
  };

  return (
    <>
      <PageHead title="לוח בקרה" sub={`${d.settings.buildingName} · ${fmtDate(todayISO())}`} />
      {d.settings.demo && (
        <div className="banner info">
          <Icon name="sparkle" /> אתם צופים בנתוני דוגמה. כשתסיימו להתנסות, ניתן לאפס את המערכת ממסך <a href="#/settings/data">הגדרות ← נתונים</a>.
        </div>
      )}
      <div className="grid dash-top">
        <div className="card card-pad stat">
          <div className="label"><Icon name="bank" size={16} /> יתרות</div>
          <div className="stat-split" style={{ marginTop: 6 }}>
            <div>
              <div className="small muted">בנק</div>
              <div className="value" style={{ fontSize: 24, marginTop: 0 }}><Money v={bank} /></div>
            </div>
            <div>
              <div className="small muted">קופה קטנה</div>
              <div className="value" style={{ fontSize: 24, marginTop: 0 }}><Money v={cash} /></div>
            </div>
          </div>
          <div className="meta">
            {lastRec ? <>התאמה אחרונה: {fmtDate(lastRec.date)} · יתרה בבנק <span className="num">{money(lastRec.statementBalance)}</span></> : 'טרם בוצעה התאמת בנק'}
            {bankProj !== bank && <div>כולל צ'קים דחויים: <span className="num">{money(bankProj)}</span></div>}
          </div>
        </div>
        <div className="card card-pad stat clickable" onClick={() => navigate('/collection')}>
          <div className="label"><Icon name="grid" size={16} /> גבייה – {monthLabel(cur)}</div>
          <div className="value">{st.paidCount} <span style={{ fontSize: 16, fontWeight: 600 }} className="muted">מתוך {st.total} שילמו</span></div>
          <div className="progress"><div style={{ width: pct + '%' }} /></div>
          <div className="meta">חוב פתוח בבניין: <b className={st.openDebt > 0 ? 'neg num' : 'num'}>{money(st.openDebt)}</b></div>
        </div>
        <div className="card stat" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-pad" style={{ paddingBottom: 6 }}>
            <div className="label"><Icon name="alert" size={16} /> התראות ותשלומים קרובים {al.length > 0 && <span className="badge amber">{al.length}</span>}</div>
          </div>
          <div className="alert-list" style={{ maxHeight: 210, overflowY: 'auto' }}>
            {al.length === 0 && <div className="alert-item"><span className="txt muted">אין התראות 🎉</span></div>}
            {al.map((a, i) => (
              <div key={i} className={'alert-item ' + a.level} style={{ padding: '7px 18px', fontSize: 13.5 }}>
                <span className="dot" />
                <span className="txt">{a.link ? <a href={a.link} style={{ color: 'inherit' }}>{a.text}</a> : a.text}</span>
                {a.action && <button className="btn sm" onClick={() => payVendor(a.action!.vendorId)}>{a.action.label}</button>}
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <div className="stat"><div className="label"><Icon name="sparkle" size={16} /> פעולות מהירות</div></div>
          <div className="quick" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={() => openForm({ kind: 'payment' })}><Icon name="plus" />קליטת תשלום מדייר</button>
            <button className="btn" onClick={() => openForm({ kind: 'expense' })}><Icon name="plus" />רישום הוצאה חדשה</button>
            <button className="btn" onClick={() => navigate('/bank?import=1')}><Icon name="upload" />העלאת דף בנק להתאמה</button>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2>תנועות אחרונות</h2><a href="#/ledger">לכל התנועות ←</a></div>
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {recent.length === 0 && <tr><td className="muted">אין עדיין תנועות</td></tr>}
                {recent.map((r) => (
                  <tr key={r.key}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                    <td>
                      <div>{r.description}</div>
                      <div className="small muted">{r.party || r.category}{r.account === 'cash' ? ' · קופה קטנה' : ''}</div>
                    </td>
                    <td className="amt bold"><Money v={r.amount} colored /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>הכנסות מול הוצאות – חצי שנה אחרונה</h2><a href="#/reports">לדוחות ←</a></div>
          <div className="card-pad">
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${series.length}, 1fr)`, gap: 10, alignItems: 'end', height: 190 }}>
              {series.map((s) => (
                <div key={s.m} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 160 }}>
                    <div title={`הכנסות ${money(s.inc)}`} style={{ width: 14, height: `${(s.inc / max) * 100}%`, background: 'var(--green)', borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                    <div title={`הוצאות ${money(s.exp)}`} style={{ width: 14, height: `${(s.exp / max) * 100}%`, background: 'var(--red)', opacity: 0.8, borderRadius: '4px 4px 0 0', minHeight: 2 }} />
                  </div>
                  <div className="small muted" style={{ marginTop: 6 }}>{monthLabel(s.m, true)}</div>
                </div>
              ))}
            </div>
            <div className="legend mt" style={{ marginTop: 10 }}>
              <span><i style={{ background: 'var(--green)' }} />הכנסות</span>
              <span><i style={{ background: 'var(--red)', opacity: 0.8 }} />הוצאות</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
