import { useCallback, useEffect, useRef, useState } from 'react';
import { MemoryBookEditor, type MemoryBookEditorRef, type PageData } from './MemoryBookEditor';
import { normalizeAppLanguage, type AppLanguage } from './i18n';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://' + window.location.hostname + ':3001'
  : '';

type OwnerPageData = PageData & { language?: AppLanguage };

export function OwnerMemoryEditorPage({ bookId, pageId }: { bookId: string; pageId: string }) {
  const editorRef = useRef<MemoryBookEditorRef>(null);
  const [page, setPage] = useState<OwnerPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');
  const language = normalizeAppLanguage(page?.language) || 'hu';
  const labels = language === 'de'
    ? { back: '← Zurück zum Buch', title: 'Eigene Erinnerung', done: 'Fertig', finishing: 'Speichern…', error: 'Die Erinnerungsseite konnte nicht geladen werden.' }
    : language === 'en'
      ? { back: '← Back to book', title: 'My own memory', done: 'Done', finishing: 'Saving…', error: 'The memory page could not be loaded.' }
      : { back: '← Vissza a könyvhöz', title: 'Saját emlék', done: 'Kész', finishing: 'Mentés…', error: 'Az emléklapot nem sikerült betölteni.' };

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/pages/${encodeURIComponent(pageId)}`, { credentials: 'include' }),
      fetch(`${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages`, { credentials: 'include' }),
    ]).then(async ([pageResponse, bookResponse]) => {
      if (pageResponse.status === 401 || bookResponse.status === 401) { window.location.href = '/login'; return; }
      if (!pageResponse.ok || !bookResponse.ok) throw new Error('LOAD_FAILED');
      const [pageData, bookData] = await Promise.all([pageResponse.json(), bookResponse.json()]);
      setPage({ ...pageData, language: normalizeAppLanguage(bookData.book?.language) || 'hu' });
    }).catch(() => setError('Az emléklapot nem sikerült betölteni.')).finally(() => setLoading(false));
  }, [bookId, pageId]);

  const savePage = useCallback(async (_id: string, canvasData: Record<string, any>, previewDataUrl: string, expectedVersion: number) => {
    const response = await fetch(`${API_BASE}/api/pages/${encodeURIComponent(pageId)}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvasData, previewDataUrl, expectedVersion }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const err: any = new Error(data.error || 'SAVE_FAILED'); err.status = response.status; throw err; }
    setPage((current) => current ? { ...current, version: data.newVersion, previewImageUrl: data.previewImageUrl } : current);
    return { newVersion: data.newVersion };
  }, [pageId]);

  const complete = async () => {
    if (finishing) return;
    try {
      setFinishing(true);
      setError('');
      await editorRef.current?.flush();
      const response = await fetch(`${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/own-memory/${encodeURIComponent(pageId)}/complete`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('COMPLETE_FAILED');
      window.location.href = `/book/${encodeURIComponent(bookId)}/view`;
    } catch {
      setError(labels.error);
      setFinishing(false);
    }
  };

  if (loading) return <div style={styles.message}>Betöltés…</div>;
  if (error && !page) return <div style={styles.message}>{error}</div>;
  if (!page) return null;

  return <main style={styles.page}>
    <section style={styles.header}>
      <a href={`/my-books/${encodeURIComponent(bookId)}`} style={styles.back}>{labels.back}</a>
      <strong>{labels.title}</strong>
      <button type="button" onClick={complete} disabled={finishing} style={styles.done}>{finishing ? labels.finishing : labels.done}</button>
    </section>
    {error && <div style={styles.error}>{error}</div>}
    <MemoryBookEditor ref={editorRef} page={page} onSavePage={savePage} language={language} enableBackgroundControls compactLayout />
  </main>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: '6px 12px 20px', boxSizing: 'border-box', fontFamily: 'Arial, sans-serif' },
  header: { width: '100%', maxWidth: 750, margin: '0 auto 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  back: { color: '#475569', textDecoration: 'none', fontWeight: 700, fontSize: 14 },
  done: { minHeight: 42, padding: '8px 18px', border: 0, borderRadius: 9, background: '#0f172a', color: '#fff', fontWeight: 800 },
  error: { maxWidth: 750, margin: '8px auto', padding: 10, borderRadius: 8, background: '#fef2f2', color: '#991b1b' },
  message: { padding: 32, textAlign: 'center', fontFamily: 'Arial, sans-serif', color: '#475569' },
};
