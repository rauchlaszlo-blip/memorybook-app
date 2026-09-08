import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthPage } from './AuthPage.tsx'
import { MyBooksPage } from './MyBooksPage.tsx'

const path = window.location.pathname

const root = path === '/login'
  ? <AuthPage />
  : path === '/my-books'
    ? <MyBooksPage />
    : <App />

createRoot(document.getElementById('root')!).render(root)
