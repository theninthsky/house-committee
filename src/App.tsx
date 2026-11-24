import { useEffect, useState } from 'react';
import { useData } from './lib/store';
import { autoBackup } from './lib/backup';
import { DialogHost, Icon, Toasts, toast, useRoute } from './components/ui';
import { FormHost } from './components/forms';
import { Dashboard } from './pages/Dashboard';
import { UnitsPage, UnitPage } from './pages/Units';
import { CollectionPage } from './pages/Collection';
import { PaymentsPage } from './pages/Payments';
import { VendorsPage } from './pages/Vendors';
import { ExpensesPage } from './pages/Expenses';
import { LedgerPage } from './pages/Ledger';
import { PettyCashPage } from './pages/PettyCash';
import { BankPage } from './pages/Bank';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { SetupWizard } from './pages/Setup';
import { applyUpdate, dismissUpdate, isIos, isStandalone, promptInstall, usePwa } from './lib/pwa';

const NAV: { path: string; label: string; icon: string; sep?: boolean }[] = [
  { path: '', label: 'לוח בקרה', icon: 'home' },
  { path: 'collection', label: 'מטריצת גבייה', icon: 'grid' },
  { path: 'units', label: 'דיירים', icon: 'users' },
  { path: 'payments', label: 'תקבולים וקבלות', icon: 'receipt' },
  { path: 'expenses', label: 'הוצאות', icon: 'cart', sep: true },
  { path: 'vendors', label: 'ספקים', icon: 'truck' },
  { path: 'cash', label: 'קופה קטנה', icon: 'wallet' },
  { path: 'ledger', label: 'כרטסת תנועות', icon: 'book', sep: true },
  { path: 'bank', label: 'התאמות בנק', icon: 'bank' },
  { path: 'reports', label: 'דוחות', icon: 'chart' },
  { path: 'settings', label: 'הגדרות', icon: 'settings', sep: true },
];

export function App() {
  const d = useData();
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const pwa = usePwa();
  const top = route[0] || '';

  useEffect(() => {
    setMenu(false);
  }, [top, route[1]]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [top]);

  // daily automatic backup to the chosen folder (silent when permission is still granted)
  useEffect(() => {
    if (!d.settings.setupDone) return;
    autoBackup(false).then((r) => r === 'done' && toast('גיבוי יומי נשמר בתיקיית הגיבוי', 'info'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.settings.setupDone]);

  if (!d.settings.setupDone) {
    return (
      <>
        {pwa.needRefresh && <UpdateBanner />}
        <SetupWizard />
        <DialogHost />
        <Toasts />
      </>
    );
  }

  let page;
  switch (top) {
    case '': page = <Dashboard />; break;
    case 'collection': page = <CollectionPage />; break;
    case 'units': page = route[1] ? <UnitPage id={route[1]} /> : <UnitsPage />; break;
    case 'payments': page = <PaymentsPage />; break;
    case 'vendors': page = <VendorsPage />; break;
    case 'expenses': page = <ExpensesPage />; break;
    case 'ledger': page = <LedgerPage />; break;
    case 'cash': page = <PettyCashPage />; break;
    case 'bank': page = <BankPage />; break;
    case 'reports': page = <ReportsPage tab={route[1]} />; break;
    case 'settings': page = <SettingsPage tab={route[1]} />; break;
    default: page = <Dashboard />;
  }

  return (
    <div className="app">
      <div className="topbar">
        <button onClick={() => setMenu(true)} aria-label="תפריט"><Icon name="menu" size={22} /></button>
        <b>{d.settings.buildingName || 'ועד הבית'}</b>
      </div>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <aside className={'sidebar' + (menu ? ' open' : '')}>
        <div className="brand">
          <img className="brand-icon" src="./icons/icon.svg" alt="" />
          <div className="t">{d.settings.buildingName || 'ועד הבית'}</div>
          <div className="s">{[d.settings.address, d.settings.city].filter(Boolean).join(', ') || 'ניהול כספי ועד בית'}</div>
        </div>
        <nav>
          {NAV.map((n) => (
            <div key={n.path} style={{ display: 'contents' }}>
              {n.sep && <div className="sep" />}
              <a href={'#/' + n.path} className={top === n.path ? 'active' : ''}>
                <Icon name={n.icon} className="nav-ico" />
                {n.label}
              </a>
            </div>
          ))}
        </nav>
        <div className="foot">
          {pwa.canInstall && (
            <button className="btn install-btn" onClick={() => void promptInstall()}>
              <Icon name="download" size={16} />התקנת האפליקציה
            </button>
          )}
          {!pwa.canInstall && isIos() && !isStandalone() && (
            <div className="install-hint">להתקנה באייפון: כפתור השיתוף ← "הוספה למסך הבית"</div>
          )}
          הנתונים נשמרים בדפדפן זה בלבד.
          <br />
          <a href="#/settings/backup" style={{ color: '#9fb4d3' }}>גיבוי ושחזור</a>
        </div>
      </aside>
      <main className="main">
        {pwa.needRefresh && <UpdateBanner />}
        {page}
      </main>
      <FormHost />
      <DialogHost />
      <Toasts />
    </div>
  );
}

function UpdateBanner() {
  return (
    <div className="banner info no-print">
      <Icon name="sparkle" />
      <span className="grow">גרסה חדשה של המערכת זמינה. כדאי לשמור טופס פתוח לפני העדכון.</span>
      <button className="btn primary sm" onClick={applyUpdate}>עדכון עכשיו</button>
      <button className="btn sm ghost" onClick={dismissUpdate}>אחר כך</button>
    </div>
  );
}
