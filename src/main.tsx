import { createRoot } from 'react-dom/client';
import './index.css';
import { initializeAppLanguage } from './i18n';
import { WeddingPage } from './wedding/WeddingPage';
import { PilotInvitePage } from './wedding/PilotInvitePage';

initializeAppLanguage();
const path = window.location.pathname;
// The pilot must not initialize unrelated editors or legacy authentication.
if(path==='/wedding/try'){
  void import('./wedding/AppTrialPage').then(({AppTrialPage})=>createRoot(document.getElementById('root')!).render(<AppTrialPage/>));
} else if (/^\/wedding\/books\/[^/]+\/montage$/.test(path)) {
  if(new URLSearchParams(location.search).get('szerkesztes')==='1')void import('./wedding/MontagePage').then(({MontagePage})=>createRoot(document.getElementById('root')!).render(<MontagePage bookId={path.split('/')[3]}/>));
  else void import('./wedding/SimpleBookPage').then(({SimpleBookPage})=>createRoot(document.getElementById('root')!).render(<SimpleBookPage bookId={path.split('/')[3]}/>));
} else if (path === '/pilot' || path.startsWith('/pilot/')) {
  void import('./pilot-shop/ShopPage').then(({ShopPage})=>createRoot(document.getElementById('root')!).render(<ShopPage/>));
} else if (path === '/wedding' || path.startsWith('/wedding/')) {
  createRoot(document.getElementById('root')!).render(
    path === '/wedding/owner-invite' ? <PilotInvitePage /> : <WeddingPage />
  );
} else {
  void import('./legacy-main');
}
