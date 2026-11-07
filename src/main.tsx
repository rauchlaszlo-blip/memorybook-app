import { createRoot } from 'react-dom/client';
import './index.css';
import { initializeAppLanguage } from './i18n';
import { WeddingPage } from './wedding/WeddingPage';
import { PilotInvitePage } from './wedding/PilotInvitePage';

initializeAppLanguage();
const path = window.location.pathname;
// The pilot must not initialize unrelated editors or legacy authentication.
if (path === '/pilot' || path.startsWith('/pilot/')) {
  void import('./pilot-shop/ShopPage').then(({ShopPage})=>createRoot(document.getElementById('root')!).render(<ShopPage/>));
} else if (path === '/wedding' || path.startsWith('/wedding/')) {
  createRoot(document.getElementById('root')!).render(
    path === '/wedding/owner-invite' ? <PilotInvitePage /> : <WeddingPage />
  );
} else {
  void import('./legacy-main');
}
