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

const SIGNATURE_COLORS = [
  { value: '#000000', label: 'Fekete' },
  { value: '#ffffff', label: 'Fehér' },
  { value: '#dc2626', label: 'Piros' },
  { value: '#2563eb', label: 'Kék' },
  { value: '#d4af37', label: 'Arany' },
] as const;

export function DedicationCapturePage({ bookId, pageId }: DedicationCapturePageProps) {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const f = (key: string, values: Record<string, string | number>) =>
    ownerFormat(language, key, values);
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [pageVersion, setPageVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoAccepted, setPhotoAccepted] = useState(false);
  const [photoSource, setPhotoSource] = useState<'camera' | 'gallery' | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureColor, setSignatureColor] = useState('#000000');
  const [editingSavedSignature, setEditingSavedSignature] = useState(false);
  const [savedSignatureUrl, setSavedSignatureUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(() => {
    if (!savedSignatureUrl || !photoAccepted) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = signatureCanvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      setHasSignature(true);
    };
    image.onerror = () => setError(t('A mentett aláírást nem sikerült betölteni.'));
    image.src = savedSignatureUrl;
  }, [savedSignatureUrl, photoAccepted]);

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
    context.strokeStyle = signatureColor;
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

  const changeSignatureColor = (color: string) => {
    setSignatureColor(color);
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !hasSignature) return;
    context.save();
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  };

  const createDedicationAssets = async () => {
    if (!photoUrl || !signatureCanvasRef.current) throw new Error('MISSING_DEDICATION_ASSETS');
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = photoUrl;
    await image.decode();

    const photoCanvas = document.createElement('canvas');
    photoCanvas.width = 720;
    photoCanvas.height = 960;
    const photoContext = photoCanvas.getContext('2d');
    if (!photoContext) throw new Error('CANVAS_NOT_AVAILABLE');
    const scale = Math.max(photoCanvas.width / image.naturalWidth, photoCanvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    photoContext.drawImage(image, (photoCanvas.width - width) / 2, (photoCanvas.height - height) / 2, width, height);

    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = 720;
    compositeCanvas.height = 960;
    const compositeContext = compositeCanvas.getContext('2d');
    if (!compositeContext) throw new Error('CANVAS_NOT_AVAILABLE');
    compositeContext.drawImage(photoCanvas, 0, 0);
    compositeContext.drawImage(signatureCanvasRef.current, 0, 0);

    return {
      photoDataUrl: photoCanvas.toDataURL('image/jpeg', 0.86),
      signatureDataUrl: signatureCanvasRef.current.toDataURL('image/png'),
      previewDataUrl: compositeCanvas.toDataURL('image/jpeg', 0.82),
    };
  };

  const completeDedication = async () => {
    if (!hasSignature || pageVersion === null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const assets = await createDedicationAssets();
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/dedications/${encodeURIComponent(pageId)}/complete`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...assets, signatureColor, expectedVersion: pageVersion }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'DEDICATION_COMPLETE_FAILED');
      window.location.href = `/my-books/${encodeURIComponent(bookId)}`;
    } catch (saveFailure) {
      console.error(saveFailure);
      setSaveError(t('A dedikálást nem sikerült elmenteni. Próbáld újra.'));
      setSaving(false);
    }
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
        if (!page || (page.inviteStatus !== 'empty' && page.inviteStatus !== 'submitted')) {
          throw new Error('DEDICATION_PAGE_NOT_AVAILABLE');
        }
        setBookTitle(data.book.title || 'MemoryBook');
        setPageNumber(Number(page.pageNumber));
        setPageVersion(Number(page.version));
        if (page.inviteStatus === 'submitted') {
          const pageResponse = await fetch(
            `${API_BASE}/api/pages/${encodeURIComponent(pageId)}`,
            { credentials: 'include' }
          );
          const pageData = await pageResponse.json().catch(() => ({}));
          if (
            !pageResponse.ok ||
            pageData.canvasData?.type !== 'dedication' ||
            typeof pageData.canvasData?.photo?.url !== 'string' ||
            typeof pageData.canvasData?.signature?.url !== 'string'
          ) {
            throw new Error('DEDICATION_PAGE_NOT_EDITABLE');
          }
          setEditingSavedSignature(true);
          setPhotoUrl(pageData.canvasData.photo.url);
          setPhotoAccepted(true);
          setSignatureColor(pageData.canvasData.signature.color || '#000000');
          setSavedSignatureUrl(pageData.canvasData.signature.url);
        }
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
                <h2 style={styles.signatureTitle}>
                  {t(editingSavedSignature ? 'Aláírás szerkesztése' : 'Aláírás')}
                </h2>
                <div style={styles.signatureHint}>{t('Írj alá ujjal közvetlenül a fényképen.')}</div>
                <div style={styles.colorRow} aria-label={t('Aláírás színe')}>
                  {SIGNATURE_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      aria-label={t(color.label)}
                      title={t(color.label)}
                      onClick={() => changeSignatureColor(color.value)}
                      style={{
                        ...styles.colorButton,
                        background: color.value,
                        outline: signatureColor === color.value ? '3px solid #0f172a' : '1px solid #94a3b8',
                      }}
                    />
                  ))}
                  <label style={styles.customColorLabel} title={t('Egyedi szín')}>
                    <span>{t('Egyedi')}</span>
                    <input
                      type="color"
                      value={signatureColor}
                      aria-label={t('Egyedi szín')}
                      onChange={(event) => changeSignatureColor(event.target.value)}
                      style={styles.customColorInput}
                    />
                  </label>
                </div>
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
                  {!editingSavedSignature && (
                    <button type="button" style={styles.secondaryCompactButton} onClick={() => setPhotoAccepted(false)}>
                      {t('Vissza a fényképhez')}
                    </button>
                  )}
                  <button type="button" style={styles.secondaryCompactButton} onClick={clearSignature} disabled={!hasSignature}>
                    {t('Újraírás')}
                  </button>
                  <button
                    type="button"
                    style={{
                      ...styles.primaryCompactButton,
                      gridColumn: editingSavedSignature ? undefined : '1 / -1',
                    }}
                    onClick={completeDedication}
                    disabled={!hasSignature || saving}
                  >
                    {saving ? t('Mentés...') : t('Kész')}
                  </button>
                </div>
                {saveError && <div style={styles.error}>{saveError}</div>}
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
  colorRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  colorButton: { width: 34, height: 34, padding: 0, border: 0, borderRadius: '50%', outlineOffset: 2 },
  customColorLabel: { display: 'flex', alignItems: 'center', gap: 5, color: '#334155', fontSize: 13, fontWeight: 700 },
  customColorInput: { width: 38, height: 34, padding: 1, border: '1px solid #94a3b8', borderRadius: 7, background: '#ffffff' },
  signatureFrame: { position: 'relative', width: 'min(100%, 360px)', aspectRatio: '3 / 4', margin: '0 auto', overflow: 'hidden', borderRadius: 12, background: '#e2e8f0', boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)' },
  signatureCanvas: { position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair' },
  signatureActions: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 },
  hint: { marginTop: 16, color: '#64748b', fontSize: 13, lineHeight: 1.45, textAlign: 'center' },
  message: { padding: 20, color: '#64748b', textAlign: 'center' },
  error: { padding: 14, borderRadius: 10, background: '#fef2f2', color: '#991b1b', textAlign: 'center' },
};
