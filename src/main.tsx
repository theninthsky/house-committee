import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { loadData } from './lib/store';
import { requestPersistence } from './lib/db';
import { runAutoSync } from './lib/actions';
import { initPwa } from './lib/pwa';

initPwa();

const root = createRoot(document.getElementById('root')!);

loadData()
  .then(() => {
    runAutoSync();
    void requestPersistence();
    // re-run the monthly sync if the app stays open across midnight / a new month
    setInterval(runAutoSync, 60 * 60 * 1000);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((e) => {
    console.error(e);
    root.render(<div style={{ padding: 40 }}>שגיאה בטעינת הנתונים מהדפדפן: {String(e)}</div>);
  });
