import { useCallback, useEffect, useRef, useState } from 'react';
import { MemoryBookEditor, type MemoryBookEditorRef, type PageData } from './MemoryBookEditor';
import { normalizeAppLanguage, type AppLanguage } from './i18n';

const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type CoverData = PageData & { title: string; language: AppLanguage };

const labels = {
  hu: { back: '← Saját könyveim', eyebrow: 'Saját könyv fedőlapja', hint: 'A fedőlapot csak a könyv tulajdonosa szerkesztheti.', loading: 'Fedőlap betöltése…', error: 'A fedőlapot nem sikerült betölteni.' },
  en: { back: '← My books', eyebrow: 'Book cover', hint: 'Only the book owner can edit the cover.', loading: 'Loading cover…', error: 'The cover could not be loaded.' },
  de: { back: '← Meine Bücher', eyebrow: 'Buchcover', hint: 'Nur der Eigentümer kann das Cover bearbeiten.', loading: 'Cover wird geladen…', error: 'Das Cover konnte nicht geladen werden.' },
} as const;

function defaultCoverCanvas(title: string) {
  return {
    version: '7.4.0',
    objects: [{
      type: 'Textbox', version: '7.4.0', originX: 'left', originY: 'top',
      left: 75, top: 110, width: 600, height: 190, fill: '#0f172a', stroke: null,
      strokeWidth: 1, scaleX: 1, scaleY: 1, angle: 0, opacity: 1,
      visible: true, backgroundColor: '', fillRule: 'nonzero', paintFirst: 'fill',
      globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
      text: title, fontSize: 64, fontWeight: '700', fontFamily: 'Arial',
      fontStyle: 'normal', lineHeight: 1.16, underline: false, overline: false,
      linethrough: false, textAlign: 'center', charSpacing: 0, styles: [],
      direction: 'ltr', path: null, pathStartOffset: 0, pathSide: 'left',
      pathAlign: 'baseline', minWidth: 20, splitByGrapheme: true,
    }],
  };
}

export function CoverEditorPage({ bookId }: { bookId: string }) {
  const editorRef = useRef<MemoryBookEditorRef>(null);
  const [cover, setCover] = useState<CoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const language = cover?.language || 'hu';
  const copy = labels[language];

  useEffect(() => {
    fetch(`${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/cover`, { credentials: 'include' })
      .then(async (response) => {
        if (response.status === 401) { window.location.href = '/login'; return null; }
        if (!response.ok) throw new Error('LOAD_FAILED');
        return response.json();
      })
      .then((data) => {
        if (!data) return;
        const hasContent = data.canvasData && Object.keys(data.canvasData).length > 0;
        setCover({
          id: `cover-${data.id}`,
          pageNumber: 0,
          canvasData: hasContent ? data.canvasData : defaultCoverCanvas(data.title || 'MemoryBook'),
          previewImageUrl: data.previewImageUrl || undefined,
          version: data.version || 1,
          title: data.title || 'MemoryBook',
          language: normalizeAppLanguage(data.language) || 'hu',
        });
      })
      .catch(() => setError(labels.hu.error))
      .finally(() => setLoading(false));
  }, [bookId]);

  const saveCover = useCallback(async (_id: string, canvasData: Record<string, any>, previewDataUrl: string, expectedVersion: number) => {
    const response = await fetch(`${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/cover`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvasData, previewDataUrl, expectedVersion }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const err: any = new Error(data.error || 'SAVE_FAILED'); err.status = response.status; throw err; }
    setCover((current) => current ? { ...current, version: data.newVersion, previewImageUrl: data.previewImageUrl } : current);
    return { newVersion: data.newVersion };
  }, [bookId]);

  if (loading) return <div style={styles.message}>{copy.loading}</div>;
  if (error || !cover) return <div style={styles.message}>{error || copy.error}</div>;

  return <main style={styles.page}>
    <section style={styles.header}>
      <a href="/my-books" style={styles.back}>{copy.back}</a>
    </section>
    <MemoryBookEditor
      ref={editorRef}
      page={cover}
      onSavePage={saveCover}
      language={language}
      enableBackgroundControls
    />
  </main>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f1f5f9', padding: '16px 12px 40px', boxSizing: 'border-box', fontFamily: 'Arial, sans-serif' },
  header: { width: '100%', maxWidth: 750, margin: '0 auto 14px' },
  back: { display: 'inline-block', marginBottom: 14, color: '#475569', textDecoration: 'none', fontWeight: 700 },
  eyebrow: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { margin: '6px 0', color: '#0f172a', fontSize: 'clamp(24px, 7vw, 34px)', overflowWrap: 'anywhere' },
  hint: { margin: 0, color: '#64748b', lineHeight: 1.45 },
  message: { padding: 32, textAlign: 'center', fontFamily: 'Arial, sans-serif', color: '#475569' },
};
