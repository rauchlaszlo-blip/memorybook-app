import { useEffect, useRef, useState } from 'react';
import {
  MemoryBookEditor,
  type MemoryBookEditorRef,
  type PageData,
} from './MemoryBookEditor';

const API_BASE = 'http://127.0.0.1:3001';

function App() {
  const editorRef = useRef<MemoryBookEditorRef>(null);
  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);

  useEffect(() => {
    const loadPage = async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const response = await fetch(`${API_BASE}/api/pages/page-1`);

        if (!response.ok) {
          throw new Error(`PAGE_LOAD_FAILED_${response.status}`);
        }

        const data = await response.json();

        setPage({
          id: data.id,
          pageNumber: data.pageNumber,
          canvasData: data.canvasData ?? {},
          previewImageUrl: data.previewImageUrl ?? undefined,
          version: data.version,
        });
      } catch (err) {
        console.error(err);
        setLoadError('Nem sikerült betölteni az oldalt.');
      } finally {
        setLoading(false);
      }
    };

    loadPage();
  }, []);

  const handleSavePage = async (
    pageId: string,
    canvasJson: Record<string, any>,
    previewDataUrl: string,
    expectedVersion: number
  ): Promise<{ newVersion: number }> => {
    const response = await fetch(`${API_BASE}/api/pages/${pageId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        canvasData: canvasJson,
        previewDataUrl,
        expectedVersion,
      }),
    });

    if (response.status === 409) {
      const errorData = await response.json();
      const conflictError: any = new Error('PAGE_CONFLICT');
      conflictError.status = 409;
      conflictError.latestRemoteVersion = errorData.latestRemoteVersion;
      setConflictVersion(errorData.latestRemoteVersion);
      throw conflictError;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const saveError: any = new Error(errorData.error || 'PAGE_SAVE_FAILED');
      saveError.status = response.status;
      throw saveError;
    }

    const data = await response.json();

    setPage((current) =>
      current
        ? {
            ...current,
            version: data.newVersion,
            previewImageUrl: data.previewImageUrl ?? current.previewImageUrl,
          }
        : current
    );

    return {
      newVersion: data.newVersion,
    };
  };

  if (loading) {
    return <div style={{ padding: 24 }}>Oldal betöltése...</div>;
  }

  if (loadError || !page) {
    return <div style={{ padding: 24 }}>{loadError ?? 'Az oldal nem található.'}</div>;
  }

  return (
    <>
      {conflictVersion !== null && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: '#fff7ed',
            borderBottom: '1px solid #fdba74',
            padding: 12,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <strong>Ütközés: az oldalt közben másik ablakból módosították.</strong>

          <button
            onClick={() => {
              editorRef.current?.resolveConflictKeepLocal(conflictVersion);
              setConflictVersion(null);
            }}
          >
            Saját verzió megtartása
          </button>

          <button
            onClick={() => window.location.reload()}
          >
            Szerververzió betöltése
          </button>
        </div>
      )}

      <MemoryBookEditor
        ref={editorRef}
        page={page}
        onSavePage={handleSavePage}
        onConflict={() => {}}
      />
    </>
  );
}

export default App;
