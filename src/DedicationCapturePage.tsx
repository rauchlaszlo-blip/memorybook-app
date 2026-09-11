import { useEffect, useRef, useState } from 'react';
import { ownerFormat, ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3001`
    : '';

type DedicationCapturePageProps = {
  bookId: string;
  pageId: string;
};

export function DedicationCapturePage({ bookId, pageId }: DedicationCapturePageProps) {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const f = (key: string, values: Record<string, string | number>) =>
    ownerFormat(language, key, values);
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoAccepted, setPhotoAccepted] = useState(false);
  const [photoSource, setPhotoSource] = useState<'camera' | 'gallery' | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const selectPhoto = (file: File | undefined, source: 'camera' | 'gallery') => {
    if (!file || !file.type.startsWith('image/')) return;
    const nextUrl = URL.createObjectURL(file);
    setPhotoUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return nextUrl;
    });
    setPhotoSource(source);
    setPhotoAccepted(false);
  };

  const openCamera = () => {
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    cameraInputRef.current?.click();
  };

  const openGallery = () => {
    if (galleryInputRef.current) galleryInputRef.current.value = '';
    galleryInputRef.current?.click();
  };

  const takeAnotherPhoto = () => {
    setPhotoAccepted(false);
    if (photoSource === 'gallery') openGallery();
    else openCamera();
  };

  const signaturePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
  };

  const startSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    const point = signaturePoint(event);
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 7;
    context.strokeStyle = '#000000';
  };

  const drawSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = signaturePoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
  };

  const stopSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages`,
          { credentials: 'include' }
        );
        if (response.status === 401) {
          window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.book?.bookType !== 'dedication') {
          throw new Error('DEDICATION_BOOK_NOT_FOUND');
        }
        const page = Array.isArray(data.pages)
          ? data.pages.find((item: { id?: string }) => item.id === pageId)
          : null;
        if (!page || page.inviteStatus !== 'empty') {
          throw new Error('DEDICATION_PAGE_NOT_AVAILABLE');
        }
        setBookTitle(data.book.title || 'MemoryBook');
        setPageNumber(Number(page.pageNumber));
      } catch (loadError) {
        console.error(loadError);
        setError(t('A dedikálási oldal nem nyitható meg.'));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [bookId, pageId]);

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <a href={`/my-books/${encodeURIComponent(bookId)}`} style={styles.back}>
          {t('← Vissza a könyvhöz')}
        </a>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{bookTitle}</h1>

        {loading && <div style={styles.message}>{t('Betöltés...')}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && pageNumber !== null && (
          <>
            <div style={styles.pageNumber}>{f('{page}. dedikálási oldal', { page: pageNumber })}</div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="user"
              onChange={(event) => selectPhoto(event.target.files?.[0], 'camera')}
              style={styles.hiddenInput}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={(event) => selectPhoto(event.target.files?.[0], 'gallery')}
              style={styles.hiddenInput}
            />

            {!photoUrl && (
              <>
                <h2 style={styles.question}>{t('Honnan választasz fényképet?')}</h2>
                <div style={styles.actions}>
                  <button type="button" style={styles.primaryButton} onClick={openCamera}>
                    {t('Kamera')}
                  </button>
                  <button type="button" style={styles.secondaryButton} onClick={openGallery}>
                    {t('Galéria')}
                  </button>
                </div>
              </>
            )}

            {photoUrl && !photoAccepted && (
              <>
                <div style={styles.photoFrame}>
                  <img src={photoUrl} alt={t('Dedikálási fénykép előnézete')} style={styles.photo} />
                </div>
                <div style={styles.previewActions}>
                  <button type="button" style={styles.secondaryCompactButton} onClick={takeAnotherPhoto}>
                    {t(photoSource === 'gallery' ? 'Másik kép' : 'Új fotó')}
                  </button>
                  <button type="button" style={styles.primaryCompactButton} onClick={() => setPhotoAccepted(true)}>
                    {t('Rendben')}
                  </button>
                </div>
              </>
            )}

            {photoUrl && photoAccepted && (
              <>
                <h2 style={styles.signatureTitle}>{t('Aláírás')}</h2>
                <div style={styles.signatureHint}>{t('Írj alá ujjal közvetlenül a fényképen.')}</div>
                <div style={styles.signatureFrame}>
                  <img src={photoUrl} alt={t('Dedikálási fénykép előnézete')} style={styles.photo} />
                  <canvas
                    ref={signatureCanvasRef}
                    width={720}
                    height={960}
                    style={styles.signatureCanvas}
                    onPointerDown={startSignature}
                    onPointerMove={drawSignature}
                    onPointerUp={stopSignature}
                    onPointerCancel={stopSignature}
                  />
                </div>
                <div style={styles.signatureActions}>
                  <button type="button" style={styles.secondaryCompactButton} onClick={() => setPhotoAccepted(false)}>
                    {t('Vissza a fényképhez')}
                  </button>
                  <button type="button" style={styles.secondaryCompactButton} onClick={clearSignature} disabled={!hasSignature}>
                    {t('Újraírás')}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', padding: '16px', boxSizing: 'border-box', background: '#f1f5f9', fontFamily: 'Arial, sans-serif', display: 'grid', placeItems: 'center' },
  card: { width: '100%', maxWidth: 520, padding: '20px', boxSizing: 'border-box', borderRadius: 18, background: '#ffffff', boxShadow: '0 12px 34px rgba(15, 23, 42, 0.12)' },
  back: { display: 'inline-block', marginBottom: 18, color: '#475569', textDecoration: 'none', fontWeight: 700 },
  brand: { color: '#64748b', fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { margin: '6px 0 8px', color: '#0f172a', fontSize: 28, overflowWrap: 'anywhere' },
  pageNumber: { marginBottom: 24, color: '#64748b', fontWeight: 700 },
  question: { margin: '0 0 18px', color: '#0f172a', fontSize: 21, textAlign: 'center' },
  actions: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  primaryButton: { minHeight: 74, border: 0, borderRadius: 13, background: '#0f172a', color: '#ffffff', fontSize: 18, fontWeight: 800 },
  secondaryButton: { minHeight: 74, border: '2px solid #0f172a', borderRadius: 13, background: '#ffffff', color: '#0f172a', fontSize: 18, fontWeight: 800 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' },
  photoFrame: { width: 'min(100%, 360px)', aspectRatio: '3 / 4', margin: '0 auto', overflow: 'hidden', borderRadius: 12, background: '#e2e8f0', boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)' },
  photo: { display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' },
  previewActions: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 },
  primaryCompactButton: { minHeight: 50, border: 0, borderRadius: 10, background: '#0f172a', color: '#ffffff', fontSize: 16, fontWeight: 800 },
  secondaryCompactButton: { minHeight: 50, border: '1px solid #94a3b8', borderRadius: 10, background: '#ffffff', color: '#334155', fontSize: 16, fontWeight: 800 },
  acceptedPanel: { display: 'grid', gap: 12, padding: '28px 18px', borderRadius: 13, background: '#f0fdf4', color: '#166534', textAlign: 'center' },
  signatureTitle: { margin: '0 0 4px', color: '#0f172a', fontSize: 21, textAlign: 'center' },
  signatureHint: { marginBottom: 12, color: '#475569', fontSize: 14, textAlign: 'center' },
  signatureFrame: { position: 'relative', width: 'min(100%, 360px)', aspectRatio: '3 / 4', margin: '0 auto', overflow: 'hidden', borderRadius: 12, background: '#e2e8f0', boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)' },
  signatureCanvas: { position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' },
  signatureActions: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 },
  hint: { marginTop: 16, color: '#64748b', fontSize: 13, lineHeight: 1.45, textAlign: 'center' },
  message: { padding: 20, color: '#64748b', textAlign: 'center' },
  error: { padding: 14, borderRadius: 10, background: '#fef2f2', color: '#991b1b', textAlign: 'center' },
};
