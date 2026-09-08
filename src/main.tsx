import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthPage } from './AuthPage.tsx'
import { MyBooksPage } from './MyBooksPage.tsx'
import { OwnerBookPage } from './OwnerBookPage.tsx'
import { PageInviteEditorPage } from './PageInviteEditorPage.tsx'
import { PublicPage } from './PublicPage.tsx'

const path = window.location.pathname
const ownerBookMatch = path.match(/^\/my-books\/([^/]+)$/)
const pageInviteMatch = path.match(/^\/p\/([^/]+)$/)
const publicPageMatch = path.match(/^\/share\/([^/]+)$/)

const root = path === '/login'
  ? <AuthPage />
  : path === '/my-books'
    ? <MyBooksPage />
    : ownerBookMatch
      ? <OwnerBookPage bookId={decodeURIComponent(ownerBookMatch[1])} />
      : pageInviteMatch
        ? <PageInviteEditorPage token={decodeURIComponent(pageInviteMatch[1])} />
        : publicPageMatch
          ? <PublicPage token={decodeURIComponent(publicPageMatch[1])} />
          : <App />

createRoot(document.getElementById('root')!).render(root)
