import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthPage } from './AuthPage.tsx'
import { LandingPage } from './LandingPage.tsx'
import { MyBooksPage } from './MyBooksPage.tsx'
import { OwnerBookPage } from './OwnerBookPage.tsx'
import { PageInviteEditorPage } from './PageInviteEditorPage.tsx'
import { PublicPage } from './PublicPage.tsx'
import { JoinPage } from './JoinPage.tsx'
import { OrganizerContributionsPage } from './OrganizerContributionsPage.tsx'
import { BookViewerPage } from './BookViewerPage.tsx'
import { InviteCtaPage } from './InviteCtaPage.tsx'
import { EventGuestbookQrPage } from './EventGuestbookQrPage.tsx'
import { PurchasePage } from './PurchasePage.tsx'
import { GiftRedeemPage } from './GiftRedeemPage.tsx'
import { initializeAppLanguage } from './i18n'

initializeAppLanguage()

const path = window.location.pathname
const ownerBookMatch = path.match(/^\/my-books\/([^/]+)$/)
const pageInviteMatch = path.match(/^\/p\/([^/]+)$/)
const publicPageMatch = path.match(/^\/share\/([^/]+)$/)
const joinMatch = path.match(/^\/join\/([^/]+)$/)
const organizerMatch = path.match(/^\/organizer\/([^/]+)\/contributions$/)
const bookViewMatch = path.match(/^\/book\/([^/]+)\/view$/)
const eventQrMatch = path.match(/^\/my-books\/([^/]+)\/event-qr$/)
const giftMatch = path.match(/^\/gift\/([^/]+)$/)

const root = path === '/'
  ? <LandingPage />
  : path === '/login'
    ? <AuthPage />
  : path === '/purchase'
    ? <PurchasePage />
  : path === '/nekem-is-kell'
    ? <InviteCtaPage />
  : giftMatch
    ? <GiftRedeemPage token={decodeURIComponent(giftMatch[1])} />
  : eventQrMatch
    ? <EventGuestbookQrPage bookId={decodeURIComponent(eventQrMatch[1])} />
  : path === '/my-books'
    ? <MyBooksPage />
    : ownerBookMatch
      ? <OwnerBookPage bookId={decodeURIComponent(ownerBookMatch[1])} />
      : pageInviteMatch
        ? <PageInviteEditorPage token={decodeURIComponent(pageInviteMatch[1])} />
        : publicPageMatch
          ? <PublicPage token={decodeURIComponent(publicPageMatch[1])} />
          : joinMatch
            ? <JoinPage token={decodeURIComponent(joinMatch[1])} />
            : organizerMatch
              ? <OrganizerContributionsPage bookId={decodeURIComponent(organizerMatch[1])} />
              : bookViewMatch
                ? <BookViewerPage bookId={decodeURIComponent(bookViewMatch[1])} />
                : path === '/demo'
                  ? <App />
                  : <LandingPage />

createRoot(document.getElementById('root')!).render(root)