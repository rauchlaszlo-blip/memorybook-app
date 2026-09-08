import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthPage } from './AuthPage.tsx'
import { MyBooksPage } from './MyBooksPage.tsx'
import { OwnerBookPage } from './OwnerBookPage.tsx'
import { PageInviteEditorPage } from './PageInviteEditorPage.tsx'

const path = window.location.pathname
const ownerBookMatch = path.match(/^\/my-books\/([^/]+)$/)
const pageInviteMatch = path.match(/^\/p\/([^/]+)$/)

const root = path === '/login'
  ? <AuthPage />
  : path === '/my-books'
    ? <MyBooksPage />
    : ownerBookMatch
      ? <OwnerBookPage bookId={decodeURIComponent(ownerBookMatch[1])} />
      : pageInviteMatch
        ? <PageInviteEditorPage token={decodeURIComponent(pageInviteMatch[1])} />
        : <App />

createRoot(document.getElementById('root')!).render(root)
