import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthPage } from './AuthPage.tsx'
import { MyBooksPage } from './MyBooksPage.tsx'
import { OwnerBookPage } from './OwnerBookPage.tsx'
import { PageInviteEditorPage } from './PageInviteEditorPage.tsx'
import { PublicPage } from './PublicPage.tsx'
import { JoinPage } from './JoinPage.tsx'
import { OrganizerContributionsPage } from './OrganizerContributionsPage.tsx'
import { BookViewerPage } from './BookViewerPage.tsx'
import { InviteCtaPage } from './InviteCtaPage.tsx'
import { EventGuestbookQrPage } from './EventGuestbookQrPage.tsx'

const path = window.location.pathname
const ownerBookMatch = path.match(/^\/my-books\/([^/]+)$/)
const pageInviteMatch = path.match(/^\/p\/([^/]+)$/)
const publicPageMatch = path.match(/^\/share\/([^/]+)$/)
const joinMatch = path.match(/^\/join\/([^/]+)$/)
const organizerMatch = path.match(/^\/organizer\/([^/]+)\/contributions$/)
const bookViewMatch = path.match(/^\/book\/([^/]+)\/view$/)
const eventQrMatch = path.match(/^\/my-books\/([^/]+)\/event-qr$/)

const root = path === '/login'
  ? <AuthPage />
  : path === '/nekem-is-kell'
    ? <InviteCtaPage />
  : eventQrMatch
    ? <EventGuestbookQrPage bookId={decodeURIComponent(eventQrMatch[1])} />
  : path === '/' || path === '/my-books'
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
                  : <MyBooksPage />

createRoot(document.getElementById('root')!).render(root)
